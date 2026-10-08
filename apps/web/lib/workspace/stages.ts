/**
 * The relationship stage model: one source for stage keys, plain-language
 * labels, board order, and the two helpers reports lean on (forward moves and
 * the furthest-stage funnel).
 *
 * FROZEN CONTRACT: these keys match `ck_saved_funders_stage` in
 * migrations/getfunded_0004_funders.sql and the whitelist inside
 * `getfunded.move_stage()`. Renaming one is a data migration, not an edit here.
 *
 * Pure: no server imports.
 */

export const STAGES = [
  "identified",
  "researching",
  "qualified",
  "cultivating",
  "loi_submitted",
  "proposal_submitted",
  "awarded",
  "declined",
  "parked",
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  identified: "Identified",
  researching: "Researching",
  qualified: "Qualified",
  cultivating: "Cultivating",
  loi_submitted: "LOI submitted",
  proposal_submitted: "Proposal submitted",
  awarded: "Awarded",
  declined: "Declined",
  parked: "Parked",
};

/** One line a first-time user can act on. Shown as column hints on the board. */
export const STAGE_HINTS: Record<Stage, string> = {
  identified: "Looks promising. Nobody has checked yet.",
  researching: "Reading their filings and priorities.",
  qualified: "A real fit. Worth an ask.",
  cultivating: "In conversation with the funder.",
  loi_submitted: "A letter of inquiry is with them.",
  proposal_submitted: "A full proposal is with them.",
  awarded: "They said yes.",
  declined: "They said no, this time.",
  parked: "On hold. Revisit later.",
};

/**
 * Board columns, in the order a relationship usually grows. `declined` and
 * `parked` are exits, shown in a side rail so a "Declined" column never
 * dominates the board.
 */
export const BOARD_STAGES: readonly Stage[] = [
  "identified",
  "researching",
  "qualified",
  "cultivating",
  "loi_submitted",
  "proposal_submitted",
  "awarded",
];

export const RAIL_STAGES: readonly Stage[] = ["declined", "parked"];

/** Stages where a funder is being actively worked (stale checks apply here). */
export const ACTIVE_STAGES: readonly Stage[] = [
  "researching",
  "qualified",
  "cultivating",
  "loi_submitted",
  "proposal_submitted",
];

/** Stages that count as "in the pipeline" for totals (everything but the exits). */
export const PIPELINE_STAGES: readonly Stage[] = BOARD_STAGES;

/** Stages where a person is talking to the funder; silence here is a risk. */
export const CONVERSATION_STAGES: readonly Stage[] = ["cultivating", "loi_submitted", "proposal_submitted"];

export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

/** Position on the forward path, or null for the two exit stages. */
export function stageIndex(stage: Stage): number | null {
  const i = BOARD_STAGES.indexOf(stage);
  return i === -1 ? null : i;
}

/**
 * Transition rules. Fundraising is not linear: a funder can skip ahead, fall
 * back, or come back from a decline. The only move that is not a move is a
 * no-op. The database enforces the key whitelist; this answers "may the UI
 * offer it".
 */
export function canTransition(from: Stage, to: Stage): boolean {
  if (from === to) return false;
  return isStage(to);
}

/** True when `to` is further along the forward path than `from`. Exits never count as forward. */
export function isForwardMove(from: Stage | null, to: Stage): boolean {
  const toIndex = stageIndex(to);
  if (toIndex === null) return false;
  if (from === null) return false;
  const fromIndex = stageIndex(from);
  if (fromIndex === null) return false;
  return toIndex > fromIndex;
}

export type ReachRow = { stage: Stage; reached: number; current: number };

/**
 * A funnel that cannot lie. Counting "ever entered stage X" is wrong here:
 * funders skip stages and move backwards, so adjacent counts can rise and
 * produce conversion rates over 100%. Instead, take the FURTHEST forward stage
 * each funder ever reached (its history plus where it sits now) and count how
 * many reached each stage or beyond. That series is monotonically
 * non-increasing by construction.
 *
 * `funders` carries each live funder's current stage; `history` carries every
 * `stage_history.to_stage` for those funders. Exit stages never advance a
 * funder's furthest point.
 */
export function stageReach(
  funders: ReadonlyArray<{ id: string; stage: Stage }>,
  history: ReadonlyArray<{ savedFunderId: string; toStage: Stage }>,
): ReachRow[] {
  const furthest = new Map<string, number>();
  const bump = (id: string, stage: Stage) => {
    const i = stageIndex(stage);
    if (i === null) return;
    const prev = furthest.get(id);
    if (prev === undefined || i > prev) furthest.set(id, i);
  };
  const live = new Set(funders.map((f) => f.id));
  for (const f of funders) bump(f.id, f.stage);
  for (const h of history) if (live.has(h.savedFunderId)) bump(h.savedFunderId, h.toStage);

  const current = new Map<Stage, number>();
  for (const f of funders) current.set(f.stage, (current.get(f.stage) ?? 0) + 1);

  return BOARD_STAGES.map((stage, i) => {
    let reached = 0;
    for (const max of furthest.values()) if (max >= i) reached += 1;
    return { stage, reached, current: current.get(stage) ?? 0 };
  });
}

export const TIERS = [1, 2, 3] as const;
export const TIER_LABELS: Record<1 | 2 | 3, string> = { 1: "Tier 1", 2: "Tier 2", 3: "Tier 3" };
export const TIER_HINTS: Record<1 | 2 | 3, string> = {
  1: "Top priority: the best fit and the biggest likely gift.",
  2: "Good fit. Work these after Tier 1.",
  3: "Possible. Keep an eye on them.",
};
