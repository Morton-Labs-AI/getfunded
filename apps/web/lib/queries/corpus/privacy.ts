/**
 * Part XV contact-name rule.
 *
 * Form 990-PF Part XV has a box for "the name of the person to whom
 * applications should be addressed". Filers put three kinds of thing there:
 * a named person ("JANE DOE, TRUSTEE"), a role or office ("GRANTS COMMITTEE",
 * "THE FOUNDATION OFFICE"), or an instruction ("SEE WEBSITE", "APPLY ONLINE
 * AT ..."). We publish the second and third kinds and withhold the first,
 * matching the corpus rule that named individuals' contact details are never
 * republished even though the filing is public.
 *
 * The classifier is conservative: when in doubt it says "person" and the UI
 * shows "Not published". Pure, so it is unit tested.
 */

const ROLE_WORDS = new Set([
  "committee", "office", "officer", "officers", "director", "directors", "administrator", "administration",
  "manager", "management", "program", "programs", "grant", "grants", "grantmaking", "foundation", "fund",
  "trust", "trustees", "trustee", "board", "secretary", "president", "coordinator", "department", "dept",
  "staff", "team", "scholarship", "scholarships", "selection", "review", "attn", "attention", "c/o", "care",
  "executive", "chair", "chairman", "chairperson", "treasurer", "clerk", "agent", "counsel", "advisor",
  "advisors", "adviser", "advisers", "services", "service", "company", "co", "inc", "llc", "llp", "lp",
  "corporation", "corp", "bank", "association", "society", "church", "college", "university", "school",
  "hospital", "institute", "center", "centre", "ministry", "council", "club", "league", "league", "trustco",
  "applications", "application", "inquiries", "inquiry", "requests", "request", "proposals", "proposal",
  "the", "of", "and", "for", "to", "at", "in", "on", "or", "a", "an", "&",
]);

const INSTRUCTION_RE =
  /\b(website|web\s*site|www\.|https?:|\.org\b|\.com\b|\.net\b|\.edu\b|e-?mail|email|apply|applications?|visit|see\b|online|portal|contact us|not applicable|n\/a|none|no applications|not accept)/i;

export type ContactNameClass = "role" | "instruction" | "person" | "none";

export function classifyContactName(name: string | null | undefined): ContactNameClass {
  const raw = (name ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "none";
  if (INSTRUCTION_RE.test(raw)) return "instruction";
  const tokens = raw
    .toLowerCase()
    .replace(/[.,;:()'"]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return "none";
  const personLike = tokens.filter((t) => !ROLE_WORDS.has(t) && !/^\d+$/.test(t));
  // A single leftover token is usually a surname-less label ("HARTFORD
  // GRANTS COMMITTEE"); two or more read like a person's name.
  if (personLike.length >= 2) return "person";
  return "role";
}

/** The name to show, or null when it must be withheld. */
export function publishableContactName(name: string | null | undefined): string | null {
  const cls = classifyContactName(name);
  if (cls === "role" || cls === "instruction") return (name ?? "").replace(/\s+/g, " ").trim();
  return null;
}
