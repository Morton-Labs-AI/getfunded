"""Escaped directory/placeholder/table errors must not become identity support."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from funderdb.research.evidence import build_packet, checked_page


class IdentityGatesRegression(unittest.TestCase):
    def test_scoped_table_identity_and_version_preservation(self):
        root = Path(tempfile.mkdtemp(prefix='funder-identity-gates-'))
        raw = {'kind': 'page', 'http_status': 200, 'url': 'https://www.guidestar.org/profile/example',
               'fetched_at': '2026-10-20T00:00:00Z', 'text': '''<html><body>
          <p>Example Foundation EIN 12-3456789.</p><p>EIN 00-0000000</p>
          <table><tr><th>Organization</th><th>EIN</th><th>ZIP</th></tr>
          <tr><td>Other Foundation</td><td>23-4567890</td><td>345678901</td></tr>
          <tr><td>Another Foundation</td><td>34-5678901</td><td>456789012</td></tr></table>
          <table><tr><th>Phone</th><th>ZIP</th></tr><tr><td>567890123</td><td>678901234</td></tr></table>
          </body></html>'''}
        source = root / 'source.json'; source.write_text(json.dumps(raw))
        ref = {'path': str(source), 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()}
        page = {'url': raw['url'], 'snapshot': ref}
        target = {'org_id': 'fixture', 'ein': '123456789', 'org_name': 'Example Foundation',
                  'website': raw['url'], 'c3_evidence': {}}
        packet = build_packet(target, {**target, 'pages': [page]}, root / 'run')
        self.assertEqual({m['ein'] for m in packet['pages'][0]['ein_mentions']},
                         {'123456789', '234567890', '345678901'})
        self.assertFalse(packet['identity_gate']['candidate_supported'])
        self.assertIn('directory_or_shared_platform', packet['identity_gate']['blockers'])
        self.assertFalse(packet['identity_gate']['filing_fallback_allowed'])
        tables = [m for m in packet['pages'][0]['ein_mentions'] if m.get('method') == 'explicit_ein_table_column']
        self.assertEqual({m['entity_label'] for m in tables}, {'Other Foundation', 'Another Foundation'})
        for m in packet['pages'][0]['ein_mentions']:
            self.assertEqual(packet['pages'][0]['text'][m['start']:m['end']], m['excerpt'])
        legacy = checked_page({**page, 'extractor': 'lxml-visible-text/v2'}, root)
        self.assertIn('000000000', {m['ein'] for m in legacy['ein_mentions']})
        self.assertEqual(checked_page(legacy, root)['text_sha256'], legacy['text_sha256'])
