"""Private, evidence-led active-funder triage; no model or remote writes.

Regex hits and publisher metadata are review leads, never verified claims.
The search pool can exceed the requested cohort; unknowns never fill its target.
"""
from __future__ import annotations

import calendar
import fcntl
import gzip
import hashlib
import json
import re
import shutil
import sqlite3
import time
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

from lxml import html

from .bulk import ReadAPI
from .cohort import evidence_db
from .crawl import canonical, now, site
from .evidence import build_packet, prepare_work_item
from .evidence_worker import eligibility_check, next_batch
from .pipeline import sha256, write_json

RULESET = "active-funders/v2"
LEADS = {
    "outgoing_funding": re.compile(r"\b(?:we (?:award|provide|make|distribute) grants|our grantmaking|our grant-making|grants we (?:award|make)|apply for (?:a |our )?grant|grant application guidelines)\b", re.I),
    "focus": re.compile(r"\b(?:funding priorities|areas we fund|what we fund|grantmaking priorities|funding focus)\b", re.I),
    "geography": re.compile(r"\b(?:geographic (?:focus|area|priorit|eligib)|eligible (?:countries|states|regions)|where we fund)\b", re.I),
    "applicant_eligibility": re.compile(r"\b(?:eligible applicants|eligibility criteria|who (?:can|may) apply|applicant eligibility|501\s*\(?c\)?\s*\(?3\)?)\b", re.I),
    "application_posture": re.compile(r"\b(?:unsolicited (?:proposals|applications)|invitation.only|applications (?:are |now )?(?:open|closed)|accept(?:ing|s)? (?:grant )?(?:applications|proposals)|do not accept|does not accept)\b", re.I),
    "inquiry_guidance": re.compile(r"\b(?:grant (?:inquir(?:y|ies)|questions)|funding (?:inquir(?:y|ies)|questions)|letter of (?:inquiry|intent)|(?:contact|email) (?:our |the )?(?:grants?|program) (?:team|staff|officer))\b", re.I),
}
PARKING = re.compile(r"\b(?:this domain (?:is |may be )?for sale|buy this domain|domain (?:has expired|is parked)|online casino|sports betting)\b", re.I)
UPDATED = re.compile(r"\b(?:last updated|last modified|page updated)\s*[:–-]?\s*((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:\d{1,2},?\s+)?20\d{2}|20\d{2}-\d{2}(?:-\d{2})?)", re.I)


def month(value: str, as_of: date) -> str | None:
    """Accept dated month precision, reject years alone and future months."""
    value = value.strip()
    match = re.match(r"^(20\d{2})-(\d{2})(?:$|[-T ])", value)
    if match:
        year, number = map(int, match.groups())
        if len(value) >= 10 and value[7] == "-":
            try:
                if date.fromisoformat(value[:10]) > as_of:
                    return None
            except ValueError:
                return None
    else:
        match = re.fullmatch(r"([A-Za-z]+)\s+(?:\d{1,2},?\s+)?(20\d{2})", value)
        if not match:
            return None
        names = {name.lower(): i for i, name in enumerate(calendar.month_name) if name}
        number, year = names.get(match[1].lower(), 0), int(match[2])
    if not 1 <= number <= 12 or (year, number) > (as_of.year, as_of.month):
        return None
    return f"{year:04}-{number:02}"


def envelope(page: dict) -> dict:
    ref = page["snapshot"]
    with (gzip.open(ref["path"], "rb") if ref.get("encoding") == "gzip"
          else Path(ref["path"]).open("rb")) as stream:
        body = stream.read(8 * 1024**2 + 1)
    if len(body) > 8 * 1024**2:
        raise ValueError("expanded metadata exceeds evidence-reader guard")
    expected = ref.get("content_sha256") or (ref["sha256"] if ref.get("encoding") != "gzip" else None)
    if expected and hashlib.sha256(body).hexdigest() != expected:
        raise ValueError("metadata source hash mismatch")
    return json.loads(body)


def date_evidence(page: dict, as_of: date, raw: dict) -> list[dict]:
    """Scope structured dates to their page; headers are deliberately excluded."""
    ref = page["snapshot"]
    doc = html.fromstring(raw["text"])
    found = []

    def add(value, kind, locator):
        parsed = month(value, as_of) if isinstance(value, str) else None
        if parsed:
            found.append({"month": parsed, "kind": kind, "raw_value": value,
                          "locator": locator, "scope": "page", "url": page["url"],
                          "snapshot_sha256": ref["sha256"],
                          "observed_at": page["observed_at"],
                          "interpretation": "publisher_assertion_pending_review"})

    for i, element in enumerate(doc.xpath("//meta[@content]")):
        key = (element.get("property") or element.get("name") or "").lower()
        if key in ("article:modified_time", "date.modified", "datemodified", "last-modified"):
            add(element.get("content"), "modified", f"meta[{i}]/{key}")
        elif key in ("article:published_time", "datepublished", "date.published"):
            add(element.get("content"), "published", f"meta[{i}]/{key}")

    def walk(value, pointer, depth=0):
        if depth > 30:
            return
        if isinstance(value, dict):
            types = value.get("@type", [])
            types = [types] if isinstance(types, str) else types
            subject = value.get("url") or value.get("@id")
            own_subject = False
            if isinstance(subject, str):
                try:
                    own_subject = canonical(urljoin(page["url"], subject)) == canonical(page["url"])
                except ValueError:
                    pass
            if own_subject and isinstance(types, list) and any(t in ("WebPage", "Article", "NewsArticle", "BlogPosting") for t in types):
                for key, kind in (("dateModified", "modified"), ("datePublished", "published")):
                    add(value.get(key), kind, pointer + "/" + key)
            for key, child in value.items():
                walk(child, pointer + "/" + str(key), depth + 1)
        elif isinstance(value, list):
            for i, child in enumerate(value):
                walk(child, pointer + "/" + str(i), depth + 1)

    for i, element in enumerate(doc.xpath('//script[@type="application/ld+json"]')):
        try:
            walk(json.loads(element.text or ""), f"jsonld[{i}]")
        except (ValueError, RecursionError):
            continue
    for match in UPDATED.finditer(page["text"]):
        add(match[1], "modified", f"visible-text:{match.start()}:{match.end()}")
    return found


def assess(packet: dict, as_of: date) -> dict:
    target_site = packet.get("candidate_website")
    pages = [p for p in packet.get("pages", []) if target_site and site(p["url"]) == site(target_site)]
    observed, dates, routes, url_checks, invalid_links, leads = [], [], [], [], [], {key: [] for key in LEADS}
    parking = False
    for page in pages:
        text = page["text"]
        raw = envelope(page)
        parking = parking or bool(PARKING.search(text))
        age = (as_of - datetime.fromisoformat(page["observed_at"].replace("Z", "+00:00")).date()).days
        exact_url = (canonical(page["url"]) == canonical(target_site)
                     or canonical(raw.get("requested_url") or page["url"]) == canonical(target_site))
        if len(text) >= 100 and 0 <= age <= 7 and exact_url:
            observed.append(page["observed_at"])
            url_checks.append({"requested_url": raw.get("requested_url"), "final_url": page["url"],
                               "snapshot_sha256": page["snapshot"]["sha256"], "observed_at": page["observed_at"], "http_status": 200})
        dates.extend(date_evidence(page, as_of, raw))
        doc = html.fromstring(raw["text"])
        for i, anchor in enumerate(doc.xpath("//a[@href]")):
            label = " ".join(anchor.text_content().split())[:160]
            href = anchor.get("href", "")
            try:
                url = canonical(urljoin(page["url"], href))
            except ValueError as exc:
                # A malformed link is inert publisher data, not a corrupt page.
                # Canonical validation still rejects credentials, bad ports and
                # unsupported schemes before a route can become a candidate.
                if len(invalid_links) < 30:
                    invalid_links.append({"source_url": page["url"], "snapshot_sha256": page["snapshot"]["sha256"],
                                          "locator": f"a[{i}]/href", "href": href[:256], "reason": str(exc)[:200]})
                continue
            if (site(url) == site(target_site) and url.startswith(("http://", "https://"))
                    and re.search(r"contact|grant.?inquir|funding.?inquir", label + " " + href, re.I)):
                routes.append({"url": url, "label": label, "source_url": page["url"],
                               "snapshot_sha256": page["snapshot"]["sha256"], "locator": f"a[{i}]/href",
                               "scope": "public_contact_page_candidate; inquiry_permission_unknown"})
        for key, pattern in LEADS.items():
            for match in list(pattern.finditer(text))[:3]:
                start, end = max(0, match.start() - 100), min(len(text), match.end() + 180)
                leads[key].append({"url": page["url"], "snapshot_sha256": page["snapshot"]["sha256"],
                                   "text_sha256": page["text_sha256"], "start": start, "end": end,
                                   "excerpt": text[start:end], "semantic_review": "pending"})
    identity = packet.get("identity_evidence", "not_established")
    live = "suspected_parking_or_unrelated_content" if parking else (
        "live_content_observed_within_7_days" if observed else
        "candidate_url_not_confirmed_or_stale" if pages else "not_observed_or_acquisition_blocked")
    if packet.get("integrity_failures") or packet["state"] == "source_integrity_blocked":
        live = "source_integrity_blocked"
    role = bool(leads["outgoing_funding"])
    bridge = identity == "exact_ein_observed; semantic_identity_review_pending"
    state = ("website_criteria_candidate_pending_semantic_review" if live == "live_content_observed_within_7_days" and role and bridge else
             "live_funding_lead_identity_pending" if live == "live_content_observed_within_7_days" and role else
             "funder_role_not_established" if live == "live_content_observed_within_7_days" else live)
    modified = [d["month"] for d in dates if d["kind"] == "modified"]
    published = [d["month"] for d in dates if d["kind"] == "published"]
    cutoff = f"{as_of.year - 1:04}-{as_of.month:02}"
    return {"schema": RULESET, "as_of": as_of.isoformat(), "state": state,
            "liveness": live, "live_observed_at": max(observed) if observed else None,
            "url_checks": url_checks, "contact_page_candidates": routes[:30],
            "invalid_contact_links": invalid_links,
            "identity_evidence": identity, "site_last_updated_month": None,
            "site_update_scope": "unknown; page dates do not establish site-wide updates",
            "latest_page_modified_month": max(modified) if modified else None,
            "latest_content_published_month": max(published) if published else None,
            "freshness": "recent_page_date_lead" if any(d["month"] >= cutoff for d in dates) else
                         "older_page_dates_only; overall_currency_unknown" if dates else "update_month_unknown",
            "date_evidence": dates, "fit_and_inquiry_leads": leads,
            "fit_fields_with_leads": [key for key in LEADS if key != "outgoing_funding" and leads[key]],
            "fit_fields_missing": [key for key in LEADS if key != "outgoing_funding" and not leads[key]],
            "inquiry_readiness": "guidance_lead_requires_route_and_posture_review" if leads["inquiry_guidance"] else "grant_inquiry_route_not_established",
            "recent_paid_donation": "not_established_by_website_triage",
            "human_reviewed": False, "published": False,
            "application_status": "awaiting_separate_application"}


def initialize(source_run: Path, previous: Path, run: Path, size=150000) -> dict:
    """Append URL-bearing c3 search candidates; preserve every pool vintage."""
    source_run, previous, run = source_run.resolve(), previous.resolve(), run.resolve()
    if run in (source_run, previous):
        raise ValueError("use a separate revision directory")
    run.mkdir(parents=True, exist_ok=True)
    metadata = json.loads((source_run / "inventory.jsonl.meta.json").read_text())
    previous_manifest = json.loads((previous / "cohort.json").read_text())
    if (previous_manifest["source_inventory_sha256"] != metadata["sha256"]
            or Path(previous_manifest["source_run"]).resolve() != source_run):
        raise ValueError("previous eligibility observations belong to a different inventory")
    if sha256(source_run / "inventory.jsonl") != metadata["sha256"]:
        raise ValueError("immutable inventory hash mismatch")
    with (run / "pool-init.lock").open("a") as lease, evidence_db(run) as db:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        db.execute("attach database ? as prior", ((previous / "verification.sqlite3").as_uri() + "?mode=ro",))
        db.execute("insert or ignore into eligibility select * from prior.eligibility")
        db.execute("create table if not exists recent_evidence(grant_id text primary key,org_id text not null,record text not null,source_page text not null,source_sha256 text not null)")
        # New GET exports may extend the initial partial charity observations.
        for checkpoint in sorted((run / "eligibility").glob("*/checkpoint.json")):
            for page in json.loads(checkpoint.read_text())["pages"]:
                path = Path(page["path"])
                if sha256(path) != page["sha256"]:
                    raise ValueError("eligibility page hash mismatch")
                db.executemany("insert or ignore into eligibility values(?,?,?,?,?)", [
                    (r["id"], json.dumps(r), str(path), page["sha256"], page["observed_at"])
                    for r in json.loads(path.read_text())])
                db.commit()
        db.commit()
        db.execute("attach database ? as source", ((source_run / "queue.sqlite3").as_uri() + "?mode=ro",))
        rank = db.execute("select coalesce(max(selection_rank),-1)+1 from members").fetchone()[0]
        candidates = db.execute("""select o.org_id,o.target,e.page,e.page_sha256,e.observed_at,e.record
          from eligibility e cross join source.organizations o using(org_id)
          where (json_extract(o.target,'$.website') is not null
                 or exists(select 1 from recent_evidence g where g.org_id=o.org_id))
            and not exists(select 1 from members m where m.org_id=o.org_id)
          order by case o.state when 'evidence_ready' then 0 else 1 end,o.org_id""").fetchall()
        additions = []
        seen = {json.loads(r[0])["ein"] for r in db.execute("select target from members")}
        # End the read snapshot before reserving the local writer. The follower
        # updates existing rows concurrently; upgrading a live read cursor would
        # otherwise fail immediately with SQLITE_BUSY_SNAPSHOT despite timeout.
        db.execute("begin immediate")
        for org_id, target_json, page, digest, observed, record in candidates:
            target, record = json.loads(target_json), json.loads(record)
            ein = target.get("ein")
            if (not ein or not re.fullmatch(r"\d{9}", ein) or ein in seen or target.get("canonical_org_id")
                    or record["subsection_code"] != "03" or record["source_dataset"] != "irs_eo_bmf"
                    or record["license_code"] != "us_public_domain"
                    or record["source_record_locator"] != "row:EIN=" + ein):
                continue
            seen.add(ein)
            target["c3_evidence"] = {"subsection_code": "03", "page": page, "sha256": digest,
                "source_record_locator": record["source_record_locator"], "source_dataset": "irs_eo_bmf",
                "observed_at": observed, "standing_not_checked": True}
            additions.append(target)
            db.execute("insert into members(org_id,target,selection_rank) values(?,?,?)",
                       (org_id, json.dumps(target), rank))
            rank += 1
        body = "".join(json.dumps(t, sort_keys=True) + "\n" for t in additions).encode()
        digest = hashlib.sha256(body).hexdigest()
        if additions:
            path = run / "pool-additions" / (digest + ".jsonl")
            path.parent.mkdir(exist_ok=True)
            if not path.exists():
                path.write_bytes(body)
        out = {"schema": RULESET, "as_of": now(), "source_run": str(source_run),
               "source_inventory_sha256": metadata["sha256"], "source_population": metadata["organizations"],
               "target_qualified_funders": size, "search_pool_size": rank,
               "new_search_candidates": len(additions), "last_additions_sha256": digest,
               "selection": "c3 source observation + candidate URL or exactly dated grant record; research pool, not qualified membership",
               "previous_cohort_preserved": str(previous), "remote_mutations": 0}
        vintage = run / "pool-revisions" / (hashlib.sha256(json.dumps(out, sort_keys=True).encode()).hexdigest() + ".json")
        write_json(vintage, out)
        write_json(run / "pool.json", out)
    prioritize_acquisition(run)
    return out


def prioritize_acquisition(run: Path) -> dict:
    """Focus the existing crawler, with exact local before-images; never requeue jobs."""
    source = Path(json.loads((run / "pool.json").read_text())["source_run"])
    with sqlite3.connect((source / "queue.sqlite3").resolve().as_uri(), uri=True, timeout=30) as db:
        db.row_factory = sqlite3.Row
        db.execute("attach database ? as active", ((run / "verification.sqlite3").resolve().as_uri() + "?mode=ro",))
        rows = [dict(r) for r in db.execute("""select o.org_id,o.priority,o.state,o.updated_at,
            case json_extract(m.target,'$.org_type') when 'private_foundation' then 4 else 5 end as next_priority
            from active.members m cross join organizations o using(org_id) where o.state='pending'
            and o.priority > case json_extract(m.target,'$.org_type') when 'private_foundation' then 4 else 5 end
            order by o.org_id""")]
        if not rows:
            return {"local_priority_changes": 0}
        body = (json.dumps({"at": now(), "reason": "User active-funder search priority; classification is not grantmaking proof",
                           "local_only": True, "rows": rows}, sort_keys=True) + "\n").encode()
        digest = hashlib.sha256(body).hexdigest()
        path = run / "local-before-images" / ("crawler-priority-" + digest + ".json")
        path.parent.mkdir(exist_ok=True)
        if not path.exists():
            path.write_bytes(body)
        # No write reservation during the join, sort or before-image file IO.
        # Commit bounded batches so acquisition checkpoints are not starved.
        changed = 0
        for offset in range(0, len(rows), 500):
            batch = rows[offset:offset + 500]
            db.execute("begin immediate")
            before = db.total_changes
            db.executemany("update organizations set priority=? where org_id=? and state='pending' and priority=? and updated_at=?",
                           [(r["next_priority"], r["org_id"], r["priority"], r["updated_at"]) for r in batch])
            changed += db.total_changes - before
            db.commit()
    return {"local_priority_changes": changed, "observed_rows": len(rows), "before_image_sha256": digest}


def status(run: Path, worker_state: str) -> dict:
    pool = json.loads((run / "pool.json").read_text())
    with evidence_db(run) as db:
        states = dict(db.execute("select state,count(*) from members group by state"))
        processed = db.execute("select count(*) from members where updated_at is not null").fetchone()[0]
        recent_records = db.execute("select count(*) from recent_evidence").fetchone()[0]
        dimensions = {}
        for key in ("liveness", "freshness", "inquiry_readiness"):
            dimensions[key] = dict(db.execute(
                f"select json_extract(summary,'$.{key}'),count(*) from assessments group by 1"))
    out = {"schema": RULESET, "as_of": now(), "source_inventory_sha256": pool["source_inventory_sha256"],
           "target_qualified_funders": pool["target_qualified_funders"], "search_pool_size": pool["search_pool_size"],
           "processed_search_candidates": processed, "states": states, "dimensions": dimensions,
           "website_criteria_candidates": states.get("website_criteria_candidate_pending_semantic_review", 0),
           "recent_dated_grant_records_pending_payment_review": recent_records,
           "semantically_verified_funders": 0, "target_remaining_unverified": pool["target_qualified_funders"],
           "remote_applied": 0, "human_reviewed": 0, "published": 0, "model_calls": 0,
           "worker_state": worker_state, "free_gib": round(shutil.disk_usage(run).free / 1024**3, 1),
           "completion_note": "Search-pool dispositions and date/keyword leads are not verified funders. Unknown dates and inquiry routes remain gaps; no padding to 150,000."}
    write_json(run / "active-status.json", out)
    return out


def work(run: Path, follow=False, limit=None, echo=print) -> dict:
    run = run.resolve()
    source_run = Path(json.loads((run / "pool.json").read_text())["source_run"])
    done, last_status = 0, 0.0
    with (run / "active-worker.lock").open("a") as lease, evidence_db(run) as db:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        db.execute("create table if not exists assessments(org_id text primary key,summary text not null)")
        db.commit()
        while True:
            if shutil.disk_usage(run).free < 10 * 1024**3:
                return status(run, "low_disk")
            rows = next_batch(run, source_run, min(250, limit - done) if limit else 250)
            if not rows:
                current = status(run, "following_crawler" if follow else "pass_drained")
                echo(json.dumps(current))
                if not follow:
                    return current
                time.sleep(30)
                continue
            for row in rows:
                if shutil.disk_usage(run).free < 10 * 1024**3:
                    return status(run, "low_disk")
                target = json.loads(row["target"])
                digest = None
                try:
                    eligibility_check(target)
                    packet = {"org_id": target["org_id"], "ein": target["ein"], "pages": [], "state": "waiting_for_acquisition"}
                    if row["result_path"]:
                        path = Path(row["result_path"]).resolve()
                        if source_run.parent not in path.parents:
                            raise ValueError("result outside private source root")
                        digest = sha256(path)
                        packet = build_packet(target, json.loads(path.read_text()), source_run)
                    packet["candidate_website"] = target["website"]
                    assessment = assess(packet, datetime.now(timezone.utc).date())
                    giving = [dict(r) for r in db.execute("select * from recent_evidence where org_id=?", (target["org_id"],))]
                    if giving:
                        assessment["recent_giving_record_leads"] = giving
                        assessment["recent_paid_donation"] = "exactly_dated_grant_records; source_payment_and_date_precision_review_pending"
                        if assessment["state"] not in ("website_criteria_candidate_pending_semantic_review", "source_integrity_blocked"):
                            assessment["state"] = "recent_dated_grant_record_pending_payment_review"
                except (OSError, ValueError, KeyError) as exc:
                    assessment = {"schema": RULESET, "state": "source_integrity_blocked", "error": str(exc)[:300],
                                  "liveness": "source_integrity_blocked", "freshness": "unknown", "inquiry_readiness": "unknown"}
                # Large source bodies already exist in the crawler. Retain only exact evidence locators here.
                saved = {"org_id": target["org_id"], "ein": target["ein"], "org_name": target["org_name"],
                         "website": target["website"], "c3_evidence": target["c3_evidence"],
                         "assessment": assessment, "source_result_sha256": digest,
                         "source_result_path": row["result_path"], "checked_at": now(),
                         "application_status": "awaiting_separate_application",
                         "expected_remote_state": "unknown; fresh read-only before-image required before separate application",
                         "remote_mutation": None}
                body = (json.dumps(saved, sort_keys=True) + "\n").encode()
                packet_hash = hashlib.sha256(body).hexdigest()
                path = run / "assessments" / target["org_id"][:2] / target["org_id"] / (packet_hash + ".json")
                path.parent.mkdir(parents=True, exist_ok=True)
                if not path.exists():
                    path.write_bytes(body)
                db.execute("insert or replace into assessments values(?,?)", (target["org_id"], json.dumps(assessment)))
                db.execute("""update members set state=?,packet_path=?,result_sha256=?,updated_at=?,
                   source_updated_at=?,processed_revision=? where org_id=?""", (assessment["state"], str(path), digest,
                   now(), row["source_updated_at"], row["revision"], target["org_id"]))
                db.commit()
                done += 1
            if time.monotonic() - last_status >= 30 or (limit and done >= limit):
                current = status(run, "checking_saved_website_evidence")
                echo(json.dumps(current))
                last_status = time.monotonic()
            if limit and done >= limit:
                return status(run, "bounded_pass_finished")


def recent_giving(access: Path, run: Path, as_of: date) -> dict:
    """One GET observation of exactly dated paid-grant candidates, not commitments.

    A dated API row still requires source review proving payment/date precision.
    Fiscal year, publication date, announcement and pledge dates never qualify.
    """
    cutoff = as_of.replace(year=as_of.year - 1, day=min(as_of.day, calendar.monthrange(as_of.year - 1, as_of.month)[1]))
    params = {"select": "id,event_type,funder_org_id,event_date,fiscal_year,amount,currency,source_dataset,source_url,source_record_locator",
              "event_type": "eq.grant", "funder_org_id": "not.is.null", "amount": "gt.0",
              "and": f"(event_date.gte.{cutoff.isoformat()},event_date.lte.{as_of.isoformat()})",
              "order": "event_date.desc,id.asc", "limit": "1000"}
    api = ReadAPI(access)
    try:
        response = api.get("funding_events", params)
        digest = hashlib.sha256(response.content).hexdigest()
        path = run / "recent-giving" / (digest + ".json")
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            path.write_bytes(response.content)
        rows = json.loads(response.content)
        with evidence_db(run) as db:
            db.execute("create table if not exists recent_evidence(grant_id text primary key,org_id text not null,record text not null,source_page text not null,source_sha256 text not null)")
            for row in rows:
                event_date = date.fromisoformat(row["event_date"])
                if (row["event_type"] != "grant" or not row["funder_org_id"] or not cutoff <= event_date <= as_of
                        or float(row["amount"]) <= 0):
                    raise ValueError("grant response differs from requested window/type")
                db.execute("insert or ignore into recent_evidence values(?,?,?,?,?)", (str(row["id"]), row["funder_org_id"], json.dumps(row), str(path.resolve()), digest))
        out = {"as_of": now(), "window_start": cutoff.isoformat(), "window_end": as_of.isoformat(),
               "parameters": params, "source_url": str(response.url), "sha256": digest,
               "rows": len(rows), "complete": len(rows) < 1000,
               "status": "source_payment_and_date_precision_review_required" if rows else "no_exactly_dated_rows_observed; recent_giving_unknown",
               "remote_mutations": 0, "application_status": "awaiting_separate_application"}
        write_json(run / "recent-giving" / (hashlib.sha256(json.dumps(out, sort_keys=True).encode()).hexdigest() + ".observation.json"), out)
        write_json(run / "recent-giving-status.json", out)
        return out
    finally:
        api.close()


def prepare_review(run: Path, org_id: str) -> dict:
    """Bridge a triage case to the existing strict proposal validator, without a model."""
    run = run.resolve()
    pool = json.loads((run / "pool.json").read_text())
    with evidence_db(run) as db:
        row = db.execute("select target,packet_path from members where org_id=?", (org_id,)).fetchone()
    if not row or not row["packet_path"]:
        raise ValueError("an assessed search-pool member is required")
    assessment_path = Path(row["packet_path"]).resolve()
    if run not in assessment_path.parents or sha256(assessment_path) != assessment_path.stem:
        raise ValueError("assessment reference/hash mismatch")
    assessment = json.loads(assessment_path.read_text())
    if not assessment.get("source_result_path"):
        raise ValueError("acquired sources are required before claim preparation")
    target, source_run = json.loads(row["target"]), Path(pool["source_run"])
    source = Path(assessment["source_result_path"]).resolve()
    if source_run.parent not in source.parents or sha256(source) != assessment["source_result_sha256"]:
        raise ValueError("source result reference/hash mismatch")
    eligibility_check(target)
    workspace = run / "review-workspaces" / org_id / assessment_path.stem
    with (run / "review-workspace.lock").open("a") as lease:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if not (workspace / "cohort.json").exists():
            packet = build_packet(target, json.loads(source.read_text()), source_run)
            if not packet["pages"] or packet["integrity_failures"]:
                raise ValueError("intact acquired evidence is required")
            workspace.mkdir(parents=True, exist_ok=True)
            members = workspace / "members.jsonl"
            body = json.dumps(target, sort_keys=True) + "\n"
            if members.exists() and members.read_text() != body:
                raise ValueError("preserve existing partial workspace")
            members.write_text(body)
            packet_body = (json.dumps(packet, sort_keys=True) + "\n").encode()
            digest = hashlib.sha256(packet_body).hexdigest()
            packet_path = workspace / "packets" / (digest + ".json")
            packet_path.parent.mkdir(exist_ok=True)
            if not packet_path.exists():
                packet_path.write_bytes(packet_body)
            with evidence_db(workspace) as db:
                db.execute("""insert or ignore into members(org_id,target,selection_rank,state,result_sha256,packet_path,updated_at)
                           values(?,?,0,?,?,?,?)""", (org_id, json.dumps(target), packet["state"],
                           assessment["source_result_sha256"], str(packet_path), now()))
            write_json(workspace / "cohort.json", {"schema": "evidence_cohort/v1", "members": 1,
                "members_sha256": sha256(members), "source_run": str(source_run),
                "source_inventory_sha256": pool["source_inventory_sha256"],
                "scope": "single-case proposal workspace; no admission to qualified funder target",
                "active_assessment_sha256": assessment_path.stem})
        result = prepare_work_item(workspace, org_id, workspace / "work-item.json")
    return {**result, "proposal_workspace": str(workspace), "active_assessment_sha256": assessment_path.stem,
            "status": "ready_for_source_interpretation; semantic_and_human_review_pending"}
