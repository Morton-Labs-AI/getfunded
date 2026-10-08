/**
 * Built-in nonprofit templates and the merge-field renderer. Pure.
 *
 * Honesty rules baked in:
 *  - A merge field with no value is NOT silently dropped and NOT guessed. It
 *    renders as a visible `[add: field]` marker and is reported in `missing`,
 *    so a draft can never be approved with a hole in it (see `findPlaceholders`).
 *  - Templates state only what the workspace knows about itself. Nothing in a
 *    template claims that the funder is interested, has invited an application,
 *    or has reviewed anything.
 *
 * Workspace templates (knowledge kind 'boilerplate') use the same fields and
 * the same renderer; see lib/outreach/boilerplate.ts.
 */

export const MERGE_FIELDS = [
  "contact_first_name",
  "contact_full_name",
  "contact_title",
  "funder_name",
  "funder_city",
  "funder_state",
  "org_name",
  "org_mission",
  "org_website",
  "program_area",
  "ask_amount",
  "sender_name",
  "sender_title",
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

export const MERGE_FIELD_HELP: Record<MergeField, string> = {
  contact_first_name: "The contact's first name, or their full name when it is a role like \"Grants Office\".",
  contact_full_name: "The contact's full name as you entered it.",
  contact_title: "The contact's title.",
  funder_name: "The funder's name from its filings.",
  funder_city: "The funder's city from its filings.",
  funder_state: "The funder's state from its filings.",
  org_name: "Your organization's name (Settings → Organization).",
  org_mission: "Your mission statement (Settings → Organization).",
  org_website: "Your website (Settings → Organization).",
  program_area: "The program you are writing about. Type it in the composer.",
  ask_amount: "The amount you are asking for, if you have one. Type it in the composer.",
  sender_name: "Your name, as shown on your account.",
  sender_title: "Your title. Type it in the composer.",
};

export type MergeValues = Partial<Record<MergeField, string | null | undefined>>;

export const TEMPLATE_KEYS = ["introduction", "loi_follow_up", "thank_you"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export type Template = {
  key: TemplateKey | string;
  name: string;
  /** One line a nonprofit can read to choose the template. */
  when: string;
  subject: string;
  body: string;
  /** True for the three built-ins; false for workspace templates. */
  builtIn: boolean;
};

/**
 * The three built-ins. Plain, short, and honest: no claims about the funder's
 * interest, no invented deadlines, no "as discussed" unless the writer adds it.
 */
export const BUILT_IN_TEMPLATES: readonly Template[] = [
  {
    key: "introduction",
    name: "Introduction",
    when: "A first note to a funder you have not written to before.",
    subject: "Introduction: {{org_name}} and {{program_area}}",
    body: `Dear {{contact_first_name}},

My name is {{sender_name}} and I am writing on behalf of {{org_name}}. {{org_mission}}

I am reaching out because {{funder_name}} supports work in areas close to ours. I would welcome the chance to tell you briefly about {{program_area}} and to learn whether it fits your current priorities.

If it would help, I can send a one-page summary or set up a short call at a time that suits you.

Thank you for your time and for the work {{funder_name}} does.

Kind regards,
{{sender_name}}
{{sender_title}}, {{org_name}}
{{org_website}}`,
    builtIn: true,
  },
  {
    key: "loi_follow_up",
    name: "Letter of inquiry follow-up",
    when: "You sent a letter of inquiry or a first note and have not heard back.",
    subject: "Following up: {{org_name}} letter of inquiry",
    body: `Dear {{contact_first_name}},

I am following up on the letter of inquiry we sent to {{funder_name}} about {{program_area}}. I know inboxes are full, so I wanted to make sure it reached you.

If you need anything further from {{org_name}}, such as our budget, our most recent annual report, or a short conversation, I am glad to provide it.

If this is not a fit for {{funder_name}} right now, a one-line reply would help us plan, and we would be grateful for it.

Thank you,
{{sender_name}}
{{sender_title}}, {{org_name}}`,
    builtIn: true,
  },
  {
    key: "thank_you",
    name: "Thank you",
    when: "After a grant, a meeting, or a helpful reply.",
    subject: "Thank you from {{org_name}}",
    body: `Dear {{contact_first_name}},

Thank you, on behalf of everyone at {{org_name}}, for your support of {{program_area}}.

Your support from {{funder_name}} makes a real difference to the people we serve, and we will keep you informed about what it makes possible.

With gratitude,
{{sender_name}}
{{sender_title}}, {{org_name}}`,
    builtIn: true,
  },
];

export function builtInTemplate(key: string): Template | null {
  return BUILT_IN_TEMPLATES.find((t) => t.key === key) ?? null;
}

const FIELD_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;
/** What an unfilled field renders as. Visible on purpose. */
const PLACEHOLDER_RE = /\[add:\s*([a-z_ ]+)\]/gi;

export type Rendered = {
  subject: string;
  body: string;
  /** Fields the template used that had no value. */
  missing: MergeField[];
  /** Fields the template used that are not in MERGE_FIELDS. */
  unknown: string[];
};

function renderText(text: string, values: MergeValues, missing: Set<MergeField>, unknown: Set<string>): string {
  return text.replace(FIELD_RE, (_m, name: string) => {
    if (!(MERGE_FIELDS as readonly string[]).includes(name)) {
      unknown.add(name);
      return `[add: ${name}]`;
    }
    const field = name as MergeField;
    const value = values[field]?.toString().trim();
    if (!value) {
      missing.add(field);
      return `[add: ${field.replace(/_/g, " ")}]`;
    }
    return value;
  });
}

/** Lines that are only an unfilled optional field (e.g. a missing website) are dropped. */
function tidy(body: string): string {
  return body
    .split("\n")
    .filter((line) => !/^\s*\[add: (org website|sender title|ask amount)\](,\s*)?$/i.test(line.trim()))
    .join("\n")
    .replace(/\[add: sender title\],\s*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Fill a template with the values at hand. Missing fields are visible, never invented. */
export function renderTemplate(template: Pick<Template, "subject" | "body">, values: MergeValues): Rendered {
  const missing = new Set<MergeField>();
  const unknown = new Set<string>();
  const subject = renderText(template.subject, values, missing, unknown).replace(/\s+/g, " ").trim();
  const body = tidy(renderText(template.body, values, missing, unknown));
  // Optional fields dropped by tidy() are not "missing".
  for (const optional of ["org_website", "sender_title", "ask_amount"] as const) {
    if (missing.has(optional) && !body.includes(`[add: ${optional.replace(/_/g, " ")}]`)) missing.delete(optional);
  }
  return { subject, body, missing: [...missing], unknown: [...unknown] };
}

/** `[add: ...]` markers still present in a subject or body. */
export function findPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_RE)) found.add(m[1].trim());
  return [...found];
}

/** The fields a template references, in order of first appearance. */
export function fieldsUsed(template: Pick<Template, "subject" | "body">): string[] {
  const seen = new Set<string>();
  for (const m of `${template.subject}\n${template.body}`.matchAll(FIELD_RE)) seen.add(m[1]);
  return [...seen];
}

/** "Jane" from "Jane Q. Public"; a role-style name ("Grants Office") is kept whole. */
export function firstNameOf(fullName: string | null | undefined): string {
  const name = (fullName ?? "").trim();
  if (!name) return "";
  const parts = name.split(/\s+/);
  if (parts.length === 1) return name;
  const first = parts[0].replace(/[,.]$/g, "");
  // Honorifics are not first names.
  if (/^(mr|mrs|ms|dr|prof|rev|sr|fr|hon)\.?$/i.test(first)) return parts[1] ?? name;
  // Role-style names ("Grants Office", "Program Officer") stay whole.
  if (/^(grants?|program|programme|office|foundation|executive|director|committee|trustees?|the)$/i.test(first)) return name;
  return first;
}
