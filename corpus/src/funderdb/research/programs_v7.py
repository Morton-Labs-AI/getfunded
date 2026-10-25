"""Explicit table geometry and event exclusions; all semantic/application gates remain."""
from __future__ import annotations

import re
from datetime import date
from lxml import html

from . import programs_v2 as previous
from . import programs_v5 as legacy
from .crawl import read_snapshot
from .program_tables_v2 import source_spans, table_grids, table_context, section_context
from .web_text import visible_text, LEGACY_EXTRACTOR

VERSION = 'program-context/v7'
SINGLE = legacy.SINGLE
NON_APPLICATION = re.compile(
    r'webinar|informational (?:session|meeting)|interview|invitation|notif\w*|announc\w*|'
    r'board meeting|board (?:review|decision)|review meeting|decisions?|'
    r'period of performance|project (?:period|start|end)|\bPOP\b|\bPhase\s+\d|'
    r'(?:deadline for )?donations?|fundrais\w*|portal (?:launch|migration|upgrade)', re.I)
APP_EVENT = re.compile(
    r'(?:application|proposal|LOI|letter of (?:intent|inquiry))[^.;!?]{0,35}(?:deadline|due|close|open|receiv|submit)|'
    r'(?:deadline|due|clos\w*|open\w*)[^.;!?]{0,35}(?:application|proposal|LOI)', re.I)


def _event(text, start, end, context, table_info):
    prefix = legacy._local(text, start)
    excluded = list(NON_APPLICATION.finditer(prefix))
    application = list(APP_EVENT.finditer(prefix))
    # A direct non-application event label outranks a broad section heading.
    suffix = re.match(r'\s*[-–—:,]?\s*(?:board meeting|review meeting|webinar|interview|notification)\b', text[end:], re.I)
    if (excluded and (not application or excluded[-1].start() > application[-1].start())) or suffix:
        return 'other_date', 'explicit_non_application_event', False
    local = bool(legacy.CLOSING.search(prefix) or legacy.OPENING.search(prefix) or legacy.REVIEW.search(prefix))
    if local or re.match(r'\s*[-–—:,]?\s*(?:is the )?(?:application |submission )?deadline\b', text[end:], re.I):
        return legacy._event(text, start, end), 'local_literal_context', False
    if context and not SINGLE.search(prefix) and not legacy.RANGE.search(prefix):
        return context['event_lead'], 'cited_structural_context', True
    return ('unknown' if table_info is not None else 'other_date'), 'unresolved_event_context', False


def date_events(text: str, as_of: date, context: dict | None = None, table_info: dict | None = None) -> list[dict]:
    events, occupied = [], []

    def add(hit, month, day, year, part, event, basis, inherited):
        try:
            value = date(int(year), legacy.MONTHS[month.lower().rstrip('.')], int(re.match(r'\d+', day)[0]))
        except (KeyError, ValueError):
            return
        item = {'literal': hit[0], 'start_in_block': hit.start(), 'end_in_block': hit.end(),
                'iso_date': value.isoformat(), 'part': part, 'event_lead': event,
                'relative_to_as_of': 'past' if value < as_of else 'future' if value > as_of else 'today',
                'timezone': None, 'event_scope': basis + '; semantic_review_pending'}
        if inherited:
            item['event_context'] = context
        events.append(item)

    for hit in legacy.RANGE.finditer(text):
        first, basis, inherited = _event(text, hit.start(), hit.end(), context, table_info)
        prefix = legacy._local(text, hit.start())
        window = re.search(r'application (?:period|window)|applications?.{0,45}(?:open|accept)|open.{0,45}applications?|'
                           r'\baccept(?:s|ing)?\s+(?:letters? of (?:intent|inquiry)|LOIs?|applications?|proposals?)'
                           r'(?:\s*\([^)]{1,30}\))?\s+from\s*$', prefix, re.I)
        if first == 'window':
            first, basis = 'opening', 'cited_application_window'
        if window and basis != 'explicit_non_application_event':
            first, basis, inherited = 'opening', 'literal_application_window', False
        last = 'deadline' if first == 'opening' else first
        add(hit, hit['m1'], hit['d1'], hit['y1'] or hit['y2'], 'range_start', first, basis, inherited)
        add(hit, hit['m2'] or hit['m1'], hit['d2'], hit['y2'], 'range_end', last, basis, inherited)
        occupied.append(hit.span())
    for hit in SINGLE.finditer(text):
        if any(a <= hit.start() < b for a, b in occupied):
            continue
        event, basis, inherited = _event(text, hit.start(), hit.end(), context, table_info)
        if event == 'window':
            event, basis, inherited = 'unknown', 'single_date_in_window_requires_review', False
        add(hit, hit['m'] or hit['month'], hit['d'] or hit['day'], hit['y'] or hit['year'],
            'single', event, basis, inherited)
    return events


def extract_program_context(page: dict, as_of: date, limit: int = 160) -> dict:
    if not 1 <= limit <= 1000:
        raise ValueError("program evidence limit must be between 1 and 1000")
    doc = html.fromstring(read_snapshot(page['snapshot'])['text'])
    for element in doc.xpath('//script|//style|//noscript|//svg'):
        element.drop_tree()
    spans = source_spans(doc, page)
    grids = table_grids(doc)
    groups, seen, heading, scope, matched = {}, set(), None, None, 0
    for node in doc.xpath('//h1|//h2|//h3|//h4|//p|//li|//td|//div[not(*)]'):
        if previous._excluded(node):
            continue
        if node.tag != 'td' and node.xpath('ancestor::td'):
            continue
        span = spans.get(node)
        if not span:
            continue
        text = span['excerpt']
        if node.tag in {'h1', 'h2', 'h3', 'h4'}:
            heading = text[:240]
            if previous.TOPIC.search(text) and not previous.GENERIC.search(text):
                scope = heading
        context, table_info = table_context(node, grids, spans)
        key_seen = (text, span['locator']) if table_info else text
        if (len(text) < 20 and not SINGLE.search(text)) or key_seen in seen:
            continue
        seen.add(key_seen)
        start = span['start']
        if table_info is None:
            context = section_context(node, spans)
        policies, dates, roles = legacy.policy_assertions(text), date_events(text, as_of, context, table_info), previous._roles(text)
        undated = bool(re.search(r'deadline|postmarked|received by|application period', text, re.I) and not dates)
        if not (policies or dates or roles or undated):
            continue
        key = (table_info.get('table_locator', 'unresolved_table') + ':row:' + str(table_info.get('row', '?'))) if table_info else scope or 'unresolved_page_scope'
        group = groups.setdefault(key, {'scope_candidate': None if table_info else scope,
            'scope_basis': 'literal_table_row; entity_and_program_review_pending' if table_info else 'literal_heading' if scope else 'page_only; named_program_unresolved',
            'table_attribution': table_info,
            'source_url': page['url'], 'evidence': [], 'matched_clauses': 0})
        matched += 1
        group['matched_clauses'] += 1
        if sum(len(g['evidence']) for g in groups.values()) >= limit:
            continue
        group['evidence'].append({'source_url': page['url'], 'snapshot_sha256': page['snapshot']['sha256'],
            'text_sha256': page['text_sha256'], 'start': start, 'end': start + len(text), 'excerpt': text,
            'section_heading': heading, 'table_attribution': table_info, 'roles': roles, 'policy_leads': sorted({p['kind'] for p in policies}),
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
