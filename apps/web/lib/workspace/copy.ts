/**
 * Plain-language copy for the signed-in workspace. One place, so the words
 * stay honest and consistent. Search owns lib/content/copy.ts; keys here are
 * workspace-only and can move there at integration.
 */

export const WORKSPACE_COPY = {
  yours: {
    label: "Yours",
    explainer: "Your own notes, stages, tasks and contacts. Only your workspace can see them.",
  },
  saved: {
    title: "Saved funders",
    subtitle: "Every funder your team is working, with who owns it, what you plan to ask for, and what happens next. Edit any cell in place.",
    empty: "No funders on your list yet.",
    emptyHint: "Search for funders that already give to work like yours, then press Save. They show up here, ready to assign and track.",
    noMatch: "Nothing on your list matches those filters.",
    whyOnList: "Why on list",
    whyOnListMissing: "Not recorded.",
    exportTruncated: (rows: number, total: number) =>
      `Your plan exports ${rows} rows at a time. ${total - rows} more rows were left out.`,
  },
  pipeline: {
    title: "Pipeline",
    subtitle: "Drag a funder to the right as the relationship grows. Every move is written to its history.",
    empty: "Nothing in the pipeline yet.",
    emptyHint: "Save a funder and it starts at Identified. Move it right as you research, reach out, and ask.",
  },
  tasks: {
    title: "Tasks",
    subtitle: "What you owe a funder, soonest first. Overdue items are flagged.",
    empty: "No tasks here.",
    emptyHint: "Add a task, or create one from a funder's page so it stays linked.",
    clean: "Nothing overdue. Clean slate.",
  },
  limits: {
    savedFunders: (limit: number) =>
      `Your plan holds ${limit} saved funders. Upgrade to save more, or archive funders you are no longer working.`,
    pipelines: (limit: number) => `Your plan allows ${limit} ${limit === 1 ? "list" : "lists"}. Upgrade to make more.`,
    reports: "Printable reports are part of Pro and above.",
    upgrade: "See plans",
    upgradeHref: "/app/settings/billing",
  },
  import: {
    title: "Import a spreadsheet",
    subtitle:
      "Upload a CSV of funders you already track. We match each row by EIN first, then by exact name, and show you every row before anything joins your list. Nothing merges on a guess.",
    columnsHint: "Columns we read: name, EIN and notes. Other columns are ignored.",
  },
  knowledge: {
    title: "Knowledge",
    subtitle:
      "Facts about your organization that the AI may use when it writes a fit analysis or a draft. Only approved items ever reach a prompt.",
    approvedOnly: "Only approved items are used.",
  },
  reports: {
    title: "Reports",
    subtitle: "Where your pipeline stands, what you plan to ask for, and how much work the team has logged.",
    askDisclaimer: "Planned asks are working figures for planning. They are not money raised.",
  },
  dashboard: {
    focusTitle: "Today's focus",
    focusHint: "Overdue tasks, next steps coming due, and funders going quiet.",
    allClear: "All caught up. Time to find new funders.",
  },
  stale: "No contact logged for 30 days or more.",
  neverContacted: "Never contacted.",
} as const;
