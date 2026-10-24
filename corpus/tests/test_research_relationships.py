"""Escaped cross-publisher false positive; explicit alias/relationship gates."""
import unittest
from lxml import html
from funderdb.research.web_text import ein_mentions, visible_text
from funderdb.research.source_names import publisher_names
from funderdb.research.identity import identity_gate


class RelationshipRegression(unittest.TestCase):
    def test_conflicting_publisher_needs_relation_and_aliases_need_literal_proof(self):
        def page(markup):
            doc = html.fromstring(markup); text = visible_text(doc, 'lxml-visible-text/v6')
            return {'url': 'https://example.org/', 'text': text, 'text_sha256': 'fixture',
                    'snapshot': {'sha256': 'fixture'}, 'publisher_names': publisher_names(doc),
                    'ein_mentions': ein_mentions(text, 'lxml-visible-text/v6', doc)}
        target = {'org_name': 'Example Foundation', 'ein': '123456789',
                  'website': 'https://example.org/'}
        first = page('<title>Example Foundation</title><p>Example Foundation is a 501(c)(3) organization. EIN 12-3456789.</p>')
        second = page('<title>Team</title><p>Other Charity is a 501(c)(3) organization. EIN 23-4567890.</p>')
        gate = lambda t, p: identity_gate(t, p, version='source-identity-gates/v4')
        self.assertFalse(gate(target, [first, second])['candidate_supported'])
        relation = page('<p>Example Foundation supports Other Charity through its education program.</p>')
        self.assertTrue(gate(target, [first, second, relation])['candidate_supported'])
        dba = page('<title>Example Museum</title><p>ABC Inc. dba Example Museum is a 501(c)(3) nonprofit. EIN 12-3456789.</p>')
        self.assertTrue(gate({**target, 'org_name': 'ABC INC'}, [dba])['candidate_supported'])
        acronym = page('<title>Example Learning Future Foundation</title><p>ELF Foundation is a 501(c)(3) organization. EIN 12-3456789.</p>')
        self.assertTrue(gate({**target, 'org_name': 'Example Learning Future Foundation'}, [acronym])['candidate_supported'])
        self.assertFalse(gate({**target, 'org_name': 'Example Litigation Future Foundation'}, [acronym])['candidate_supported'])
        self.assertFalse(gate({**target, 'website': 'https://guidestar.org/'}, [first])['candidate_supported'])
        self.assertFalse(gate({**target, 'ein': '345678901'}, [first])['candidate_supported'])
