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
                "evidence_cohort": evidence,
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
