"""One regression for previously observed date/policy scope failures."""
from datetime import date

from funderdb.research.crawl import snapshot
from funderdb.research.evidence import checked_page
from funderdb.research.programs_v3 import extract_program_context


def test_application_window_and_conditional_invitation(tmp_path):
    body = '''<main><h1>Community Grants</h1>
    <p>Application period: September 1-30, 2026 (closes at midnight).</p>
    <p>The next review meeting is December 18, 2026. All applications must
    be received by December 11, 2026.</p>
    <p>If you are outside the service area, you must be invited to apply.
    We will not consider unsolicited grant applications.</p></main>'''
    ref = snapshot(tmp_path, {"kind": "page", "url": "https://example.org/grants",
                              "http_status": 200, "fetched_at": "2026-10-23T12:00:00+00:00",
                              "text": body})
    page = checked_page({"url": "https://example.org/grants", "snapshot": ref,
                         "extractor": "lxml-visible-text/v3"}, tmp_path)
    output = extract_program_context(page, date(2026, 10, 23))
    evidence = [e for g in output["program_contexts"] for e in g["evidence"]]
    events = {(d["iso_date"], d["event_lead"]) for e in evidence for d in e["dates"]}
    assert events == {("2026-09-01", "opening"), ("2026-09-30", "deadline"),
                      ("2026-12-18", "other_date"), ("2026-12-11", "deadline")}
    assertions = [p for e in evidence for p in e.get("policy_assertions", [])]
    invitation = next(p for p in assertions if p["kind"] == "invitation_only")
    assert invitation["conditional"] is True
    assert "outside the service area" in invitation["condition_text"]
    assert output["qualification"] == "not_assessed"
