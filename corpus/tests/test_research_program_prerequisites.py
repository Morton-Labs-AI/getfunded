"""One regression for the escaped LOI/header/prerequisite failures."""
from datetime import date
from funderdb.research.crawl import snapshot
from funderdb.research.evidence import checked_page
from funderdb.research.programs_v5 import extract_program_context


def test_loi_heading_deadline_and_invitation_prerequisite(tmp_path):
    body = '''<main><section><h2>Community grants</h2>
    <p>We accept Letters of Intent (LOI) from February 2, 2027 through April 17, 2027.</p>
    <p><strong>Deadlines for Applications</strong></p><ul>
    <li>September 4, 2027 for the October 25, 2027 Board Meeting.</li></ul>
    <h3>Other events</h3><p>Our celebration is November 10, 2027.</p>
    <p>Applicants must receive an invitation before submitting an application.</p>
    <table><tr><th>Application deadline</th><th>Board review</th></tr>
    <tr><td>January 7, 2028</td><td>February 19, 2028</td></tr></table>
    </section></main>'''
    ref = snapshot(tmp_path, {'kind':'page','url':'https://example.org/grants',
        'http_status':200,'fetched_at':'2026-10-25T12:00:00+00:00','text':body})
    page = checked_page({'url':'https://example.org/grants','snapshot':ref,
                         'extractor':'lxml-visible-text/v3'},tmp_path)
    out = extract_program_context(page,date(2026,10,25))
    evidence = [e for g in out['program_contexts'] for e in g['evidence']]
    events = {(d['iso_date'],d['event_lead']) for e in evidence for d in e['dates']}
    assert events == {('2027-02-02','opening'),('2027-04-17','deadline'),
        ('2027-09-04','deadline'),('2027-10-25','other_date'),
        ('2027-11-10','other_date'),('2028-01-07','deadline'),('2028-02-19','other_date')}
    invitations = [a for e in evidence for a in e['policy_assertions'] if a['kind']=='invitation_only']
    assert any(a['conditional'] and 'before submitting' in a['condition_text'] for a in invitations)
    for e in evidence:
        for d in e['dates']:
            if d.get('event_context'):
                c=d['event_context'];assert page['text'][c['start']:c['end']]==c['excerpt']
    assert out['qualification']=='not_assessed'
