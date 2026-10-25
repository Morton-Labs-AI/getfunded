"""One focused regression for escaped nomination and recipient-report dates."""
from datetime import date

def test_nomination_and_report_subjects():
    from funderdb.research.programs_v9 import date_events
    text = ('2026 nominations closed for submission on March 31st, 2026. '
            'We accept grant applications until April 3rd, 2026. '
            'If your organization was awarded funds, your final report will be due June 30th, 2026. '
            'Final reports accompany grant applications due July 1, 2026. '
            'Nominations open August 1, 2026 through August 31, 2026.')
    dates = date_events(text, date(2026,10,25))
    assert {(d['iso_date'],d['event_lead']) for d in dates} == {
        ('2026-03-31','other_date'),('2026-04-03','deadline'),('2026-06-30','other_date'),
        ('2026-07-01','deadline'),('2026-08-01','other_date'),('2026-08-31','other_date')}
    for d in dates:
        subject=d.get('activity_subject')
        if subject:
            assert text[subject['start_in_block']:subject['end_in_block']]==subject['excerpt']
