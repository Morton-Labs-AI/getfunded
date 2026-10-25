"""One focused regression for escaped recognition and nested schedule failures."""
from datetime import date
from funderdb.research.crawl import snapshot
from funderdb.research.evidence import checked_page

def test_award_scope_and_nested_schedule(tmp_path):
    from funderdb.research.programs_v10 import extract_program_context
    body = '''<main><section><div><div><h6>Grant Request Deadlines</h6></div>
    <div><p>February 1, 2027</p><p>March 1, 2027</p></div></div>
    <div><div><h6>Grants Committee Meetings</h6></div><div><p>March 3, 2027</p></div></div>
    <div><h6>Eligibility</h6></div><div><p>March 4, 2027</p></div></section>
    <p>Excellence Awards Submissions Deadline: April 1, 2027. Submissions recognize excellence in performance and are considered for nomination.</p>
    <p>Research Award Deadline: April 2, 2027. This award recognizes excellence in research. The recipient receives a $750 honorarium and travel stipend.</p>
    <p>Grant applications are due May 1, 2027.</p></main>'''
    ref=snapshot(tmp_path,{'kind':'page','url':'https://example.org/programs','http_status':200,'fetched_at':'2026-10-25T12:00:00+00:00','text':body})
    p=checked_page({'url':'https://example.org/programs','snapshot':ref,'extractor':'lxml-visible-text/v3'},tmp_path)
    result=extract_program_context(p,date(2026,10,25));e=[z for g in result['program_contexts'] for z in g['evidence']]
    actual={(d['iso_date'],d['event_lead']) for z in e for d in z['dates']}
    assert actual=={('2027-02-01','deadline'),('2027-03-01','deadline'),('2027-03-03','other_date'),('2027-03-04','other_date'),('2027-04-01','other_date'),('2027-04-02','deadline'),('2027-05-01','deadline')}
    for z in e:
        for d in z['dates']:
            for cue in d.get('award_scope',{}).get('cues',[]):
                assert z['excerpt'][cue['start_in_block']:cue['end_in_block']]==cue['excerpt']
            ctx=d.get('event_context')
            if ctx:assert p['text'][ctx['start']:ctx['end']]==ctx['excerpt']
