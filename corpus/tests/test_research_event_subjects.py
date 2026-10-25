"""One regression for escaped invitation-role and non-grant deadline failures."""
from datetime import date
from funderdb.research.crawl import snapshot
from funderdb.research.evidence import checked_page
from funderdb.research.programs_v8 import extract_program_context


def test_invitation_eligibility_and_non_grant_deadlines(tmp_path):
    body = '''<main><h1>Community grants</h1><h2>Submission Deadlines</h2><ul>
    <li>Full Research Proposal (by invitation): July 13, 2027.</li>
    <li>Invitation to submit full grant application: November 30, 2027.</li>
    <li>Invitations will be sent to applicants on December 1, 2027.</li></ul>
    <p>Volunteer committee nominations were due by May 1, 2027.</p>
    <p>Applications for volunteer positions are due by May 2, 2027.</p>
    <p>Staff job applications must be received by May 3, 2027.</p>
    <p>Donations must be received by December 31, 2027.</p>
    <p>Volunteer organizations may submit grant applications by May 4, 2027.</p>
    <p>By invitation only, full grant applications must be submitted by May 5, 2027.</p>
    <table><tr><th>Application deadline (by invitation)</th><th>Invitation notification</th></tr>
    <tr><td>June 1, 2027</td><td>April 1, 2027</td></tr></table></main>'''
    ref=snapshot(tmp_path,{'kind':'page','url':'https://example.org/grants','http_status':200,
        'fetched_at':'2026-10-25T12:00:00+00:00','text':body})
    page=checked_page({'url':'https://example.org/grants','snapshot':ref,'extractor':'lxml-visible-text/v3'},tmp_path)
    out=extract_program_context(page,date(2026,10,25));e=[z for g in out['program_contexts'] for z in g['evidence']]
    dates={(d['iso_date'],d['event_lead']) for z in e for d in z['dates']}
    assert dates=={('2027-07-13','deadline'),('2027-11-30','other_date'),('2027-12-01','other_date'),
        ('2027-05-01','other_date'),('2027-05-02','other_date'),('2027-05-03','other_date'),
        ('2027-12-31','other_date'),('2027-05-04','deadline'),('2027-05-05','deadline'),
        ('2027-06-01','deadline'),('2027-04-01','other_date')}
    for z in e:
        for d in z['dates']:
            for q in d.get('eligibility_qualifiers',[]):
                assert z['excerpt'][q['start_in_block']:q['end_in_block']]==q['excerpt']
    assert out['qualification']=='not_assessed'
