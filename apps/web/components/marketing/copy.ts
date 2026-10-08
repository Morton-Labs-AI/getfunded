import type { Feature, PlanId } from "@/lib/plans";

/**
 * Marketing copy that is reused across pages. Plain language for nonprofit
 * staff: short sentences, one idea each. Plan numbers are never written
 * here; pages read them from lib/plans.ts so pricing cannot drift.
 */

/** The seven non-negotiable data rules from GOVERNANCE.md, in plain words. */
export const HONESTY_RULES: Array<{ title: string; body: string }> = [
  {
    title: "Unknown is not closed.",
    body: "When a filing does not say whether a funder accepts applications, we say “Not stated in filings.” We never say “closed.”",
  },
  {
    title: "Missing is not zero.",
    body: "A number that is not on the filing reads “Not available.” It never reads “$0.” A real zero reads “$0.”",
  },
  {
    title: "Contacts are opt-in and never bought.",
    body: "We show a contact only when the public record allows it. Role inboxes like grants@ can appear. A named person’s address does not. We never use vendor lists.",
  },
  {
    title: "Every fact has a source.",
    body: "Each value carries the dataset, the filing year and the hash of the exact file we read. Click it and check.",
  },
  {
    title: "AI is labelled and cites its evidence.",
    body: "Anything a model writes is marked AI, points to the evidence it used, and never claims a funder is interested in you.",
  },
  {
    title: "No made-up data.",
    body: "No invented rows. No demo data in the real database. If we do not have it, we say so.",
  },
  {
    title: "Amended filings replace the original.",
    body: "When a funder files an amendment, the newer return wins everywhere. Nothing is counted twice.",
  },
];

/** The three data classes, as explained to a nonprofit reader. */
export const DATA_CLASSES = {
  source: {
    name: "Source",
    summary: "Verified from a public filing.",
    body: "Teal, with a dotted underline and a document icon. Click it to see the filing, the year and the file hash.",
  },
  ai: {
    name: "AI",
    summary: "Suggested by a model. Never a fact.",
    body: "Violet, with a dashed border and the word “AI.” Every point links to its evidence. You can accept, edit or dismiss it.",
  },
  yours: {
    name: "Yours",
    summary: "Your own notes, stages and tags.",
    body: "Green, with a solid left rule. Only you and your team can see or change it.",
  },
} as const;

export const HOW_IT_WORKS: Array<{ title: string; body: string }> = [
  {
    title: "Describe your work",
    body: "Type a sentence about what you do and where. Search reads what funders actually paid for, not just their names.",
  },
  {
    title: "Read the filing, not a summary",
    body: "Each profile shows what the funder reported: how to apply, money by year, grants paid, officers. Every fact links to its source.",
  },
  {
    title: "Save it and act",
    body: "Create a free account to save funders, run a pipeline, keep tasks, and ask the AI to explain fit or polish a draft. AI output stays labelled.",
  },
];

/** Plain-language names for the metered features, keyed like CREDIT_COSTS. */
export const FEATURE_COPY: Record<Feature, { name: string; body: string }> = {
  filter: { name: "Natural-language search filter", body: "Turns a sentence into search filter chips." },
  ask: { name: "Ask the analyst", body: "Writes one read-only query to answer your question and explains the result." },
  draft: { name: "Outreach draft polish", body: "Rewrites your template using facts from the funder’s record only." },
  fit: { name: "Fit analysis", body: "Reads the funder’s filings and your profile, then scores and explains fit with citations." },
  research: { name: "Research dossier", body: "Web search plus a structured, sourced dossier on one funder." },
};

/** Display order and a one-line pitch for each public plan. */
export const PLAN_COPY: Record<Exclude<PlanId, "unlimited">, { tagline: string; audience: string }> = {
  free: { tagline: "Search everything. Try the AI.", audience: "One person, getting started" },
  starter: { tagline: "A real prospect list.", audience: "A solo development director" },
  pro: { tagline: "Send through your own Gmail.", audience: "A small fundraising team" },
  team: { tagline: "Shared knowledge and an API.", audience: "A fundraising department" },
  enterprise: { tagline: "A person, not just compute.", audience: "Managed outreach with an SLA" },
};

export const PLAN_ORDER: Array<Exclude<PlanId, "unlimited">> = ["free", "starter", "pro", "team", "enterprise"];

export const PRICING_FAQ: Array<{ q: string; a: string }> = [
  {
    q: "What is a credit?",
    a: "A unit of AI use. One credit is about 4,000 input tokens and 1,000 output tokens on a mid-size model. Search, profiles, saving and the pipeline never use credits. Only calls to a language model do.",
  },
  {
    q: "What happens when I reach the limit?",
    a: "The AI button tells you, with a link to upgrade. Nothing else changes. There is no silent overage and no surprise bill. Credits reset on your billing day; Free resets on the first of the month.",
  },
  {
    q: "Can I run it myself?",
    a: "Yes. The code is Apache-2.0 and the dataset is CC BY 4.0. A self-install has no plan limits and uses your own API keys. See the self-install guide.",
  },
  {
    q: "Do you sell data?",
    a: "No. We do not sell, rent or share your workspace data, and we do not sell contact lists. Public filing data is already public and is published under CC BY 4.0.",
  },
  {
    q: "Can I cancel any time?",
    a: "Yes, from Settings → Billing. Your plan runs to the end of the period you paid for and then drops to Free. Your data stays.",
  },
];

/** The agent prompt from README.md, verbatim. */
export const AGENT_PROMPT =
  "Read README.md, docs/ARCHITECTURE.md and apps/web/AGENTS.md. Then install GetFunded locally using corpus/docs/SELF-INSTALL.md with the small profile and tell me what you found.";

/** The three self-install parts from README.md. */
export const SELF_INSTALL_STEPS: Array<{ title: string; lang: "bash" | "sql"; code: string }> = [
  {
    title: "1. Build the database",
    lang: "bash",
    code: [
      "cd corpus",
      "uv sync",
      "cp .env.example .env            # set DATABASE_URL and SEC_USER_AGENT",
      "uv run funderdb doctor          # checks your setup",
      "uv run funderdb migrate         # creates the schema",
      "uv run funderdb bootstrap --profile small   # a laptop-sized slice, under an hour",
    ].join("\n"),
  },
  {
    title: "2. Create the app’s database role",
    lang: "sql",
    code: "create role getfunded_login login password '<choose a password>' in role getfunded_app;",
  },
  {
    title: "3. Run the web app",
    lang: "bash",
    code: [
      "cd apps/web",
      "npm ci",
      "cp .env.example .env.local      # DATABASE_URL (getfunded_login), Supabase Auth keys, SELF_HOSTED=true",
      "npm run db:migrate              # creates the getfunded schema",
      "npm run db:ping                 # proves the app can read the corpus and cannot write it",
      "npm run dev                     # http://localhost:3050",
    ].join("\n"),
  },
];
