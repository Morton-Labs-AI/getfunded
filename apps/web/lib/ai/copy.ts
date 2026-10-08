/**
 * Plain-language copy for the AI surfaces. Every sentence here is shown to a
 * nonprofit fundraiser, so it says what happened and what to do next, and it
 * never dresses a model's guess up as a fact.
 *
 * Shared honesty constants (posture labels, missing-data words) live in
 * lib/content/copy.ts when the search builder creates it; this file only
 * holds AI-specific sentences.
 */
export const AI_COPY = {
  /** The one sentence under every AI card. */
  disclaimer: "Machine-suggested from the evidence shown. Not a fact until you check it.",

  fit: {
    title: "Fit analysis",
    empty: "This funder has not been analyzed for your organization yet.",
    emptyHint:
      "The analysis scores seven fit dimensions from this funder's public filings and your organization profile. Every reason cites the evidence it rests on.",
    analyze: "Analyze fit",
    reanalyze: "Re-analyze",
    stale: "Data changed since this ran",
    staleHint: "The filings or your profile changed after this analysis. Re-run it to refresh.",
    running: [
      "Gathering evidence from filings…",
      "Scoring seven fit dimensions…",
      "Writing the reasons…",
    ],
    composite: "Weighted composite of seven dimension scores. The arithmetic is ours, not the model's.",
    accept: "Accept",
    dismiss: "Dismiss",
    accepted: "You accepted this analysis.",
    dismissed: "You dismissed this analysis.",
    thin: "There is not enough public data on this funder to analyze it honestly yet.",
    noConcerns: "No concerns surfaced from the evidence.",
    reasons: "Why this may fit",
    concerns: "What to check first",
    ask: "Suggested ask",
    askNone: "Not enough grant-size evidence to suggest an ask.",
    nextStep: "Suggested next step",
    angle: "How to approach",
    evidence: "Based on",
    profileMissing: "Add your mission and program areas in Settings so the analysis has something to compare against.",
  },

  filter: {
    placeholder: "Describe the funders you want, e.g. “Oregon foundations that accept applications and gave over $500k”",
    button: "Set filters",
    hint: "The model turns your sentence into the same filters you could set by hand. You can remove any chip.",
    nothing: "The sentence did not map to any filter. Try naming a state, a topic, or a giving size.",
    applied: "Filters set from your sentence.",
  },

  ask: {
    title: "Ask the analyst",
    intro: "Ask a question in plain words. The analyst writes one read-only SQL query over the public funder data, runs it, and explains the result. You always see the query.",
    placeholder: "e.g. Which Texas foundations that accept applications paid out the most in grants?",
    send: "Ask",
    stop: "Stop",
    newChat: "New question",
    notConfigured: "Not configured on this install.",
    notConfiguredHint:
      "Ask the analyst needs a read-only database connection (ANALYST_DATABASE_URL). The person who runs this install can add it.",
    showWork: "Show the work",
    running: "Running query…",
    zeroRows: "The query ran and returned no rows. That is a finding, not an error.",
    capped: "Showing the first 500 rows. Narrow the question for a complete answer.",
    phases: ["Reading the question", "Writing the query", "Running the query", "Explaining the result"],
    credits: "Each question uses 2 credits.",
  },

  research: {
    title: "Research dossier",
    empty: "No web research for this funder yet.",
    emptyHint:
      "A dossier searches the public web for what this funder says it funds, recent grants in the news, people with public roles, and how to approach them. Every section lists its sources.",
    run: "Research on the web",
    rerun: "Refresh research",
    whatTheyFund: "What they fund",
    inNews: "Recent grants in the news",
    people: "People with public roles",
    approach: "How to approach",
    cautions: "Cautions",
    sources: "Sources",
    noPeople: "No people with a published role were found.",
    running: ["Searching the public web…", "Reading what was found…", "Writing the dossier…"],
  },

  draft: {
    title: "Draft polish",
    rule: "The draft uses only your template, the funder's public facts, and the dossier. It never claims the funder is interested.",
  },

  quota: {
    title: "AI credit limit reached",
    upgrade: "See plans",
    hint: "Search and funder profiles keep working. Credits reset at the start of your billing period.",
  },

  disabled: {
    title: "AI features are turned off right now",
    hint: "Search and funder profiles keep working. Try again later.",
  },

  plan: {
    title: "Not included in your plan",
    hint: "Upgrade to use this feature.",
    upgrade: "See plans",
  },
} as const;

/** Ratings in words. "Low" is a fact about evidence, not a verdict on the funder. */
export const RATING_LABELS = {
  very_high: "Very high",
  high: "High",
  medium: "Medium",
  low: "Low",
  very_low: "Very low",
} as const;
