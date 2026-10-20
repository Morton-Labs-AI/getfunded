"""Regression for the crawler interruption during active-pool prioritization."""
import sqlite3
import unittest
from pathlib import Path
from tempfile import mkdtemp
from unittest.mock import patch

from funderdb.research import runner


class CheckpointContention(unittest.TestCase):
    def test_completed_crawl_checkpoint_survives_a_temporary_writer(self):
        # Retain the small reproduction database instead of deleting artifacts.
        path = Path(mkdtemp(prefix="funder-checkpoint-")) / "queue.sqlite3"
        with sqlite3.connect(path, timeout=0) as crawler, sqlite3.connect(path, timeout=0) as priority:
            crawler.execute("pragma journal_mode=wal")
            crawler.execute("create table organizations(org_id text primary key,state text,result_path text)")
            crawler.execute("insert into organizations values('org','running',null)")
            crawler.commit()
            priority.execute("begin immediate")
            waits = []

            def finish_priority_write(delay):
                waits.append(delay)
                priority.rollback()

            with patch.object(runner.time, "sleep", finish_priority_write):
                runner.checkpoint_write(crawler,
                    "update organizations set state=?,result_path=? where org_id=?",
                    ("evidence_ready", "saved-result.json", "org"))
            self.assertTrue(waits)
            self.assertEqual(crawler.execute("select state,result_path from organizations").fetchone(),
                             ("evidence_ready", "saved-result.json"))
