"""Project completed private source audits into the evidence demonstration format.

This is a local presentation step. It performs no research, network calls,
candidate submissions, approvals or database writes. Unknowns stay explicit.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import shutil
import sqlite3
from collections import Counter
from pathlib import Path

def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _checked(path: Path, digest: str) -> dict:
    if _sha(path) != digest:
        raise ValueError(f"frozen input hash differs: {path}")
    return json.loads(path.read_text())


def _immutable(path: Path, value: dict) -> str:
    body = (json.dumps(value, sort_keys=True, ensure_ascii=False) + "\n").encode()
    if path.exists():
        if path.read_bytes() != body:
            raise ValueError("preserve existing cards; use a new output vintage")
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
    return hashlib.sha256(body).hexdigest()


def project_cards(run: Path, out: Path) -> dict:
    """Resume one immutable projection of a complete frozen sweep, without models."""
    run, out = run.resolve(), out.resolve()
    manifest = json.loads((run / "sweep.json").read_text())
    source = Path(manifest["source_run"]).resolve()
    private_root = source.parent
    if private_root.name != "research" or private_root not in run.parents or private_root not in out.parents:
        raise ValueError("source audits and output must stay inside the private research root")
    if run == out or run in out.parents:
        raise ValueError("write a separate projection vintage, never alter a frozen sweep")
    if _sha(run / "members.jsonl") != manifest["members_sha256"]:
        raise ValueError("frozen membership hash differs")
    frozen = [json.loads(line) for line in (run / "members.jsonl").read_text().splitlines()]
    targets = {item["org_id"]: item for item in frozen}
    if len(targets) != len(frozen) or len(frozen) != manifest["members"]:
        raise ValueError("frozen membership is not a distinct organization set")
    with sqlite3.connect((run / "verification.sqlite3").as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        rows = [dict(row) for row in db.execute("""select j.*,m.target from sweep_jobs j
            join members m using(org_id) order by j.selection_rank""")]
    if len(rows) != manifest["members"] or any(row["state"] != "done" for row in rows):
        raise ValueError("projection requires the complete frozen source audit")
    before_path = run / "before-images.json"
    before = json.loads(before_path.read_text())
    if not before.get("is_complete_read_only_snapshot"):
        raise ValueError("retain the complete dated before-image baseline")
    out.mkdir(parents=True, exist_ok=True)
    with (out / "projection.lock").open("a") as lease:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        index, dispositions = [], Counter()
        for row in rows:
            if shutil.disk_usage(out).free < 10 * 1024**3:
                raise ValueError("10 GiB disk guard; resume the same projection later")
            review_path, assessment_path = Path(row["review_path"]), Path(row["assessment_path"])
            if any(private_root not in path.resolve().parents for path in (review_path, assessment_path)):
                raise ValueError("frozen source reference outside private research root")
            review = _checked(review_path, row["review_sha256"])
            saved = _checked(assessment_path, row["assessment_sha256"])
            oid = row["org_id"]
            if (review["org_id"] != oid or saved["org_id"] != oid
                    or review["assessment_sha256"] != row["assessment_sha256"]
                    or (review.get("source_result_sha256") is not None
                        and review["source_result_sha256"] != saved["source_result_sha256"])):
                raise ValueError("frozen organization/result bridge differs")
            target, assessment = json.loads(row["target"]), saved["assessment"]
            if target != targets.get(oid):
                raise ValueError("local target differs from frozen membership")
            old = [item for item in before["rows"] if item["org_id"] == oid]
            card = {
                "schema": "funder-evidence-experience/v1", "org_id": oid,
                "review_scope": "automated_source_audit; semantic_review_pending",
                "author": "agent:codex-rule-projection", "model_calls": 0,
                "before": {
                    "scope": "Limited local registry record, not a complete historical profile",
                    "organization": target["org_name"], "ein": target.get("ein"),
                    "website": target.get("website"), "city": target.get("city"), "state": target.get("state"),
                    "existing_before_image": {
                        "existing_before_images": old,
                        "exact_expected_state": {"org_id": oid, "existing_web_facts": old},
                        "observed_at": before["observed_at"],
                        "envelope_sha256": before["envelope_sha256"],
                        "baseline_path": str(before_path), "baseline_sha256": _sha(before_path),
                        "is_current_remote_state": False,
                    },
                },
                "after": {
                    "program_posture": None, "fit": None, "inquiry_next_step": None,
                    "before_investing_time": "Review legal entity, program, applicant, cycle and inquiry permission before relying on these leads.",
                    "website_observation": {
                        "state": "source_review_blocked" if review.get("error") else assessment.get("liveness", "unknown"),
                        "observed_at": review.get("live_observed_at"), "continuous_uptime": False,
                    },
                    "freshness": {
                        "page_modified_month_lead": review.get("latest_page_modified_month"),
                        "page_published_month_lead": review.get("latest_content_published_month"),
                        "site_last_updated_month": None,
                        "date_evidence": review.get("date_evidence", []),
                        "scope": "Page-scoped metadata leads; neither cycle dates nor copyright years date the whole website.",
                    },
                    "identity": {"mechanical_basis": review.get("identity"),
                                 "filing_bridge": review.get("filing_bridge"),
                                 "semantic_review": "pending", "current_standing": "not_checked"},
                    "unreviewed_leads": {
                        "disposition": review["disposition"],
                        "fit_and_inquiry": assessment.get("fit_and_inquiry_leads", {}),
                        "contact_pages": assessment.get("contact_page_candidates", []),
                        "contact_link_is_inquiry_permission": False,
                        "literal_passages": review.get("passages", []),
                        "strict_claim_observations_staged": row["claims"],
                        "pending_index": review.get("pending_index"),
                    },
                    "sources": {"urls": review.get("source_urls", []),
                                "snapshot_sha256s": review.get("source_hashes", []),
                                "result_sha256": saved["source_result_sha256"],
                                "source_review_path": str(review_path), "source_review_sha256": row["review_sha256"],
                                "assessment_path": str(assessment_path), "assessment_sha256": row["assessment_sha256"],
                                "licensing": "Publisher material remains private; per-source licensing review required"},
                    "conflicts": review.get("conflict_flags", []),
                    "source_review_error": review.get("error"),
                    "unknowns": ["Semantic fit and inquiry permission", "Whole-site last-update month",
                                 "Exact recent paid donation", "Current IRS standing", "Unvisited linked source terms"],
                    "unvisited_source_urls": review.get("unvisited_source_urls", []),
                },
                "application_gate": "Await separately requested application with fresh exact readback, semantic scope, licensing, duplicates, supersession and human review. This projection is not new research or qualified membership.",
                "status": "awaiting_separate_application", "semantic_review": "pending",
                "human_reviewed": False, "remote_applied": False, "published": False,
            }
            path = out / "cards" / oid[:2] / (oid + ".json")
            index.append({"org_id": oid, "path": str(path), "sha256": _immutable(path, card)})
            dispositions[review["disposition"]] += 1
        summary = {"schema": "funder-evidence-experience-manifest/v1", "source_run": str(run),
                   "source_manifest_sha256": _sha(run / "sweep.json"),
                   "members_sha256": manifest["members_sha256"], "source_inventory_sha256": manifest["source_inventory_sha256"],
                   "card_records": len(index), "dispositions": dict(dispositions),
                   "new_research_steps": 0, "new_claims": 0, "semantic_reviews": 0,
                   "fully_verified": 0, "human_reviewed": 0, "applied": 0, "published": 0,
                   "model_calls": 0, "network_calls": 0, "remote_mutations": 0,
                   "status": "awaiting_separate_application", "cards": index}
        _immutable(out / "manifest.json", summary)
    return {key: value for key, value in summary.items() if key != "cards"}
