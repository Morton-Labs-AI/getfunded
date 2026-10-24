"""Local aggregate dashboard; never exposes raw snapshots or database credentials."""
from __future__ import annotations

import fcntl
import json
import logging
import shutil
import sqlite3
import threading
import time
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def _json(path: Path) -> dict:
    return json.loads(path.read_text())


def _batch_capacity(active: dict | None, sweep: dict | None) -> dict:
    """Explain the next-wave dependency using dated aggregate snapshots only."""
    unknown = {"state": "unavailable", "note": "Next-wave capacity is unavailable."}
    if not active or not sweep:
        return unknown
    pool, screened = active.get("search_pool_size"), active.get("processed_search_candidates")
    waiting, minimum = sweep.get("new_live_cases_waiting_for_wave"), sweep.get("minimum_wave_size")
    remaining = sweep.get("remaining")
    ages = (active.get("status_age_seconds"), sweep.get("status_age_seconds"))
    if (any(type(n) is not int or n < 0 for n in (pool, screened, waiting, minimum, remaining))
            or pool == 0 or screened > pool or minimum == 0
            or any(type(age) is not int or not -60 <= age < 180 for age in ages)):
        return {**unknown, "note": "Next-wave capacity needs fresh, complete pool and audit snapshots."}
    result = {"pool_candidates_remaining": pool - screened,
              "unseen_live_pairs": waiting, "minimum_wave_size": minimum,
              "shortfall": max(0, minimum - waiting),
              "pool_as_of": active["as_of"], "sweep_as_of": sweep["as_of"]}
    if remaining:
        state, note = "auditing_frozen_sources", "A frozen source wave still has audits remaining."
    elif waiting >= minimum:
        state, note = "enough_sources_for_next_wave", "Enough unseen live-source pairs are available for the next wave."
    elif screened < pool:
        state, note = "screening_current_pool", "Current pool candidates remain to be screened; the next wave is not yet full."
    else:
        state, note = "more_eligible_sources_needed", (
            "The current eligible pool is fully screened and cannot fill the next wave from its available live sources. "
            "Discover and attribute new eligible websites or acquire genuinely new source evidence. "
            "This is a pool snapshot, not proof that every organization has been researched.")
    return {**result, "state": state, "note": note}


def _requested_continuation(run: Path, inventory: str, timestamp: datetime) -> dict:
    """Keep a requested multi-wave target separate from frozen membership."""
    start, progress = _json(run / "request-start.json"), _json(run / "progress.json")
    baseline = start["inherited_request_baseline"]
    size = start["requested_candidates"]
    if (type(size) is not int or size != 20000 or progress["requested_candidates"] != size
            or baseline["prior_sweep_status"]["source_inventory_sha256"] != inventory):
        raise ValueError("requested continuation does not match this inventory or target")
    first = Path(start["previous_pending_continuation"]).resolve()
    if first.parent != run.parent:
        raise ValueError("component continuation must remain in the same private sweep")
    audited = cards = 0
    waves = set(baseline["existing_waves"])
    for component in (first, run / "second-wave"):
        proof = component / "selected-completion-verified.json"
        if not proof.exists():
            continue
        detail = _json(proof)
        wave = Path(detail["completion_wave"]).resolve()
        if wave.parent != run.parent / "waves" or str(wave) in waves:
            raise ValueError("requested continuation repeats a prior wave")
        manifest = _json(wave / "sweep.json")
        if (manifest["source_inventory_sha256"] != inventory or manifest["members"] != 10000
                or detail["audits_done"] != 10000 or detail["reviews_hash_checked"] != 10000):
            raise ValueError("component lacks its completed source-audit proof")
        waves.add(str(wave))
        audited += 10000
        projection = component / "bulk-evidence-cards" / "manifest.json"
        if projection.exists():
            projected = _json(projection)
            if (projected["source_run"] != str(wave)
                    or projected["source_inventory_sha256"] != inventory
                    or projected["members_sha256"] != manifest["members_sha256"]
                    or projected["card_records"] != 10000):
                raise ValueError("card projection does not match its source wave")
            cards += 10000
    summary_path = run / "manual-summary.json"
    manual = _json(summary_path) if summary_path.exists() else {}
    return {"requested_candidates": size, "source_audits_verified": audited,
            "source_audits_remaining": size - audited, "private_card_projections": cards,
            "unseen_live_pairs_waiting": progress.get("unseen_live_pairs_waiting_for_next_wave"),
            "bounded_interpretations": manual.get("bounded_interpretations"),
            "manual_research_steps": manual.get("manual_research_steps"),
            "manual_strict_preparations": manual.get("strict_preparations"),
            "stage": progress["stage"], "qualified": 0, "applied": 0, "human_reviewed": 0,
            "published": 0,
            "status_age_seconds": round((timestamp - datetime.fromisoformat(progress["at"])).total_seconds()),
            "completion_note": "Requested target, completed source audits, private card projections and bounded "
                "interpretations are separate counts. An audit or card does not qualify a funder. "
                "Organization rechecks and repeated inputs remain in the cumulative source-review panel."}


def _selected_batch(run: Path, inventory: str, timestamp: datetime) -> dict:
    """Expose only counts for a fixed acquisition/source-audit completion batch."""
    manifest = _json(run / "selected-cohort.json")
    size = manifest["members"]
    if manifest["source_inventory_sha256"] != inventory or not isinstance(size, int) or size < 1:
        raise ValueError("selected batch does not match this inventory")
    progress = _json(run / "completion-coordinator-status.json")
    stage, states = progress["stage"], progress["states"]
    if stage == "waiting_for_terminal_selected_acquisitions":
        acquisition, audited = states, 0
    elif stage == "auditing_frozen_selected10000":
        acquisition = _json(run / "frozen-completion-wave.json")["states"]
        if sum(states.values()) != size:
            raise ValueError("selected source-audit count differs from frozen membership")
        audited = states.get("done", 0)
    else:
        raise ValueError("unknown selected-batch progress stage")
    if sum(acquisition.values()) != size or any(n < 0 for n in acquisition.values()):
        raise ValueError("selected acquisition count differs from frozen membership")
    completed = run / "selected-completion-verified.json"
    if completed.exists():
        final = _json(completed)
        if (final["selected_candidates"] != size or final["audits_done"] != size
                or final["reviews_hash_checked"] != size
                or final["selected_members_equal_frozen_members"] is not True
                or final["cumulative_sweep"]["source_inventory_sha256"] != inventory):
            raise ValueError("selected completion lacks its membership/integrity checks")
        stage, audited = "selected_source_audit_complete", size
        progress = final
    if not 0 <= audited <= size:
        raise ValueError("selected audit count exceeds frozen membership")
    ready, blocked = acquisition.get("evidence_ready", 0), acquisition.get("blocked", 0)
    return {"as_of": progress["as_of"], "members": size, "stage": stage,
            "acquisitions_terminal": ready + blocked, "acquisitions_with_evidence": ready,
            "acquisitions_blocked": blocked, "acquisitions_remaining": size - ready - blocked,
            "source_audits_done": audited, "source_audits_remaining": size - audited,
            "fully_verified": 0,
            "status_age_seconds": round((timestamp - datetime.fromisoformat(
                progress["as_of"].replace("Z", "+00:00"))).total_seconds()),
            "completion_note": "Acquisition outcomes and source audits are separate from qualified-funder admission. "
                "Blocked sources retain their access dependencies; a completed audit does not resolve every identity or program gap."}


def _classification_summary(run: Path, inventory: str, population: int) -> dict:
    """Aggregate allowlist; frozen classifications never become vetted counts."""
    try:
        detail = _json(run / "classification-status.json")
        count = detail["registry_classified"]
        if (detail["inventory_sha256"] != inventory or detail["population"] != population
                or detail["inventory_integrity_complete"] is not True
                or type(count) is not int or count != population
                or detail["tax_subsection_observed"] + detail["tax_unknown"] != count
                or not 0 <= detail["bounded_agent_reviews"] <= count):
            raise ValueError("classification inventory or count mismatch")
        summary = {k: detail[k] for k in ("schema", "as_of", "population", "registry_classified",
            "registry_types", "tax_subsection_observed", "subsection03_observed", "tax_unknown",
            "bounded_agent_reviews", "funding_role_unresolved", "fully_vetted", "human_reviewed",
            "remote_applied", "published", "repeated_identifier_rows", "repeated_review_records", "completion_note")}
        for file, key, fields in [
            ("pilot-results.json", "pilot", ("members", "evaluated", "field_agreement_organizations",
                "field_agreement_percent", "semantic_accuracy", "completion_note")),
            ("candidate-review-summary.json", "candidate_review", ("frozen_members", "reviewed",
                "remaining", "role_dispositions", "inquiry_dispositions", "qualified", "completion_note"))]:
            if (run / file).exists():
                data = _json(run / file)
                if data["inventory_sha256"] != inventory:
                    raise ValueError("pilot/review inventory mismatch")
                summary[key] = {k: data[k] for k in fields if k in data}
        return {"state": "available", **summary}
    except (OSError, ValueError, KeyError, TypeError):
        return {"state": "unavailable", "completion_note": "Classification counters unavailable; existing audit and qualification counts remain separate."}


class Tracker:
    def __init__(self, run: Path):
        self.run = run.resolve()
        self.database = self.run / "queue.sqlite3"
        if not self.database.is_file():
            raise ValueError("initialize a research campaign first")
        self.history = self.run / "tracker-observations.jsonl"
        self.points: deque = deque(maxlen=750)
        if self.history.exists():
            with self.history.open() as stream:
                for line in stream:
                    try:
                        self.points.append(json.loads(line))
                    except json.JSONDecodeError:
                        # A partial append remains on disk, never discarded or reinterpreted.
                        continue
        self.lock = threading.Lock()
        self.cached: dict | None = None
        self.cached_at = 0.0

    def snapshot(self) -> dict:
        with self.lock:
            if self.cached and time.monotonic() - self.cached_at < 15:
                return self.cached
            status = _json(self.run / "worker-status.json")
            # Read-only SQLite URI: no queue changes, migrations or implicit creation.
            with sqlite3.connect(self.database.as_uri() + "?mode=ro", uri=True,
                                 timeout=5) as db:
                db.execute("pragma query_only=on")
                db.execute("begin")
                settings = dict(db.execute("select key,value from campaign"))
                stages = [
                    {"stage": s, "records": n, "organizations": orgs}
                    for s, n, orgs in db.execute(
                        "select stage,count(*),count(distinct org_id) "
                        "from research_steps group by stage")
                ]
                touched = db.execute(
                    "select count(distinct org_id) from research_steps").fetchone()[0]
                recent = [
                    {"organization": name, "stage": stage, "outcome": outcome,
                     "recorded_at": at}
                    for name, stage, outcome, at in db.execute(
                        "select json_extract(o.target,'$.org_name'),s.stage,s.outcome,"
                        "s.recorded_at from research_steps s join organizations o "
                        "on o.org_id=s.org_id order by s.recorded_at desc limit 30")
                ]
            denominator = int(settings["denominator"])
            if (status.get("input_sha256") != settings["input_sha256"]
                    or sum(status["states"].values()) != denominator):
                raise ValueError("worker snapshot does not match the campaign inventory")
            timestamp = datetime.now(timezone.utc)
            age = (timestamp - datetime.fromisoformat(
                status["as_of"].replace("Z", "+00:00"))).total_seconds()
            locked = None
            try:
                with (self.run / "worker.lock").open("r") as lease:
                    try:
                        fcntl.flock(lease, fcntl.LOCK_SH | fcntl.LOCK_NB)
                        locked = False
                        fcntl.flock(lease, fcntl.LOCK_UN)
                    except BlockingIOError:
                        locked = True
            except OSError:
                pass
            config_path = self.run / "tracker-config.json"
            config = _json(config_path) if config_path.exists() else {}
            evidence = None
            if config.get("evidence_run"):
                evidence_run = Path(config["evidence_run"]).resolve()
                manifest_path = evidence_run / "cohort.json"
                evidence_path = evidence_run / "evidence-status.json"
                if manifest_path.exists() and evidence_path.exists():
                    manifest, detail = _json(manifest_path), _json(evidence_path)
                    if (manifest.get("source_inventory_sha256") != settings["input_sha256"]
                            or manifest.get("members_sha256") != detail.get("cohort_sha256")):
                        raise ValueError("evidence cohort does not match this inventory")
                    # Aggregate allowlist only: no private paths, excerpts or proposals.
                    evidence = {k: detail[k] for k in (
                        "as_of", "cohort_size", "processed_members", "remaining_initial_pass",
                        "states", "identity_evidence", "page_checks", "candidate_submissions",
                        "remote_applied", "human_reviewed", "published", "fully_verified_organizations",
                        "model_calls_by_evidence_worker", "model_tokens_by_evidence_worker",
                        "rules_phase", "completion_note", "worker_state") if k in detail}
                    evidence["status_age_seconds"] = round((timestamp - datetime.fromisoformat(
                        detail["as_of"].replace("Z", "+00:00"))).total_seconds())
                    try:
                        with (evidence_run / "evidence-worker.lock").open("r") as lease:
                            try:
                                fcntl.flock(lease, fcntl.LOCK_SH | fcntl.LOCK_NB)
                                evidence["lease_held"] = False
                                fcntl.flock(lease, fcntl.LOCK_UN)
                            except BlockingIOError:
                                evidence["lease_held"] = True
                    except OSError:
                        evidence["lease_held"] = None
            active = None
            if config.get("active_funders_run"):
                active_run = Path(config["active_funders_run"]).resolve()
                active_path = active_run / "active-status.json"
                if active_path.exists():
                    detail = _json(active_path)
                    if detail.get("source_inventory_sha256") != settings["input_sha256"]:
                        raise ValueError("active-funder pool does not match this inventory")
                    active = {k: detail[k] for k in (
                        "as_of", "target_qualified_funders", "search_pool_size", "processed_search_candidates",
                        "states", "dimensions", "website_criteria_candidates", "semantically_verified_funders",
                        "target_remaining_unverified", "remote_applied", "human_reviewed", "published",
                        "model_calls", "worker_state", "completion_note") if k in detail}
                    active["status_age_seconds"] = round((timestamp - datetime.fromisoformat(
                        detail["as_of"].replace("Z", "+00:00"))).total_seconds())
                    try:
                        with (active_run / "active-worker.lock").open("r") as lease:
                            try:
                                fcntl.flock(lease, fcntl.LOCK_SH | fcntl.LOCK_NB)
                                active["lease_held"] = False
                                fcntl.flock(lease, fcntl.LOCK_UN)
                            except BlockingIOError:
                                active["lease_held"] = True
                    except OSError:
                        active["lease_held"] = None
            sweep = None
            if config.get("sweep_run"):
                sweep_run = Path(config["sweep_run"]).resolve()
                sweep_path = sweep_run / "sweep-status.json"
                if sweep_path.exists():
                    detail = _json(sweep_path)
                    if detail.get("source_inventory_sha256") != settings["input_sha256"]:
                        raise ValueError("bulk sweep does not match this inventory")
                    sweep = {k: detail[k] for k in (
                        "as_of", "batch_size", "processed", "remaining", "states", "dispositions",
                        "initial_batch_size", "initial_processed", "distinct_organizations_audited", "rechecks_completed",
                        "identity_evidence", "pages_checked", "candidate_proposals", "candidate_claim_records",
                        "distinct_proposal_inputs", "repeated_identical_proposal_inputs",
                        "minimum_wave_size",
                        "new_live_cases_waiting_for_wave",
                        "cases_with_conflict_flags", "fully_verified", "human_reviewed", "remote_applied",
                        "published", "worker_state", "completion_note") if k in detail}
                    sweep["status_age_seconds"] = round((timestamp - datetime.fromisoformat(
                        detail["as_of"].replace("Z", "+00:00"))).total_seconds())
                    with (sweep_run / "sweep-worker.lock").open("a") as lease:
                        try:
                            fcntl.flock(lease, fcntl.LOCK_SH | fcntl.LOCK_NB)
                            sweep["lease_held"] = False
                            fcntl.flock(lease, fcntl.LOCK_UN)
                        except BlockingIOError:
                            sweep["lease_held"] = True
            requested = None
            if config.get("requested_continuation_run"):
                requested_run = Path(config["requested_continuation_run"]).resolve()
                if self.run.parent not in requested_run.parents:
                    raise ValueError("requested continuation must remain inside private research")
                requested = _requested_continuation(requested_run, settings["input_sha256"], timestamp)
                if requested["source_audits_remaining"]:
                    requested["capacity"] = _batch_capacity(active, sweep)
            selected = None
            if config.get("selected_cohort_run"):
                selected_run = Path(config["selected_cohort_run"]).resolve()
                if self.run.parent not in selected_run.parents:
                    raise ValueError("selected batch must remain inside private research")
                selected = _selected_batch(selected_run, settings["input_sha256"], timestamp)
            classification = None
            if config.get("classification_run"):
                classification_run = Path(config["classification_run"]).resolve()
                if self.run.parent not in classification_run.parents:
                    raise ValueError("classification ledger must remain inside private research")
                classification = _classification_summary(classification_run, settings["input_sha256"], denominator)
            point = {
                "as_of": status["as_of"], "attempted": status["crawl_attempted"],
                "evidence_ready": status["states"].get("evidence_ready", 0),
                "research_organizations": touched,
            }
            if not self.points or point != self.points[-1]:
                # Preserve every dated observation; never truncate previous evidence.
                with self.history.open("a") as stream:
                    stream.write(json.dumps(point) + "\n")
                self.points.append(point)
            result = {
                "observed_at": timestamp.isoformat(), "queue_as_of": status["as_of"],
                "population": denominator, "inventory_sha256": settings["input_sha256"],
                "states": status["states"], "attempted": status["crawl_attempted"],
                "research_organizations": touched, "research_stages": stages,
                "fully_cross_verified": None,
                "classification": classification,
                "evidence_cohort": evidence,
                "active_funders": active,
                "bulk_sweep": sweep,
                "selected_batch": selected,
                "requested_continuation": requested,
                "human_reviewed_by_workflow": status.get("human_reviewed"),
                "published_by_workflow": status.get("published_by_this_workflow"),
                "worker": {
                    "reported_state": status.get("worker_state", "unknown"),
                    "workers": status.get("workers"),
                    "lease_held": locked, "snapshot_age_seconds": round(age),
                    "fresh": -60 <= age < 180,
                    "free_gib": round(shutil.disk_usage(self.run).free / 1024**3, 1),
                },
                "requested_work_window": {
                    k: config[k] for k in ("started_at", "continue_through") if k in config
                },
                "recent": recent, "history": list(self.points),
                "completion_note": (
                    "Acquired pages and agent research steps are not cross-verification. "
                    "No completed-profile approval is recorded by this workflow. "
                    "Blocked and unresolved organizations remain in the full denominator."
                ),
            }
            self.cached, self.cached_at = result, time.monotonic()
            return result


def serve(run: Path, port: int = 8768) -> None:
    tracker = Tracker(run)
    page = Path(__file__).with_name("tracker.html").read_bytes()
    stop = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.headers.get("Host") not in (f"127.0.0.1:{port}", f"localhost:{port}"):
                self.send_error(403)
                return
            if self.path == "/":
                body, kind = page, "text/html; charset=utf-8"
            elif self.path == "/api/status":
                try:
                    body = json.dumps(tracker.snapshot()).encode()
                except (OSError, ValueError, KeyError, sqlite3.Error):
                    self.send_error(503, "Campaign snapshot unavailable; retained evidence is unchanged")
                    return
                kind = "application/json"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy",
                             "default-src 'none'; script-src 'self' 'unsafe-inline'; "
                             "style-src 'self' 'unsafe-inline'; connect-src 'self'; "
                             "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args):
            pass

    def sample():
        while not stop.is_set():
            try:
                tracker.snapshot()
            except (OSError, ValueError, KeyError, sqlite3.Error) as error:
                logging.warning("Tracker snapshot unavailable: %s", type(error).__name__)
            stop.wait(60)

    with (run / "tracker.lock").open("a") as lease, \
            ThreadingHTTPServer(("127.0.0.1", port), Handler) as server:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        threading.Thread(target=sample, daemon=True).start()
        try:
            server.serve_forever(poll_interval=0.5)
        finally:
            stop.set()
