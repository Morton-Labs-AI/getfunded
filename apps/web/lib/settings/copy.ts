/**
 * Plain-language copy for Settings. One place, so the words stay honest and
 * consistent. B1 owns lib/content/copy.ts; these keys live here so the two
 * files never collide, and the integrator may fold them in later.
 */
import type { ProfileKey } from "./schemas";

export const SETTINGS_TABS = [
  { href: "/app/settings/organization", label: "Organization", key: "organization" },
  { href: "/app/settings/members", label: "Members", key: "members" },
  { href: "/app/settings/billing", label: "Billing", key: "billing" },
  { href: "/app/settings/api", label: "API keys", key: "api" },
  { href: "/app/settings/integrations", label: "Integrations", key: "integrations" },
  { href: "/app/settings/data", label: "Data", key: "data" },
] as const;
export type SettingsTabKey = (typeof SETTINGS_TABS)[number]["key"];

/** Each profile field: what it is, and why the AI reads it. */
export const PROFILE_FIELD_COPY: Record<
  ProfileKey | "name",
  { label: string; what: string; why: string; placeholder?: string }
> = {
  name: {
    label: "Organization name",
    what: "The name funders would recognize. Required.",
    why: "Appears in drafts and reports as the applicant.",
  },
  mission: {
    label: "Mission",
    what: "One or two sentences on what you do and for whom.",
    why: "The fit analysis compares this to what each funder says it funds. It is the most useful field.",
    placeholder: "We run after-school tutoring for middle schoolers in two rural counties.",
  },
  ein: {
    label: "EIN",
    what: "Your 9-digit IRS number.",
    why: "Lets the app find your own public filings and your past funders.",
    placeholder: "12-3456789",
  },
  website: {
    label: "Website",
    what: "Your public web address.",
    why: "Read only when you ask for a research dossier, to describe your work accurately.",
    placeholder: "https://example.org",
  },
  state: {
    label: "State",
    what: "Where you are based.",
    why: "Many funders only give in their own state. Search and fit use it to rank nearby funders.",
  },
  counties: {
    label: "Counties you serve",
    what: "Separate with commas. Leave blank if you work statewide.",
    why: "Some funders name the counties they serve in their filings. A match raises fit.",
    placeholder: "Lane, Douglas",
  },
  program_areas: {
    label: "Program areas",
    what: "Separate with commas. Use plain words, not grant jargon.",
    why: "Matched against the purposes of past grants (Source class) to find funders of similar work.",
    placeholder: "Youth education, Food security",
  },
  annual_budget: {
    label: "Annual budget",
    what: "Whole dollars.",
    why: "Helps suggest a realistic ask: funders rarely give more than a fraction of a budget.",
    placeholder: "250000",
  },
  populations_served: {
    label: "Who you serve",
    what: "Separate with commas.",
    why: "Compared with the recipients a funder already supports.",
    placeholder: "Middle school students, Rural families",
  },
  keywords: {
    label: "Keywords",
    what: "Words a funder might use to describe work like yours. Separate with commas.",
    why: "Added to the semantic search and the fit evidence package.",
    placeholder: "tutoring, literacy, after-school",
  },
};

export const SETTINGS_COPY = {
  organization: {
    title: "Organization",
    description: "What the AI knows about you. Every field is optional except the name.",
    readOnly: "Only a workspace owner or admin can change these. Ask one of them, or they can make you an admin.",
  },
  members: {
    title: "Members",
    description: "Who can work in this workspace. Invitations are links you share yourself; GetFunded does not send email.",
    inviteHelp: "The link works once and expires in 7 days. Anyone who opens it signs in with their own email first.",
  },
  billing: {
    title: "Billing",
    description: "Your plan, AI credits and how to change them. Search is always free; only model calls use credits.",
    selfHosted: "Unlimited plan on this install. Self-hosted GetFunded has no billing; usage is still recorded for your own records.",
    pastDue: "Your last payment did not go through. Your plan stays active for now. Update the payment method in the billing portal to keep it.",
    memberOnly: "Only a workspace owner or admin can change the plan.",
  },
  api: {
    title: "API keys",
    description: "Keys for the public API (/api/v1). Each key is shown once; the app keeps only a fingerprint.",
    adminOnly: "Only a workspace owner or admin can see or create API keys.",
  },
  integrations: {
    title: "Integrations",
    description: "What is connected to this workspace and what the install can do.",
  },
  data: {
    title: "Data",
    description: "Your data is yours. Take it with you any time, or delete this workspace.",
  },
} as const;
