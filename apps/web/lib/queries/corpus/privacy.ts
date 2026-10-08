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
 * Order matters: the instruction parts are removed FIRST and the rest is
 * checked for a person. "JANE DOE, SEE WEBSITE" is a person with an
 * instruction attached, and it is withheld; an earlier version classified it
 * as an instruction and published the name. Anything that carries an email
 * address or a phone number is withheld too: those belong in the contact
 * channels, which have their own publishability rules.
 *
 * The classifier is conservative: when in doubt it says "person" and the UI
 * shows "Not published". Pure, so it is unit tested
 * (tests/unit/search/privacy.test.ts).
 */

const ROLE_WORDS = new Set([
  "committee", "office", "officer", "officers", "director", "directors", "administrator", "administration",
  "manager", "management", "program", "programs", "grant", "grants", "grantmaking", "foundation", "fund",
  "trust", "trustees", "trustee", "board", "secretary", "president", "coordinator", "department", "dept",
  "staff", "team", "scholarship", "scholarships", "selection", "review", "attn", "attention", "c/o", "care",
  "executive", "chair", "chairman", "chairperson", "treasurer", "clerk", "agent", "counsel", "advisor",
  "advisors", "adviser", "advisers", "services", "service", "company", "co", "inc", "llc", "llp", "lp",
  "corporation", "corp", "bank", "association", "society", "church", "college", "university", "school",
  "hospital", "institute", "center", "centre", "ministry", "council", "club", "league", "trustco",
  "applications", "application", "inquiries", "inquiry", "requests", "request", "proposals", "proposal",
  "national", "community", "family", "memorial", "charitable", "united", "regional", "county", "city",
  "state", "fdn", "fnd", "funds", "giving", "philanthropy", "philanthropic", "endowment", "relations",
  "information", "info", "guidelines", "letter", "letters", "intent", "contact", "contacts", "person",
  "the", "of", "and", "for", "to", "at", "in", "on", "or", "a", "an", "&",
]);

/** Words that mark an instruction rather than a name. */
const INSTRUCTION_WORDS = new Set([
  "see", "visit", "apply", "applying", "online", "portal", "website", "web", "site", "email", "e-mail",
  "download", "submit", "submitted", "submission", "via", "through", "our", "available", "refer", "go",
  "please", "use", "form", "forms", "none", "not", "applicable", "n/a", "no", "accept", "accepted",
  "accepting", "unsolicited", "only", "by", "invitation", "mail", "send", "write", "call", "preselected",
  "pre-selected", "us",
]);

const URL_RE = /(?:https?:\/\/\S+|www\.\S+|\S+\.(?:org|com|net|edu|gov|us|io)(?:\/\S*)?)/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/;

/** A clause reads as an instruction when it names a website, an action, or "none / not applicable". */
const INSTRUCTION_CLAUSE_RE =
  /\b(?:website|web\s*site|www\.|https?:|e-?mail|apply|applications?\s+(?:are|should|must|may|can|online|available|accepted)|visit|see\b|online|portal|contact us|not applicable|n\/a|none|no applications|not accept|unsolicited|by invitation|download|submit|refer to|go to|please)/i;

export type ContactNameClass = "role" | "instruction" | "person" | "none";

export function classifyContactName(name: string | null | undefined): ContactNameClass {
  const raw = (name ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "none";

  // Email addresses and phone numbers never travel through this field.
  if (EMAIL_RE.test(raw) || PHONE_RE.test(raw)) return "person";

  // 1. Strip the instruction parts: URLs, then every clause that reads as an instruction.
  const withoutUrls = raw.replace(URL_RE, " ");
  const clauses = withoutUrls.split(/[,;:|]|\s[-–—]\s|\(|\)/).map((c) => c.trim()).filter(Boolean);
  const kept: string[] = [];
  let droppedInstruction = withoutUrls !== raw;
  for (const clause of clauses) {
    if (INSTRUCTION_CLAUSE_RE.test(clause)) {
      droppedInstruction = true;
      continue;
    }
    kept.push(clause);
  }

  // 2. What is left: a person, a role, or nothing.
  const tokens = kept
    .join(" ")
    .toLowerCase()
    .replace(/[.,;:()'"]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const personLike = tokens.filter((t) => !ROLE_WORDS.has(t) && !INSTRUCTION_WORDS.has(t) && !/^\d+$/.test(t));
  // A single leftover token is usually a surname-less label ("HARTFORD
  // GRANTS COMMITTEE"); two or more read like a person's name.
  if (personLike.length >= 2) return "person";
  if (tokens.length === 0) return droppedInstruction ? "instruction" : "none";
  return droppedInstruction && personLike.length === 0 && tokens.every((t) => INSTRUCTION_WORDS.has(t)) ? "instruction" : "role";
}

/** The name to show, or null when it must be withheld. */
export function publishableContactName(name: string | null | undefined): string | null {
  const cls = classifyContactName(name);
  if (cls === "role" || cls === "instruction") return (name ?? "").replace(/\s+/g, " ").trim();
  return null;
}
