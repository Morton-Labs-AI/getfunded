"""Escaped false holds: source-declared aliases and separately named entities."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from funderdb.research.evidence import build_packet


class AliasScopeRegression(unittest.TestCase):
    def test_source_backed_alias_and_separate_declarations_keep_hard_holds(self):
        root = Path(tempfile.mkdtemp(prefix='funder-alias-scope-'))
        target = {'org_id': 'fixture', 'org_name': 'Example Energy Foundation',
                  'ein': '123456789', 'website': 'https://example.org/', 'c3_evidence': {}}
        def packet(markup, url='https://example.org/'):
            raw = {'kind': 'page', 'http_status': 200, 'url': url,
                   'fetched_at': '2026-10-20T00:00:00Z', 'text': markup}
            data = json.dumps(raw).encode(); digest = hashlib.sha256(data).hexdigest()
            p = root / (digest + '.json'); p.write_bytes(data)
            t = {**target, 'website': url}
            return build_packet(t, {**t, 'pages': [{'url': url, 'snapshot': {
                'path': str(p), 'sha256': digest}}]}, root / 'run', experimental_alias_scope=True)
        markup = '''<html><head><title>Home | Example Foundation</title></head><body>
          <p>Example Foundation is a registered 501(c)(3) organization. EIN 12-3456789.</p>
          </body></html>'''
        self.assertTrue(packet(markup)['identity_gate']['candidate_supported'])
        multi = markup.replace('</body>', '''<p>Second Charity is a 501(c)(3)
          organization. EIN 23-4567890.</p></body>''')
        self.assertTrue(packet(multi)['identity_gate']['candidate_supported'])
        directory = packet(markup, 'https://www.guidestar.org/profile/example')
        self.assertFalse(directory['identity_gate']['candidate_supported'])
        self.assertFalse(directory['identity_gate']['filing_fallback_allowed'])
        temporal = markup.replace('organization.', 'organization. Former entity dissolved,')
        self.assertFalse(packet(temporal)['identity_gate']['candidate_supported'])
        wrong = markup.replace('12-3456789', '34-5678901')
        self.assertFalse(packet(wrong)['identity_gate']['candidate_supported'])
