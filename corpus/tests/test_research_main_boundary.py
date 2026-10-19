"""Regression: malformed site navigation must not hide explicit main content."""
import hashlib
import unittest
from unittest.mock import patch

from lxml import html

from funderdb.research.sweep import substantive_passages


class MainContentBoundary(unittest.TestCase):
    def test_main_inside_navigation_retains_body_and_excludes_chrome(self):
        source = '''<html><body><header><nav>
          <p>We provide grants through navigation promotions.</p>
          <main><h1>Funding guidance</h1>
            <p>We provide grants to local nonprofit organizations.</p>
            <p>We do not accept unsolicited grant proposals.</p>
            <nav><p>We provide grants through inner navigation promotions.</p></nav>
            <form><p>We provide grants through this application form.</p></form>
            <blockquote><p>We provide grants, according to another organization.</p></blockquote>
            <footer><p>We provide grants through footer promotions.</p></footer>
          </main>
        </nav></header>
        <form><main><p>We provide grants through an outer application form.</p></main></form>
        </body></html>'''
        text = ' '.join(html.fromstring(source).text_content().split())
        page = {'url': 'https://example.org/guidance', 'text': text,
                'snapshot': {'sha256': hashlib.sha256(source.encode()).hexdigest()},
                'text_sha256': hashlib.sha256(text.encode()).hexdigest()}
        with patch('funderdb.research.sweep.envelope', return_value={'text': source}):
            passages, matched = substantive_passages(page)
        self.assertEqual([p['value'] for p in passages], [
            'We provide grants to local nonprofit organizations.',
            'We do not accept unsolicited grant proposals.',
        ])
        self.assertEqual(matched, 2)
        self.assertEqual(passages[0]['flags'], ['outgoing_role'])
        self.assertTrue(passages[1]['negative_policy_language'])
        for passage in passages:
            self.assertEqual(text[passage['start']:passage['end']], passage['value'])
            self.assertEqual(passage['section_heading'], 'Funding guidance')
