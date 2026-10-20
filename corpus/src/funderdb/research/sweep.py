"""Bulk saved-source audits and conservative literal candidates, never approvals.

No network client, model or remote mutation is used. Membership is a frozen
live-site research batch, not admission to the qualified-funder target.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import re
import shutil
import sqlite3
import time
from collections import Counter
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait
from functools import lru_cache
from pathlib import Path

from lxml import html

from .active_funders import envelope
from .cohort import evidence_db
from .crawl import now, site
from .discovery import record_step
from .evidence import build_packet, submit_proposal
from .web_text import LEGACY_EXTRACTOR, visible_text
from .evidence_worker import eligibility_check
from .pipeline import sha256, write_json

RULESET = "bulk-source-review/v2"
EXTRACTION_POLICY = "substantive-main-boundary/v2"
ROLE = re.compile(r"\bwe\s+(?:(?:also|primarily|annually)\s+)?(?:award|make|provide|distribute|offer)\s+(?:(?:competitive|charitable|financial|research|matching|annual|small|unrestricted|project|operating)\s+){0,3}(?:grants|scholarships|funding)\b|\bour grantmaking (?:supports|focuses|provides|prioritizes)\b", re.I)
POLICY = re.compile(r"\b(?:we|the foundation|our foundation)\s+(?:do(?:es)?\s+not\s+|are\s+not\s+|currently\s+|only\s+|welcome\s+|accept\s+|encourage\s+|invite\s+|consider\s+|review\s+|will\s+|can\s+|cannot\s+)|\b(?:unsolicited\s+(?:grant\s+)?(?:proposals|applications|inquiries)|(?:applications|proposals|inquiries|grants)\s+(?:are\s+)?(?:by\s+)?invitation.only)\b", re.I)
GRANT = re.compile(r"\bgrant\w*|\bscholarship\w*|\bfunding|\b(?:letter|letters) of (?:inquiry|intent)|\bLOIs?\b", re.I)
NEGATIVE = re.compile(r"do(?:es)? not accept|not accepting|unsolicited|invitation.only|closed|discontinued|not be considered|no longer", re.I)
POSITIVE = re.compile(r"welcome|encourage|rolling|any time|year.round|now open|currently open|accept(?:s|ing)? (?:grant )?(?:applications|proposals|inquiries)", re.I)
BOILERPLATE = re.compile(r"cookies?|privacy|terms of (?:use|service)|subscribe|newsletter|all rights reserved|powered by|javascript|donate now", re.I)


def _readonly(path: Path):
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=30)
    db.row_factory = sqlite3.Row
    return db


def _digest(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def _immutable(path: Path, data: dict) -> str:
    if path.exists():
        raise ValueError("preserve existing evidence; use the checkpoint or a new vintage")
    write_json(path, data)
    return sha256(path)


def initialize(active: Path, out: Path, exclude: set[tuple[str, str]] | None = None, size: int | None = None) -> dict:
    active, out = active.resolve(), out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    if active not in out.parents:
        raise ValueError("bulk source evidence must remain inside the private active run")
    if (out / "sweep.json").exists():
        return json.loads((out / "sweep.json").read_text())
    pool = json.loads((active / "pool.json").read_text())
    with (out / "initialize.lock").open("a") as lease:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with _readonly(active / "verification.sqlite3") as source:
            rows = source.execute("""select m.org_id,m.target,m.packet_path,m.result_sha256
                from members m join assessments a using(org_id)
                where json_extract(a.summary,'$.liveness')='live_content_observed_within_7_days'
                order by case m.state when 'website_criteria_candidate_pending_semantic_review' then 0
                  when 'live_funding_lead_identity_pending' then 1 else 2 end,
                  case json_extract(a.summary,'$.inquiry_readiness')
                    when 'guidance_lead_requires_route_and_posture_review' then 0 else 1 end,
                  case json_extract(a.summary,'$.freshness')
                    when 'recent_page_date_lead' then 0 else 1 end,m.selection_rank""").fetchall()
        if exclude:
            rows = [row for row in rows if (row["org_id"], row["result_sha256"]) not in exclude]
        if size:
            rows = rows[:size]
        if not rows:
            raise ValueError("no acquired live-site cases available for the sweep")
        members = out / "members.jsonl"
        body = "".join(json.dumps(json.loads(row["target"]), sort_keys=True) + "\n" for row in rows).encode()
        if members.exists() and members.read_bytes() != body:
            raise ValueError("interrupted frozen membership differs; retain it and reconcile")
        if not members.exists():
            members.write_bytes(body)
        with evidence_db(out) as db:
            db.execute("""create table if not exists sweep_jobs(
              org_id text primary key,assessment_path text not null,assessment_sha256 text not null,
              selection_rank integer not null,
              state text not null default 'pending',review_path text,review_sha256 text,
              identity text,disposition text,pages integer default 0,claims integer default 0,
              conflicts integer default 0,updated_at text)""")
            db.execute("create index if not exists sweep_pending on sweep_jobs(state,selection_rank)")
            for rank, row in enumerate(rows):
                db.execute("insert or ignore into members(org_id,target,selection_rank) values(?,?,?)",
                           (row["org_id"], row["target"], rank))
                db.execute("insert or ignore into sweep_jobs(org_id,assessment_path,assessment_sha256,selection_rank) values(?,?,?,?)",
                           (row["org_id"], row["packet_path"], Path(row["packet_path"]).stem, rank))
        manifest = {"schema": RULESET, "created_at": now(), "active_run": str(active),
                    "extraction_policy": EXTRACTION_POLICY,
                    "source_run": pool["source_run"], "source_inventory_sha256": pool["source_inventory_sha256"],
                    "members": len(rows), "members_sha256": _digest(body), "ruleset": RULESET,
                    "scope": "frozen acquired live-site source-review batch; not qualified membership",
                    "semantic_approval": False, "human_reviewed": False, "remote_mutations": 0}
        write_json(out / "cohort.json", manifest)
        write_json(out / "sweep.json", manifest)
    return manifest


def parse_before_images(path: Path) -> dict:
    """Read the saved complete SELECT response, never execute its contents."""
    data = json.loads(path.read_text())
    if data.get("is_complete_read_only_snapshot"):
        return data
    result = json.loads(data["result"]["content"][0]["text"])["result"]
    parsed = None
    for match in re.finditer(r'\[\s*\{', result):
        try:
            value, _ = json.JSONDecoder().raw_decode(result[match.start():])
        except json.JSONDecodeError:
            continue
        if (isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict)
                and isinstance(value[0].get("rows"), list) and "total_rows" in value[0]):
            parsed = value[0]
            break
    if parsed is None or parsed["total_rows"] != len(parsed["rows"]):
        raise ValueError("incomplete before-image snapshot; do not infer absent rows")
    return {"observed_at": data["observed_at"], "rows": parsed["rows"],
            "is_complete_read_only_snapshot": True, "envelope_sha256": sha256(path)}


@lru_cache(maxsize=64)
def _filing_rows(path: str, digest: str, mtime: int, size: int) -> dict:
    if sha256(Path(path)) != digest:
        raise ValueError("filing export source hash mismatch")
    return {(r["org_id"], r["object_id"]): (i, r) for i, r in enumerate(json.loads(Path(path).read_text()))}


def _name(value: str) -> str:
    value = re.sub(r"[^a-z0-9]+", " ", value.lower())
    return " ".join(x for x in value.split() if x not in {"the", "inc", "incorporated", "ltd", "corporation"})


def filing_bridge(target: dict, source: Path, pages: list[dict]) -> dict:
    digest = target.get("filing_page_sha256")
    if not digest or not target.get("website_filing"):
        return {"state": "filing_bridge_not_available"}
    paths = list((source / "api" / "filings").glob("*/" + digest + ".json"))
    if len(paths) != 1:
        return {"state": "filing_source_not_available"}
    path = paths[0]
    info = path.stat()
    row = _filing_rows(str(path), digest, info.st_mtime_ns, info.st_size).get((target["org_id"], target["website_filing"]))
    if not row:
        return {"state": "filing_row_not_found"}
    index, record = row
    if (record.get("ein") != target["ein"] or site(record.get("website") or "") != site(target["website"])
            or record.get("source_dataset") != "irs_990_xml"):
        return {"state": "filing_entity_or_domain_conflict", "source_sha256": digest, "row": index}
    name = _name(target["org_name"])
    name_pages = [p["snapshot"]["sha256"] for p in pages if len(name) >= 8 and name in _name(p["text"])]
    return {"state": "filer_domain_ein_and_publisher_name" if name_pages else "filer_domain_ein_only",
            "source_path": str(path), "source_sha256": digest, "row": index,
            "object_id": record["object_id"], "tax_period": record["tax_period"],
            "source_url": record["source_url"], "license_code": record["license_code"],
            "publisher_name_page_hashes": name_pages,
            "semantic_identity_review": "pending", "current_standing": "not_checked"}


def _excluded_block(node) -> bool:
    # An unclosed site menu can make lxml place <main> inside nav/header.
    # Explicit main content bounds site chrome, but not forms or quotations.
    inside_main = False
    for ancestor in node.iterancestors():
        if ancestor.tag in {"form", "blockquote", "script", "style", "noscript", "svg"}:
            return True
        if ancestor.tag == "main" or ancestor.get("role") == "main":
            inside_main = True
        if not inside_main and (
            ancestor.tag in {"nav", "header", "footer", "aside"}
            or ancestor.get("role") in {"navigation", "contentinfo", "banner"}
        ):
            return True
    return False


def substantive_passages(page: dict) -> tuple[list[dict], int]:
    """Inspect content blocks, excluding navigation, footer, forms and quotes.

    Blocks retain a literal locator into the independently checked full text.
    All matching blocks are counted; bounded retained context is explicit.
    """
    raw = envelope(page)
    doc = html.fromstring(raw["text"])
    passages, seen, heading, matched = [], set(), "", 0
    for node in doc.xpath("//h1|//h2|//h3|//h4|//p|//li|//td|//div[not(*)]"):
        if _excluded_block(node):
            continue
        text = visible_text(node, page.get("extractor", LEGACY_EXTRACTOR))
        if node.tag in {"h1", "h2", "h3", "h4"}:
            heading = text[:200]
        if not 25 <= len(text) <= 1000 or text in seen or BOILERPLATE.search(text):
            continue
        seen.add(text)
        flags = [key for key, pattern in (("outgoing_role", ROLE), ("policy", POLICY))
                 if pattern.search(text) and GRANT.search(text)]
        if not flags:
            continue
        matched += 1
        start = page["text"].find(text)
        if start < 0 or len(passages) >= 60:
            continue
        passages.append({"value": text, "section_heading": heading, "flags": flags,
                         "negative_policy_language": bool(NEGATIVE.search(text)),
                         "positive_policy_language": bool(POSITIVE.search(text)),
                         "source_url": page["url"], "snapshot_sha256": page["snapshot"]["sha256"],
                         "text_sha256": page["text_sha256"], "start": start, "end": start + len(text),
                         "semantic_review": "pending; literal source assertion only"})
    return passages, matched


def _record(out: Path, source: Path, review: dict) -> None:
    oid = review["org_id"]
    path = out / "steps" / oid[:2] / (oid + ".json")
    if not path.exists():
        write_json(path, {"org_id": oid, "stage": "evidence_sweep", "outcome": "needs_review",
            "performed_at": review["reviewed_at"], "method": RULESET + "; automated substantive-block, exact-source-hash and EIN/filer-domain review; not manual semantic review",
            "queries": [], "source_urls": review.get("source_urls", []),
            "source_hashes": review.get("source_hashes", []),
            "note": "Saved-source bulk audit: " + review["disposition"] + "; identity: " + review["identity"]
                    + ". Literal candidates retain semantic, human and separate-application gates. Acquired pages, rule hits and this recorded audit do not qualify the organization.",
            "review_path": str(out / "reviews" / oid[:2] / (oid + ".json")),
            "human_reviewed": False, "published": False})
    record_step(source, path)


def review_case(out: Path, manifest: dict, row: dict, before: dict) -> dict:
    oid, target = row["org_id"], json.loads(row["target"])
    destination = out / "reviews" / oid[:2] / (oid + ".json")
    if destination.exists():
        review = json.loads(destination.read_text())
        if review["assessment_sha256"] != row["assessment_sha256"] or review["ruleset"] != RULESET:
            raise ValueError("preserve incompatible completed case")
        _record(out, Path(manifest["source_run"]), review)
        return review
    review = {"org_id": oid, "ruleset": RULESET, "extraction_policy": EXTRACTION_POLICY,
              "assessment_sha256": row["assessment_sha256"],
              "reviewed_at": now(), "identity": "unresolved", "disposition": "source_review_blocked",
              "pages_checked": 0, "claims_staged": 0, "conflict_flags": [], "source_urls": [], "source_hashes": [],
              "status": "awaiting_separate_application", "semantic_review": "pending", "human_reviewed": False,
              "published": False, "remote_mutations": 0, "site_last_updated_month": None,
              "recent_paid_donation": "not_established"}
    try:
        eligibility_check(target)
        assessment_path = Path(row["assessment_path"])
        if sha256(assessment_path) != row["assessment_sha256"]:
            raise ValueError("frozen assessment hash mismatch")
        saved = json.loads(assessment_path.read_text())
        source = Path(manifest["source_run"])
        result_path = Path(saved["source_result_path"]).resolve()
        if source.parent not in result_path.parents:
            raise ValueError("source result outside private research root")
        data = result_path.read_bytes()
        if _digest(data) != saved["source_result_sha256"]:
            raise ValueError("source result changed since frozen assessment; new vintage required")
        packet = build_packet(target, json.loads(data), source)
        if packet["integrity_failures"]:
            raise ValueError("source integrity failure; preserve reasons: " + str(packet["integrity_failures"])[:200])
        own = [p for p in packet["pages"] if site(p["url"]) == site(target["website"])]
        bridge = filing_bridge(target, source, own)
        gate = packet["identity_gate"]
        exact = gate["candidate_supported"]
        conflict = packet["identity_evidence"] == "conflicting_or_multiple_eins; identity_review_required"
        identity = ("scoped_publisher_ein" if exact else "identity_gate_hold" if not gate["filing_fallback_allowed"]
                    else "publisher_ein_conflict" if conflict else bridge["state"])
        review.update(identity=identity, identity_gate=gate, filing_bridge=bridge, pages_checked=len(packet["pages"]),
                      source_urls=[p["url"] for p in own], source_hashes=[p["snapshot"]["sha256"] for p in own],
                      source_result_sha256=saved["source_result_sha256"],
                      date_evidence=saved["assessment"].get("date_evidence", []),
                      live_observed_at=saved["assessment"].get("live_observed_at"),
                      latest_page_modified_month=saved["assessment"].get("latest_page_modified_month"),
                      latest_content_published_month=saved["assessment"].get("latest_content_published_month"))
        passages, total = [], 0
        for page in own:
            retained, found = substantive_passages(page)
            passages.extend(retained)
            total += found
        role = [p for p in passages if "outgoing_role" in p["flags"]]
        policies = [p for p in passages if "policy" in p["flags"]]
        if conflict:
            review["conflict_flags"].append("publisher_EIN_conflict; do_not_join_entities")
        if any(p["negative_policy_language"] for p in policies) and any(p["positive_policy_language"] for p in policies):
            review["conflict_flags"].append("positive_and_restrictive_policy_language; scope_or_cycle_review_required")
        review.update(passages=passages, matching_blocks=total,
                      omitted_matching_blocks=max(0, total-len(passages)),
                      outgoing_role_passages=len(role), policy_passages=len(policies),
                      unvisited_source_urls=packet.get("unvisited_urls", []))
        identity_supported = exact or (gate["filing_fallback_allowed"] and identity == "filer_domain_ein_and_publisher_name")
        review["disposition"] = ("identity_conflict_requires_review" if conflict else
            "literal_funder_candidate; semantic_review_pending" if identity_supported and role else
            "outgoing_funding_evidence_identity_pending" if role else
            "outgoing_funding_not_established_in_acquired_content")
        # Literal candidates require entity support and outgoing-role evidence.
        # This is candidate extraction, never approval of program/claim scope.
        selected = [("grantmaking_role", p) for p in role[:3]]
        selected += [("inquiry_policy", p) for p in policies[:7] if p not in role[:3]]
        if identity_supported and role and selected:
            packet_body = (json.dumps(packet, sort_keys=True) + "\n").encode()
            digest = _digest(packet_body)
            packet_path = out / "packets" / digest[:2] / (digest + ".json")
            if not packet_path.exists():
                packet_path.parent.mkdir(parents=True, exist_ok=True)
                packet_path.write_bytes(packet_body)
            with evidence_db(out) as db:
                db.execute("update members set packet_path=?,result_sha256=?,state=?,updated_at=? where org_id=?",
                    (str(packet_path), saved["source_result_sha256"], "candidate_pending_semantic_review", now(), oid))
            claims = [{"field": field, "value": p["value"], "program": None, "cycle": None,
                "currency": None, "unit": None, "effective_date": None, "published_date": None, "timezone": None,
                "citations": [{"snapshot_sha256": p["snapshot_sha256"], "text_sha256": p["text_sha256"],
                               "start": p["start"], "end": p["end"], "excerpt": p["value"]}],
                "conflicts": ["Automated literal assertion, not semantic approval. Source section: " + p["section_heading"]
                    + ". Program, cycle, speaker and organization-wide applicability remain unadjudicated; do not apply without review."]
                    + review["conflict_flags"]} for field, p in selected]
            proposal = {"schema_version": "evidence-first/v1", "org_id": oid, "author": "agent:codex-rule-sweep",
                        "model": None, "claims": claims, "unknown_fields": ["application_deadline", "award_amount", "recipient_award"],
                        "input_tokens": None, "output_tokens": None, "elapsed_seconds": None}
            proposed = out / "candidate-inputs" / oid[:2] / (oid + ".json")
            if not proposed.exists():
                write_json(proposed, proposal)
            staged = submit_proposal(out, proposed)
            old_rows = [x for x in before["rows"] if x["org_id"] == oid]
            pending = {"org_id": oid, "proposal": staged, "proposal_sha256": sha256(proposed),
                "proposal_input": str(proposed), "existing_before_images": old_rows,
                "exact_expected_state": {"org_id": oid, "existing_web_facts": old_rows},
                "before_image_observed_at": before["observed_at"],
                "before_image_envelope_sha256": before["envelope_sha256"],
                "status": "awaiting_separate_application", "remote_mutations": 0,
                "application_gate": "No executable patch. Fresh exact readback, duplicate/supersession checks, semantic adjudication and separate human/operator application required. Do not insert confirmed facts or human reviewer attribution."}
            pending_path = out / "pending-index" / oid[:2] / (oid + ".json")
            if not pending_path.exists():
                write_json(pending_path, pending)
            review.update(claims_staged=len(claims), pending_index=str(pending_path), proposal_sha256=sha256(proposed))
    except (OSError, ValueError, KeyError, TypeError) as exc:
        review["disposition"] = "source_review_blocked"
        review["error"] = str(exc)[:500]
    _immutable(destination, review)
    _record(out, Path(manifest["source_run"]), review)
    return review


def status(out: Path, state="running") -> dict:
    manifest = json.loads((out / "sweep.json").read_text())
    with evidence_db(out) as db:
        jobs = dict(db.execute("select state,count(*) from sweep_jobs group by state"))
        dispositions = dict(db.execute("select disposition,count(*) from sweep_jobs where state='done' group by disposition"))
        identities = dict(db.execute("select identity,count(*) from sweep_jobs where state='done' group by identity"))
        pages, claims, conflicts = db.execute("select coalesce(sum(pages),0),coalesce(sum(claims),0),coalesce(sum(conflicts),0) from sweep_jobs where state='done'").fetchone()
        proposals = db.execute("select count(*) from submissions").fetchone()[0]
        proposal_inputs = {row[0] for row in db.execute("select sha256 from submissions")}
        audited_ids = {row[0] for row in db.execute("select org_id from sweep_jobs where state='done'")}
        batch_ids = {row[0] for row in db.execute("select org_id from sweep_jobs")}
    result = {"schema": RULESET, "as_of": now(), "source_inventory_sha256": manifest["source_inventory_sha256"],
        "batch_size": manifest["members"], "processed": jobs.get("done", 0),
        "remaining": manifest["members"]-jobs.get("done", 0), "states": jobs,
        "dispositions": dispositions, "identity_evidence": identities, "pages_checked": pages,
        "candidate_proposals": proposals, "candidate_claim_records": claims,
        "cases_with_conflict_flags": conflicts, "fully_verified": 0, "human_reviewed": 0,
        "remote_applied": 0, "published": 0, "model_calls_by_worker": 0,
        "worker_state": state, "free_gib": round(shutil.disk_usage(out).free / 1024**3, 1),
        "completion_note": "Bulk source audits and literal candidates are separate from manual semantic review, qualified-funder admission, recent paid giving and human approval."}
    result["initial_batch_size"] = manifest["members"]
    result["initial_processed"] = jobs.get("done", 0)
    for path in sorted((out / "waves").glob("*/sweep-status.json")):
        wave = json.loads(path.read_text())
        if wave["source_inventory_sha256"] != manifest["source_inventory_sha256"]:
            raise ValueError("wave inventory differs")
        for key in ("batch_size", "processed", "remaining", "pages_checked", "candidate_proposals", "candidate_claim_records", "cases_with_conflict_flags"):
            result[key] += wave[key]
        for key in ("dispositions", "identity_evidence", "states"):
            result[key] = dict(Counter(result[key]) + Counter(wave[key]))
        with _readonly(path.parent / "verification.sqlite3") as db:
            proposal_inputs.update(row[0] for row in db.execute("select sha256 from submissions"))
            audited_ids.update(row[0] for row in db.execute("select org_id from sweep_jobs where state='done'"))
            batch_ids.update(row[0] for row in db.execute("select org_id from sweep_jobs"))
    result["distinct_organizations_audited"] = len(audited_ids)
    result["distinct_organizations_in_batches"] = len(batch_ids)
    result["rechecks_completed"] = result["processed"] - len(audited_ids)
    result["distinct_proposal_inputs"] = len(proposal_inputs)
    result["repeated_identical_proposal_inputs"] = result["candidate_proposals"] - len(proposal_inputs)
    policy = out / "follow-policy.json"
    if policy.exists():
        result["minimum_wave_size"] = json.loads(policy.read_text())["minimum_wave_size"]
    write_json(out / "sweep-status.json", result)
    return result


@lru_cache(maxsize=500000)
def _source_revision(path: str, digest: str) -> str:
    assessment = Path(path)
    if sha256(assessment) != digest:
        raise ValueError("saved assessment hash mismatch while comparing source revisions")
    return json.loads(assessment.read_text())["source_result_sha256"]


def _follow(active: Path, out: Path, workers: int, echo, minimum_wave_size: int) -> dict:
    """Follow changed acquired results, not queue timestamps or re-read times."""
    while True:
        if shutil.disk_usage(out).free < 10 * 1024**3:
            return status(out, "low_disk")
        seen = set()
        all_runs = [out] + sorted((out / "waves").glob("*/"))
        pending_wave = None
        for run in all_runs:
            if not (run / "sweep.json").exists():
                continue
            with _readonly(run / "verification.sqlite3") as db:
                seen.update((row[0], _source_revision(row[1], row[2])) for row in db.execute(
                    "select org_id,assessment_path,assessment_sha256 from sweep_jobs"))
                if run != out and db.execute("select 1 from sweep_jobs where state!='done' limit 1").fetchone():
                    pending_wave = run
        if pending_wave is None:
            with _readonly(active / "verification.sqlite3") as db:
                live = [(row[0], row[1]) for row in db.execute("""select m.org_id,m.result_sha256
                    from members m join assessments a using(org_id)
                    where json_extract(a.summary,'$.liveness')='live_content_observed_within_7_days'""")]
            count = sum(case not in seen for case in live)
            if count < minimum_wave_size:
                current = status(out, f"following_acquisition; waiting_for_next_{minimum_wave_size}_case_wave")
                current["new_live_cases_waiting_for_wave"] = count
                write_json(out / "sweep-status.json", current)
                echo(json.dumps(current), flush=True)
                time.sleep(30)
                continue
            pending_wave = out / "waves" / f"wave-{len(all_runs):04}"
            pending_wave.mkdir(parents=True, exist_ok=True)
            image = pending_wave / "profile-before-image-envelope.json"
            if not image.exists():
                image.write_bytes((out / "profile-before-image-envelope.json").read_bytes())
            initialize(active, pending_wave, exclude=seen, size=10000)

        def wave_progress(*_args, **_kwargs):
            echo(json.dumps(status(out, "reviewing_additional_bulk")), flush=True)

        work(active, pending_wave, workers=workers, echo=wave_progress)
        status(out, "following_acquisition")


def work(active: Path, out: Path, limit: int | None = None, workers: int = 4,
         follow: bool = False, echo=print, minimum_wave_size: int = 3000) -> dict:
    if not 1 <= workers <= 8:
        raise ValueError("local source workers must be between1and8")
    if not 1000 <= minimum_wave_size <= 10000:
        raise ValueError("minimum wave size must be between1000and10000")
    manifest = initialize(active, out)
    out = out.resolve()
    with (out / "sweep-worker.lock").open("a") as lease:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if follow:
            policy = out / "follow-policy.json"
            if policy.exists():
                previous = json.loads(policy.read_text())
                if previous["minimum_wave_size"] != minimum_wave_size:
                    prior = out / "policy-history" / (sha256(policy) + ".json")
                    if not prior.exists():
                        prior.parent.mkdir(parents=True, exist_ok=True)
                        prior.write_bytes(policy.read_bytes())
            if not policy.exists() or json.loads(policy.read_text())["minimum_wave_size"] != minimum_wave_size:
                write_json(policy, {"minimum_wave_size": minimum_wave_size, "maximum_wave_size": 10000,
                                    "recorded_at": now(), "counts": "distinct organization/acquired-result pairs"})
        before = parse_before_images(out / "profile-before-image-envelope.json")
        write_json(out / "before-images.json", before)
        with evidence_db(out) as db:
            db.execute("update sweep_jobs set state='pending' where state='running'")
        done, last, pending = 0, 0.0, {}
        # Parsing and normalization are CPU work. Separate local processes avoid
        # the Python interpreter lock; they never fetch pages or call a model.
        with ProcessPoolExecutor(max_workers=workers) as executor:
            while True:
                disk_ok = shutil.disk_usage(out).free >= 10 * 1024**3
                available = workers-len(pending)
                if limit:
                    available = min(available, limit-done-len(pending))
                if available > 0 and disk_ok:
                    with evidence_db(out) as db:
                        rows = db.execute("select j.*,m.target from sweep_jobs j join members m using(org_id) where j.state='pending' order by j.selection_rank limit ?", (available,)).fetchall()
                        db.executemany("update sweep_jobs set state='running' where org_id=?", [(row["org_id"],) for row in rows])
                    for row in rows:
                        pending[executor.submit(review_case, out, manifest, dict(row), before)] = row["org_id"]
                if not pending:
                    if not disk_ok:
                        return status(out, "low_disk")
                    if limit and done >= limit:
                        return status(out, "bounded_segment_complete")
                    complete = status(out, "initial_bulk_pass_complete; unresolved_dependencies_retained")
                    marker = out / "initial-bulk-pass-complete.json"
                    if not marker.exists():
                        _immutable(marker, complete)
                    break
                finished, _ = wait(pending, timeout=1, return_when=FIRST_COMPLETED)
                for future in finished:
                    oid = pending.pop(future)
                    reviewed = future.result()
                    path = out / "reviews" / oid[:2] / (oid + ".json")
                    with evidence_db(out) as db:
                        db.execute("""update sweep_jobs set state='done',review_path=?,review_sha256=?,identity=?,disposition=?,pages=?,claims=?,conflicts=?,updated_at=? where org_id=?""",
                            (str(path), sha256(path), reviewed["identity"], reviewed["disposition"], reviewed["pages_checked"],
                             reviewed["claims_staged"], int(bool(reviewed["conflict_flags"])), now(), oid))
                    done += 1
                if time.monotonic()-last >= 30:
                    echo(json.dumps(status(out)), flush=True)
                    last = time.monotonic()
        # Close the initial CPU pool before additional waves create their own.
        if follow:
            return _follow(active.resolve(), out, workers, echo, minimum_wave_size)
        return complete
