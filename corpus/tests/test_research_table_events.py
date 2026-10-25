"""One regression for escaped merged-cell and non-application event attribution."""
from datetime import date
from funderdb.research.crawl import snapshot
from funderdb.research.evidence import checked_page
from funderdb.research.programs_v7 import extract_program_context


def test_merged_headers_and_non_application_events(tmp_path):
    body = '''<main><h1>Research Grants</h1>
    <table><thead><tr><th rowspan="2">Program</th><th colspan="2">Application deadlines</th>
    <th rowspan="2">Board decision</th></tr><tr><th>Round one</th><th>Round two</th></tr></thead>
    <tbody><tr><th scope="row">Community projects</th><td>March 6, 2027</td>
    <td>July 2, 2027</td><td>August 9, 2027</td></tr></tbody></table>
    <h2>Deadlines</h2><ul><li>Informational webinar: October 29, 2026.</li>
    <li>LOI submission deadline: November 12, 2026.</li>
    <li>Invitation to submit full grant application: November 30, 2026.</li>
    <li>Deadline to submit full application: January 11, 2027.</li></ul>
    <p>Phase 1 Period of Performance: April 1, 2027 – March 31, 2029.</p>
    <p>Phase 2: 1 year, starting anytime during Phase 1, or no later than September 30, 2029.</p>
    <table><tr><th>Online Letter of Inquiry Due</th><th>Application Window</th><th>Recipient Follow-up Info Due</th></tr>
    <tr><td>January 7, 2028</td><td>April 1 - May 1, 2028</td><td>June 7, 2028</td></tr></table>
    <p>We accept LOIs from February 2, 2027 through April 17, 2027.</p></main>'''
    ref = snapshot(tmp_path, {'kind':'page','url':'https://example.org/grants',
        'http_status':200,'fetched_at':'2026-10-25T12:00:00+00:00','text':body})
    page=checked_page({'url':'https://example.org/grants','snapshot':ref,'extractor':'lxml-visible-text/v3'},tmp_path)
    out=extract_program_context(page,date(2026,10,25));evidence=[e for g in out['program_contexts'] for e in g['evidence']]
    actual={(d['iso_date'],d['event_lead']) for e in evidence for d in e['dates']}
    assert actual=={('2027-03-06','deadline'),('2027-07-02','deadline'),('2027-08-09','other_date'),
        ('2026-10-29','other_date'),('2026-11-12','deadline'),('2026-11-30','other_date'),
        ('2027-01-11','deadline'),('2027-04-01','other_date'),('2029-03-31','other_date'),
        ('2029-09-30','other_date'),('2027-02-02','opening'),('2027-04-17','deadline'),('2028-01-07','deadline'),
        ('2028-04-01','opening'),('2028-05-01','deadline'),('2028-06-07','other_date')}
    table_events=[d for e in evidence for d in e['dates'] if d['iso_date'] in {'2027-03-06','2027-07-02'}]
    assert all(d['event_context']['basis']=='table_cell_grid' for d in table_events)
    for e in evidence:
        assert page['text'][e['start']:e['end']]==e['excerpt']
        for d in e['dates']:
            if d.get('event_context'):
                c=d['event_context'];assert page['text'][c['start']:c['end']]==c['excerpt']
    assert out['qualification']=='not_assessed'
