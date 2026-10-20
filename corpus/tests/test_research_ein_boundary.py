"""Escaped EIN-label and DOM-boundary regression; no real publisher fixtures."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from funderdb.research.crawl import extract
from funderdb.research.evidence import build_packet, checked_page
from funderdb.research.web_text import CURRENT_EXTRACTOR


class EINBoundaryRegression(unittest.TestCase):
    def test_label_boundaries_and_immutable_citation_versions(self):
        markup = '''<html><body><p>Our EIN is 12-3456789.</p>
          <p>What is your nonprofit EIN or tax ID number? 23-4567890</p>
          <p>EIN 34-5678901</p><div>bottom of page</div>
          <p>EIN: 45-<span>6789012</span></p><p>EIN: 56-78901234</p>
          <p>Tax ID 67-8901234abc</p><p>Phone: 78-9012345</p>
          <script>EIN: 89-0123456</script><!-- EIN: 90-1234567 -->
          <p>General guidance remains unknown.</p></body></html>'''
        expected = {'123456789', '234567890', '345678901', '456789012'}
        raw = {'kind': 'page', 'http_status': 200, 'url': 'https://example.org/',
               'fetched_at': '2026-10-20T00:00:00Z', 'text': markup}
        directory = tempfile.mkdtemp(prefix="funder-ein-regression-")
        root = Path(directory)
        snapshot = root / 'snapshot.json'
        snapshot.write_text(json.dumps(raw))
        ref = {'path': str(snapshot),
               'sha256': hashlib.sha256(snapshot.read_bytes()).hexdigest()}
        page = {'url': raw['url'], 'snapshot': ref}
        target = {'org_id': 'fixture', 'org_name': 'Fixture', 'ein': '123456789',
                  'website': raw['url'], 'c3_evidence': {}}
        packet = build_packet(target, {**target, 'pages': [page]}, root / 'run')
        current = packet['pages'][0]
        self.assertEqual({m['ein'] for m in current['ein_mentions']}, expected)
        self.assertEqual(current['extractor'], CURRENT_EXTRACTOR)
        self.assertIn('34-5678901 bottom', current['text'])
        self.assertIn('45-6789012', current['text'])
        self.assertEqual(packet['identity_evidence'],
                         'conflicting_or_multiple_eins; identity_review_required')
        for mention in current['ein_mentions']:
            self.assertEqual(current['text'][mention['start']:mention['end']],
                             mention['excerpt'])
        self.assertEqual(checked_page(current, root)['text_sha256'],
                         current['text_sha256'])
        legacy = checked_page(page, root)
        self.assertEqual(legacy['extractor'], 'lxml-visible-text/v1')
        self.assertIn('34-5678901bottom', legacy['text'])
        self.assertEqual(checked_page(legacy, root), legacy)
        self.assertNotEqual(current['text_sha256'], legacy['text_sha256'])
        with self.assertRaises(ValueError):
            checked_page({**page, 'extractor': 'unrecognized/v99'}, root)
        crawled = extract(raw, ref)
        self.assertEqual({m['value'] for m in crawled['ein_mentions']}, expected)
        self.assertEqual(crawled['extractor'], current['extractor'])
