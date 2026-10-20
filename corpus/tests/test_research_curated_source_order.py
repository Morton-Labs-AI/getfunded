"""Regression: requested source gaps must precede older curated links."""
import unittest

from funderdb.research.crawl import crawl_org


class CuratedSourceOrder(unittest.TestCase):
    def test_new_requested_guideline_survives_the_page_budget(self):
        root = "https://example.org/"
        guideline = root + "grant-opportunities/research/guidelines"
        older_report = root + "grant-report"

        class SavedPages:
            def __init__(self):
                self.requested = []

            def page(self, url):
                self.requested.append(url)
                body = (f'<a href="{older_report}">Grant report</a>'
                        if url == root else "Requested source content")
                return {"url": url, "text": f"<html><body>{body}</body></html>",
                        "fetched_at": "2026-10-18T20:00:00+00:00"}, {}

        web = SavedPages()
        result = crawl_org({"org_id": "source-order-regression",
                            "org_name": "Saved source ordering regression",
                            "website": root,
                            "research_urls": [guideline, older_report]}, web, max_pages=2)

        self.assertEqual(web.requested, [root, guideline])
        self.assertEqual(result["pages_attempted"], 2)

