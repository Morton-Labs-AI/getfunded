"""Versioned program-context retrieval, never qualification or approval.

Every signal is a literal, private source lead. A heading is a scope candidate,
not proof of a program identity. Old packet and text hashes remain unchanged.
"""
from __future__ import annotations

import re
from datetime import date

from lxml import html

from .crawl import read_snapshot
from .web_text import LEGACY_EXTRACTOR, visible_text

VERSION = "program-context/v2"
TOPIC = re.compile(r"grant|funding|scholarship|fellowship|financial assistance", re.I)
GENERIC = re.compile(r"^(?:how|who|what|when|where|why|step\b|eligib|application|apply|deadline|"
                     r"guideline|criteria|contact|question|faq|frequently|budget|report|timeline)", re.I)
POLICIES = {
    "paused": r"\bpaus\w*|\bon hiatus\b|\bsuspend\w*",
    "invitation_only": r"invitation[- ]only|by invitation|invited (?:organizations|applicants) only",
    "closed": r"applications? (?:are |is |currently |now )*(?:closed)|not (?:currently )?accepting",
    "not_accepted": r"do(?:es)? not accept|no unsolicited|not accept unsolicited",
    "open_assertion": r"applications? (?:are |is |currently |now |always )*open|now accepting|rolling basis",
    "inquiry_invitation": r"(?:contact|email|reach out|inquir\w*).{0,100}(?:grant|fund|eligib|question)|"
                          r"(?:grant|fund|eligib|question).{0,100}(?:contact|email|reach out|inquir)",
    "application_route": r"apply (?:now|today|for)|submit.{0,30}(?:application|letter of inquir)|application (?:form|portal)",
}
POLICIES = {k: re.compile(v, re.I) for k, v in POLICIES.items()}
MONTHS = {m.lower(): i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August",
     "September", "October", "November", "December"], 1)}
MONTH = "(?:" + "|".join(MONTHS) + ")"
DATES = re.compile(rf"\b(?:(?P<m>{MONTH})\s+(?P<d>\d{{1,2}})(?:st|nd|rd|th)?"
                   rf"(?:\s*[-–—]\s*(?P<end>\d{{1,2}}))?[,]?\s+(?P<y>20\d{{2}})|"
                   rf"(?P<d2>\d{{1,2}})\s+(?P<m2>{MONTH})[,]?\s+(?P<y2>20\d{{2}}))\b", re.I)
ANNUAL = re.compile(rf"\b{MONTH}\s+\d{{1,2}}(?:st|nd|rd|th)?\b", re.I)


def _excluded(node) -> bool:
    main = False
    for ancestor in [node, *node.iterancestors()]:
        if ancestor.tag in {"form", "blockquote", "script", "style", "noscript", "svg"}:
            return True
        if ancestor.tag == "main" or ancestor.get("role") == "main":
            main = True
        if not main and (ancestor.tag in {"nav", "header", "footer", "aside"}
                         or ancestor.get("role") in {"navigation", "banner", "contentinfo"}):
            return True
    return False


def _roles(text: str) -> list[str]:
    out = []
    incoming = bool(re.search(r"has been awarded|(?:we|foundation|association) (?:received|was awarded|has received)|grants? received", text, re.I))
    if incoming:
        out.append("incoming_or_third_party")
    negative = bool(re.search(r"(?:do|does|did|will) not (?:make|makes|award|provide|offer)|no (?:cash|financial) support|does not provide financial", text, re.I))
    if re.search(r"in[- ]kind|equipment (?:and training )?grant|software grant|not (?:a |offer )?cash grant|do not offer cash", text, re.I):
        out.append("in_kind")
    if not negative and re.search(r"scholarship|(?:grants? (?:to|for)|assistance.{0,35}(?:to|for)).{0,65}(?:individuals|families|patients|students|service members|people)|(?:families|service members).{0,100}(?:assistance|grants?)", text, re.I):
        out.append("individual_aid")
    if re.search(r"(?:employees|faculty|staff|district).{0,70}(?:eligib|apply)|(?:discount|financial aid).{0,70}(?:our services|training)|private operating foundation", text, re.I):
        out.append("restricted_internal")
    if re.search(r"donor.advised|grants? advised|fiscal sponsor|on behalf of.{0,30}(?:donor|partner)", text, re.I):
        out.append("intermediary")
    if not incoming and not negative and "in_kind" not in out and re.search(r"(?:we|foundation|fund|trusts?|board of trustees|(?-i:\b[A-Z]{2,8}\b)).{0,35}(?:award|make|provide|offer|distribute)\w*.{0,70}grants?|grants? (?:are )?(?:awarded|provided)|our grantmaking|subawards", text, re.I):
        out.append("outgoing_grant_lead")
    return out


def _event(text: str, hit, previous, part: str) -> str:
    prefix = text[:hit.start()]
    signals = [(m.start(), "deadline") for m in re.finditer(r"deadline|due\b|clos(?:e|es|ing)|until\b|postmarked|apply (?:by|before)", prefix, re.I)]
    signals += [(m.start(), "opening") for m in re.finditer(r"open|available|begin", prefix, re.I)]
    event = max(signals)[1] if signals else "other_date"
    if part == "range_end" and event == "opening":
        event = "deadline"
    if previous and re.fullmatch(r"\W*(?:to|through|until|and close (?:on|in))\W*", text[previous.end():hit.start()], re.I):
        event = "deadline"
    return event


def extract_program_context(page: dict, as_of: date, limit: int = 160) -> dict:
    """Inspect all eligible blocks, retain bounded exact-span evidence leads.

    The caller supplies an integrity-checked page. No year is borrowed from
    copyright/observation time. No date is promoted to an application deadline
    unless its clause explicitly describes closing/submission timing.
    """
    if not 1 <= limit <= 1000:
        raise ValueError("program evidence limit must be between 1 and 1000")
    raw = read_snapshot(page["snapshot"])
    doc = html.fromstring(raw["text"])
    groups, seen, matched = {}, set(), 0
    heading = scope = None
    for node in doc.xpath("//h1|//h2|//h3|//h4|//p|//li|//td|//div[not(*)]"):
        if _excluded(node):
            continue
        block = visible_text(node, page.get("extractor", LEGACY_EXTRACTOR))
        if node.tag in {"h1", "h2", "h3", "h4"}:
            heading = block[:240]
            if TOPIC.search(block) and not GENERIC.search(block):
                scope = heading
        if len(block) < 20 or block in seen:
            continue
        seen.add(block)
        offset = page["text"].find(block)
        if offset < 0:
            continue
        # A long block is inspected in full. Whole blocks preserve abbreviations, negation and date ranges;
        # no shortest-quote ranking discards a pause.
        for clause in re.finditer(r"[^\n]+", block):
            text = clause[0].strip()
            if len(text) < 20:
                continue
            policies = [key for key, pattern in POLICIES.items() if pattern.search(text)]
            if re.search(r"applications?(?: for .{1,50})? (?:will |period will )?open", text, re.I) and "open_assertion" not in policies:
                policies.append("open_assertion")
            if re.search(r"(?:no longer accept|not fund unsolicited|unable to consider unsolicited)", text, re.I) and "not_accepted" not in policies:
                policies.append("not_accepted")
            if re.search(r"except for those we invite|we will reach out to your organization", text, re.I) and "invitation_only" not in policies:
                policies.append("invitation_only")
            if re.search(r"(?:submit|complete|view|apply).{0,75}(?:grant request form|application|letter of inquiry|form|grant online)|grant portal", text, re.I) and "application_route" not in policies:
                policies.append("application_route")
            if "inquiry_invitation" in policies and not re.search(r"contact|email|e-mail|reach out|inquire (?:about|with)", text, re.I):
                policies.remove("inquiry_invitation")
            roles = _roles(text)
            date_hits = list(DATES.finditer(text))
            if not (policies or roles or date_hits or re.search(r"deadline|postmarked", text, re.I) or (TOPIC.search(block) and ANNUAL.search(text))):
                continue
            # Program scope is local to this page/heading, never organization-wide.
            key = scope or "unresolved_page_scope"
            group = groups.setdefault(key, {"scope_candidate": scope,
                "scope_basis": "literal_heading" if scope else "page_only; named_program_unresolved",
                "source_url": page["url"], "evidence": [], "matched_clauses": 0})
            matched += 1
            group["matched_clauses"] += 1
            if sum(len(g["evidence"]) for g in groups.values()) >= limit:
                continue
            start = offset + clause.start() + len(clause[0]) - len(clause[0].lstrip())
            dates = []
            for hit in date_hits:
                month = MONTHS[(hit["m"] or hit["m2"]).lower()]
                year = int(hit["y"] or hit["y2"])
                for part, day in [("range_start" if hit["end"] else "single", hit["d"] or hit["d2"]),
                                  *([( "range_end", hit["end"])] if hit["end"] else [])]:
                    try:
                        value = date(year, month, int(day))
                    except ValueError:
                        continue
                    previous = date_hits[date_hits.index(hit)-1] if date_hits.index(hit) else None
                    event = _event(text, hit, previous, part)
                    dates.append({"literal": hit[0], "iso_date": value.isoformat(), "part": part,
                                  "event_lead": event, "relative_to_as_of": "past" if value < as_of else
                                  "future" if value > as_of else "today", "timezone": None})
            group["evidence"].append({"source_url": page["url"],
                "snapshot_sha256": page["snapshot"]["sha256"], "text_sha256": page["text_sha256"],
                "start": start, "end": start + len(text), "excerpt": text,
                "section_heading": heading, "roles": roles, "policy_leads": policies, "dates": dates,
                "annual_date_without_year": bool(ANNUAL.search(text) and not date_hits),
                "relative_or_undated_deadline": bool(re.search(r"deadline|postmarked", text, re.I) and not date_hits),
                "locator": node.getroottree().getpath(node), "semantic_review": "pending"})
    for group in groups.values():
        evidence = group["evidence"]
        policy = {v for e in evidence for v in e["policy_leads"]}
        past = any(d["event_lead"] == "deadline" and d["relative_to_as_of"] == "past"
                   for e in evidence for d in e["dates"])
        group["conflict_leads"] = (["open_language_with_past_deadline; cycle_scope_review_required"]
            if "open_assertion" in policy and past else [])
        if "open_assertion" in policy and policy & {"paused", "closed", "not_accepted", "invitation_only"}:
            group["conflict_leads"].append("open_and_restrictive_language; program_scope_review_required")
        group["role_components"] = sorted({v for e in evidence for v in e["roles"]})
        group["omitted_clauses"] = group["matched_clauses"] - len(evidence)
    return {"schema": VERSION, "as_of": as_of.isoformat(), "observed_at": page["observed_at"],
            "source_url": page["url"], "program_contexts": list(groups.values()),
            "matched_clauses": matched, "retained_clauses": sum(len(g["evidence"]) for g in groups.values()),
            "source_license": page.get("source_license", "publisher_website"), "republishable": False,
            "qualification": "not_assessed", "application_status": "awaiting_separate_application",
            "human_reviewed": False, "whole_site_updated_month": None}
