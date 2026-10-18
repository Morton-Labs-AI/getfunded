"""Regression: an invalid publisher href must not invalidate intact evidence."""
import unittest
from datetime import date
from pathlib import Path
from tempfile import mkdtemp

from funderdb.research.active_funders import assess
from funderdb.research.crawl import snapshot
from funderdb.research.evidence import checked_page


class MalformedContactLink(unittest.TestCase):
    def test_bad_contact_href_keeps_valid_live_source(self):
        root = Path(mkdtemp(prefix="funder-invalid-link-"))
        ref = snapshot(root / "snapshots", {
            "kind": "page", "http_status": 200,
            "url": "https://example.org/", "requested_url": "https://example.org/",
            "fetched_at": "2026-10-18T10:00:00+00:00",
            "text": '<html><body>We provide grants to community organizations. '
                    'Applications and eligibility guidance are reviewed separately. '
                    'EIN: 12-3456789 <a href="http://[invalid">Contact</a></body></html>',
        })
        page = checked_page({"url": "https://example.org/", "snapshot": ref}, root)
        result = assess({"pages": [page], "candidate_website": "https://example.org/",
                         "identity_evidence": "exact_ein_observed; semantic_identity_review_pending",
                         "state": "awaiting_claim_review"}, date(2026, 10, 18))
        self.assertEqual(result["liveness"], "live_content_observed_within_7_days")
        self.assertEqual(len(result["invalid_contact_links"]), 1)
        self.assertEqual(result["contact_page_candidates"], [])
