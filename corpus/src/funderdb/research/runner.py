"""A bounded concurrent worker for the complete durable research campaign."""
from __future__ import annotations

import fcntl
import json
import shutil
import sqlite3
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path

from ..config import get_settings
from .crawl import PublicWeb, crawl_org, now
from .pipeline import queue, report, sha256, write_json


def checkpoint_write(db, statement, parameters):
    """Keep a completed crawl across temporary local writer contention."""
    deadline = time.monotonic() + 180
    while True:
        try:
            db.execute(statement, parameters)
            db.commit()
            return
        except sqlite3.OperationalError as exc:
            code = getattr(exc, "sqlite_errorcode", 0) & 0xff
            db.rollback()
            if code not in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED) or time.monotonic() >= deadline:
                raise
            time.sleep(0.25)


def prepare(db):
    db.commit()
    db.execute("pragma journal_mode=wal")
    db.execute("pragma cache_size=-65536")
    columns = {r[1] for r in db.execute("pragma table_info(organizations)")}
    if "priority" not in columns:
        db.execute("begin immediate")
        db.execute("alter table organizations add column priority integer not null default 50")
        db.execute("""update organizations set priority=case json_extract(target,'$.org_type')
            when 'private_foundation' then 10 when 'gov_agency' then 20
            when 'vc' then 20 when 'pe' then 20 when 'investment_adviser' then 30
            when 'company' then 30 when 'fund' then 40 else 50 end
            where json_extract(target,'$.org_type') in
              ('private_foundation','gov_agency','vc','pe','investment_adviser','company','fund')""")
        db.execute("create index research_priority on organizations(state,priority,attempts,org_id)")
    db.commit()


def run_worker(run: Path, workers: int = 8, max_pages: int = 6,
               follow: bool = False, minimum_free_gib: int = 10, echo=print) -> dict:
    if not (run / "queue.sqlite3").exists():
        raise ValueError("initialize the complete campaign first")
    web = PublicWeb(run / "snapshots", get_settings().http_user_agent)
    with (run / "worker.lock").open("w") as lease:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with queue(run) as db, ThreadPoolExecutor(max_workers=workers) as pool:
            prepare(db)
            checkpoint_write(db, "update organizations set state='pending' where state='running'", ())
            pending = {}
            completed, last_report = 0, 0.0
            while True:
                disk_ok = shutil.disk_usage(run).free >= minimum_free_gib * 1024 ** 3
                while disk_ok and len(pending) < workers:
                    row = db.execute("""select * from organizations where state='pending'
                        order by priority,attempts,org_id limit 1""").fetchone()
                    if row is None:
                        break
                    target = json.loads(row["target"])
                    checkpoint_write(db, "update organizations set state='running',attempts=attempts+1,updated_at=? where org_id=?",
                                     (now(), row["org_id"]))
                    pending[pool.submit(crawl_org, target, web, max_pages)] = dict(row)
                if not pending and (not follow or not disk_ok):
                    status = report(run)
                    status["worker_state"] = "low_disk" if not disk_ok else "no_pending_websites"
                    write_json(run / "worker-status.json", status)
                    return status
                if pending:
                    finished, _ = wait(pending, timeout=15, return_when=FIRST_COMPLETED)
                    for future in finished:
                        row = pending.pop(future)
                        # Unexpected implementation errors leave a recoverable running row.
                        result = future.result()
                        output = run / "results" / row["org_id"][:2] / (row["org_id"] + ".json")
                        previous = Path(row["result_path"]) if row["result_path"] else output
                        if previous.exists():
                            archive = run / "history" / row["org_id"][:2] / f"{row['org_id']}-{sha256(previous)}.json"
                            archive.parent.mkdir(parents=True, exist_ok=True)
                            previous.replace(archive)
                        write_json(output, result)
                        checkpoint_write(db, "update organizations set state=?,updated_at=?,result_path=? where org_id=?",
                                         (result["status"], now(), str(output), row["org_id"]))
                        completed += 1
                else:
                    time.sleep(15)
                if time.monotonic() - last_report >= 60:
                    status = report(run)
                    status.update(worker_state="crawling" if pending else "awaiting_discovery",
                                  workers=workers, completed_this_process=completed,
                                  free_gib=round(shutil.disk_usage(run).free / 1024 ** 3, 1))
                    write_json(run / "worker-status.json", status)
                    echo(json.dumps(status), flush=True)
                    last_report = time.monotonic()
