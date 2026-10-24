"""Local date-event and conditional-policy leads; explicit review gates remain.

Versions 1/2 stay immutable. This version never turns a conditional invitation,
future opening, expired deadline or review meeting into an open-current claim.
"""
from __future__ import annotations

import re
from datetime import date

from lxml import html

from . import programs_v2 as previous
from .crawl import read_snapshot
from .web_text import LEGACY_EXTRACTOR, visible_text

VERSION = "program-context/v3"
MONTHS = {**previous.MONTHS, **{k[:3]: v for k, v in previous.MONTHS.items()}}
MONTH = r"(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Sept\.?|Oct\.?|Nov\.?|Dec\.?)"
MONTHS["sept"] = 9
DAY = r"\d{1,2}(?:st|nd|rd|th)?"
WEEKDAY = r"(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[,]?\s+)?"
RANGE = re.compile(rf"\b(?P<m1>{MONTH})\s+(?P<d1>{DAY})(?:,?\s+(?P<y1>20\d{{2}}))?"
                   rf"\s*(?:[-–—]|to|through|until)\s*{WEEKDAY}(?:(?P<m2>{MONTH})\s+)?"
                   rf"(?P<d2>{DAY}),?\s+(?P<y2>20\d{{2}})\b", re.I)
SINGLE = re.compile(rf"\b(?:(?P<m>{MONTH})\s+(?P<d>{DAY}),?\s+(?P<y>20\d{{2}})|"
                    rf"(?P<day>{DAY})\s+(?P<month>{MONTH}),?\s+(?P<year>20\d{{2}}))\b", re.I)
CLOSING = re.compile(r"deadline|\bdue\b|clos(?:e|es|ing)|\buntil\b|postmarked|"
                     r"(?:receiv\w*|submit\w*|complet\w*|apply|applications?).{0,35}\b(?:by|before)\b", re.I)
OPENING = re.compile(r"\bopen\w*|\bavailable|\bbegin\w*|\bstart\w*", re.I)
REVIEW = re.compile(r"review (?:meeting|date)|meeting.{0,35}scheduled|decisions? (?:on|by)|announc\w*|project (?:start|period)", re.I)
BREAK = re.compile(r"[;!?]|\.(?=\s+[A-Z])")


def _local(text: str, position: int) -> str:
    """Keep the containing sentence; preserve time/month abbreviations."""
    cuts = [m.end() for m in BREAK.finditer(text[:position])
            if not re.search(r"(?:\bp\.?m|\ba\.?m|\bJan|\bFeb|\bMar|\bApr|\bAug|\bSep|\bSept|\bOct|\bNov|\bDec)\.$", text[:m.end()], re.I)]
    return text[cuts[-1] if cuts else 0:position]


def _event(text: str, start: int, end: int) -> str:
    prefix = _local(text, start)
    signals = [(m.start(), kind) for pattern, kind in
               [(CLOSING, "deadline"), (OPENING, "opening"), (REVIEW, "other_date")]
               for m in pattern.finditer(prefix)]
    if signals:
        return max(signals)[1]
    # Explicit post-date labels: "March 1, 2027 application deadline".
    suffix = text[end:end + 65]
    if re.match(r"\s*[-–—:,]?\s*(?:is the )?(?:application |submission )?deadline\b", suffix, re.I):
        return "deadline"
    return "other_date"


def date_events(text: str, as_of: date) -> list[dict]:
    events, occupied = [], []
    def add(hit, month, day, year, part, event):
        try:
            value = date(int(year), MONTHS[month.lower().rstrip('.')], int(re.match(r"\d+", day)[0]))
        except (KeyError, ValueError):
            return
        events.append({"literal": hit[0], "iso_date": value.isoformat(), "part": part,
                       "event_lead": event, "relative_to_as_of": "past" if value < as_of else
                       "future" if value > as_of else "today", "timezone": None,
                       "event_scope": "local_literal_context; semantic_review_pending"})
    for hit in RANGE.finditer(text):
        first = _event(text, hit.start(), hit.end())
        application_window = bool(re.search(r"application (?:period|window)|applications?.{0,45}(?:open|accept)|open.{0,45}applications?", _local(text, hit.start()), re.I))
        if application_window:
            first = "opening"
        last = "deadline" if first == "opening" else first
        add(hit, hit['m1'], hit['d1'], hit['y1'] or hit['y2'], "range_start", first)
        add(hit, hit['m2'] or hit['m1'], hit['d2'], hit['y2'], "range_end", last)
        occupied.append(hit.span())
    for hit in SINGLE.finditer(text):
        if any(start <= hit.start() < end for start, end in occupied):
            continue
        add(hit, hit['m'] or hit['month'], hit['d'] or hit['day'], hit['y'] or hit['year'],
            "single", _event(text, hit.start(), hit.end()))
    return events


def policy_assertions(text: str) -> list[dict]:
    """Keep restriction conditions, not an organization-wide posture."""
    patterns = {
        "paused": r"\bpaus\w*|on hiatus|suspend\w*",
        "invitation_only": r"invitation[- ]only|by invitation|(?:only|exclusively) invited|"
                           r"must be invited|except (?:for )?those we invite|"
                           r"(?:previously funded|specifically invited).{0,70}(?:apply|letter)|"
                           r"(?:may receive|receive|requires?) an invitation.{0,40}(?:proposal|apply)|"
                           r"we will reach out to your organization",
        "not_accepted": r"(?:do|does|will) not (?:accept|consider|review)(?:, review or consider)?[^.!?]{0,45}unsolicited|"
                        r"not accept unsolicited|no unsolicited|no longer accept|not fund unsolicited|unable to consider unsolicited",
        "closed": r"applications? (?:are |is |currently |now )*closed|not (?:currently )?accepting applications",
        "open_assertion": r"applications?(?: for [^.!?]{1,60})? (?:are |is |currently |now |always |will |period will )*open|"
                          r"now accepting (?:grant )?applications|rolling basis|applications?[^.!?]{0,70}(?:throughout the year|year.round)",
        "inquiry_invitation": r"(?:please )?(?:contact|e-mail|email|reach out|inquire with)[^.!?]{0,140}",
        "application_route": r"(?:submit|complete|send|view|log in)[^.!?]{0,90}(?:application|letter of inquir|grant request form)|"
                             r"(?:apply for|online (?:form|application)|application (?:form|portal)|grant portal)",
    }
    conditions = list(re.finditer(r"\b(?:if|unless|except|only (?:for|after)|outside|prior to)\b[^.!?]{0,250}", text, re.I))
    out = []
    for kind, pattern in patterns.items():
        for hit in re.finditer(pattern, text, re.I):
            local = _local(text, hit.start())
            if kind == "application_route" and re.search(r"(?:do not|don't|not (?:eligible|permitted) to)\s*(?:fill out |submit |complete |apply )?[^.!?]{0,45}$", local, re.I):
                continue
            if kind == "inquiry_invitation" and re.search(r"\bwe (?:will |may )?$", local, re.I):
                continue
            condition = next((c[0] for c in reversed(conditions) if c.start() <= hit.start()
                              and hit.start() - c.start() < 350), None)
            out.append({"kind": kind, "start_in_block": hit.start(), "end_in_block": hit.end(),
                        "assertion_text": hit[0], "conditional": bool(condition),
                        "condition_text": condition, "scope": "this_source_block; program_and_eligibility_review_required",
                        "temporal_mode": "future_or_unspecified" if kind == "open_assertion" and
                        re.search(r"will open|opens? (?:on|in)|next", text, re.I) else "literal_assertion"})
    return out


def extract_program_context(page: dict, as_of: date, limit: int = 160) -> dict:
    if not 1 <= limit <= 1000:
        raise ValueError("program evidence limit must be between 1 and 1000")
    doc = html.fromstring(read_snapshot(page['snapshot'])['text'])
    groups, seen, heading, scope, matched = {}, set(), None, None, 0
    for node in doc.xpath('//h1|//h2|//h3|//h4|//p|//li|//td|//div[not(*)]'):
        if previous._excluded(node):
            continue
        text = visible_text(node, page.get('extractor', LEGACY_EXTRACTOR))
        if node.tag in {'h1', 'h2', 'h3', 'h4'}:
            heading = text[:240]
            if previous.TOPIC.search(text) and not previous.GENERIC.search(text):
                scope = heading
        if len(text) < 20 or text in seen:
            continue
        seen.add(text)
        start = page['text'].find(text)
        if start < 0:
            continue
        policies, dates, roles = policy_assertions(text), date_events(text, as_of), previous._roles(text)
        undated = bool(re.search(r'deadline|postmarked|received by|application period', text, re.I) and not dates)
        if not (policies or dates or roles or undated):
            continue
        key = scope or 'unresolved_page_scope'
        group = groups.setdefault(key, {'scope_candidate': scope,
            'scope_basis': 'literal_heading' if scope else 'page_only; named_program_unresolved',
            'source_url': page['url'], 'evidence': [], 'matched_clauses': 0})
        matched += 1
        group['matched_clauses'] += 1
        if sum(len(g['evidence']) for g in groups.values()) >= limit:
            continue
        group['evidence'].append({'source_url': page['url'], 'snapshot_sha256': page['snapshot']['sha256'],
            'text_sha256': page['text_sha256'], 'start': start, 'end': start + len(text), 'excerpt': text,
            'section_heading': heading, 'roles': roles, 'policy_leads': sorted({p['kind'] for p in policies}),
            'policy_assertions': policies, 'dates': dates, 'annual_date_without_year': bool(previous.ANNUAL.search(text) and not dates),
            'relative_or_undated_deadline': undated, 'locator': node.getroottree().getpath(node), 'semantic_review': 'pending'})
    for group in groups.values():
        evidence = group['evidence']
        policies = {x for e in evidence for x in e['policy_leads']}
        group['conflict_leads'] = []
        if 'open_assertion' in policies and any(d['event_lead'] == 'deadline' and d['relative_to_as_of'] == 'past' for e in evidence for d in e['dates']):
            group['conflict_leads'].append('open_language_with_past_deadline; cycle_scope_review_required')
        if 'open_assertion' in policies and policies & {'paused', 'closed', 'not_accepted', 'invitation_only'}:
            group['conflict_leads'].append('open_and_restrictive_language; program_scope_review_required')
        group['role_components'] = sorted({x for e in evidence for x in e['roles']})
        group['omitted_clauses'] = group['matched_clauses'] - len(evidence)
    return {'schema': VERSION, 'as_of': as_of.isoformat(), 'observed_at': page['observed_at'],
        'source_url': page['url'], 'program_contexts': list(groups.values()), 'matched_clauses': matched,
        'retained_clauses': sum(len(g['evidence']) for g in groups.values()),
        'source_license': page.get('source_license', 'publisher_website'), 'republishable': False,
        'qualification': 'not_assessed', 'application_status': 'awaiting_separate_application',
        'human_reviewed': False, 'whole_site_updated_month': None}
