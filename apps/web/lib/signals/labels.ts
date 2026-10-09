/**
 * Funder-signal vocabulary -> words. Pure; shared by the funder page, the
 * bell, the notifications page and the dashboard. The keys mirror the CHECK
 * constraints in corpus migration 0032: a value the database can store has a
 * label here, and an unknown value falls back to the raw key so nothing is
 * ever hidden by a missing entry.
 */

export const SIGNAL_TYPES = [
  "capital_commitment",
  "program_launch",
  "rfp_open",
  "deadline",
  "grant_announced",
  "investment_announced",
  "fund_close",
  "strategy_shift",
  "leadership_change",
  "partnership",
  "event",
  "other",
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const SIGNAL_TYPE_LABELS: Record<SignalType, string> = {
  capital_commitment: "New capital commitment",
  program_launch: "New program",
  rfp_open: "Open call",
  deadline: "Deadline",
  grant_announced: "Grants announced",
  investment_announced: "Investment announced",
  fund_close: "Fund closed",
  strategy_shift: "Strategy change",
  leadership_change: "Leadership change",
  partnership: "Partnership",
  event: "Event",
  other: "Announcement",
};

/** Types a fundraiser can act on this week. Mirrors the door's +10 rule. */
export const ACTIONABLE_TYPES: ReadonlySet<string> = new Set<SignalType>([
  "capital_commitment",
  "program_launch",
  "rfp_open",
  "deadline",
  "strategy_shift",
]);

export const RECIPIENT_LABELS: Record<string, string> = {
  nonprofit: "Nonprofits",
  for_profit: "For-profit companies",
  fund: "Funds",
  government: "Government",
  academic: "Universities and labs",
  individual: "Individuals",
  unspecified: "Not specified",
};

export const INSTRUMENT_LABELS: Record<string, string> = {
  grant: "Grants",
  pri: "Program-related investments",
  mri: "Mission-related investments",
  equity: "Equity",
  debt: "Loans",
  guarantee: "Guarantees",
  prize: "Prizes",
  contract: "Contracts",
  technical_assistance: "Technical assistance",
  unspecified: "Not specified",
};

export const SECTOR_LABELS: Record<string, string> = {
  climate: "Climate",
  clean_energy: "Clean energy",
  nuclear_energy: "Nuclear energy",
  energy_other: "Energy",
  environment_conservation: "Environment",
  health: "Health",
  education: "Education",
  housing: "Housing",
  economic_opportunity: "Economic opportunity",
  journalism_media: "Journalism",
  democracy_civic: "Democracy and civic life",
  arts_culture: "Arts and culture",
  science_research: "Science and research",
  criminal_justice: "Criminal justice",
  international_development: "International development",
  human_services: "Human services",
  other: "Other",
};

export function signalTypeLabel(v: string | null | undefined): string {
  if (!v) return SIGNAL_TYPE_LABELS.other;
  return (SIGNAL_TYPE_LABELS as Record<string, string>)[v] ?? v;
}

export function labelList(values: readonly string[] | null | undefined, table: Record<string, string>): string[] {
  return (values ?? []).map((v) => table[v] ?? v);
}

/** Plain-language reason the AI label carries on every classified field. */
export const SIGNAL_AI_REASON =
  "A model read the announcement and classified it. Every chip is backed by a passage quoted from the page; the summary is the model's paraphrase, not the funder's words.";

/** What this section is, in one sentence, for the note under the panel. */
export const SIGNALS_NOTE =
  "Signals are the funder's own announcements, found on its website or sent in by a person and then classified. They are not filings and they never say a funder is interested in you.";
