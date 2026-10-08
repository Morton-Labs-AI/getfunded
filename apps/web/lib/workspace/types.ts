/**
 * Shared types for the signed-in workspace (schema `getfunded`).
 *
 * Pure: no server imports, so client components and tests can use them.
 * Dates travel as ISO strings (timestamps) or `YYYY-MM-DD` (date columns),
 * money as whole-dollar numbers, and nothing here is ever `undefined` when
 * the database has a value: missing is `null`, which the UI renders as
 * <Missing /> ("Not available"), never "$0".
 */
import type { Stage } from "./stages";

/** Who is acting, in which workspace. Both ids are verified upstream by `requireWorkspace()`. */
export type WorkspaceCtx = { userId: string; workspaceId: string };

/**
 * The corpus snapshot stored on `saved_funders.snapshot` at save time, so a
 * corpus re-ingest can never orphan a workspace row. Structurally identical to
 * `FunderSnapshot` in lib/queries/corpus/types.ts (search owns that file).
 */
export type FunderSnapshot = {
  orgId: string;
  name: string;
  ein: string | null;
  orgType: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
};

export type Tier = 1 | 2 | 3;

export type SavedFunder = {
  id: string;
  workspaceId: string;
  orgId: string;
  snapshot: FunderSnapshot;
  stage: Stage;
  tier: Tier | null;
  ownerId: string | null;
  ownerName: string | null;
  askAmount: number | null;
  nextAction: string | null;
  /** YYYY-MM-DD */
  nextActionDue: string | null;
  /** Why this funder is on the list: who saved it, from which search, or which import. */
  sourceDetail: string | null;
  tags: string[];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  /** Last human-logged activity (note, email, call, meeting, letter, event). Null = never contacted. */
  lastTouchAt: string | null;
  openTasks: number;
  /** When the funder entered its current stage (latest stage_history row, else createdAt). */
  stageEnteredAt: string;
};

export type SavedFilters = {
  q?: string;
  stage?: Stage;
  ownerId?: string;
  tier?: Tier;
  collectionId?: string;
  sort?: "name" | "updated" | "due" | "ask";
};

export type TaskStatus = "open" | "done" | "canceled";

export type Task = {
  id: string;
  workspaceId: string;
  savedFunderId: string | null;
  funderName: string | null;
  orgId: string | null;
  title: string;
  details: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  status: TaskStatus;
  completedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  version: number;
};

export type TaskView = "open" | "mine" | "today" | "overdue" | "done";

export const ACTIVITY_KINDS = ["note", "email", "call", "meeting", "letter", "event", "system"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** The kinds a person logs; `system` rows are written by the app. */
export const HUMAN_ACTIVITY_KINDS = ["note", "email", "call", "meeting", "letter", "event"] as const;
export type HumanActivityKind = (typeof HUMAN_ACTIVITY_KINDS)[number];

export type Activity = {
  id: string;
  savedFunderId: string | null;
  funderName: string | null;
  kind: ActivityKind;
  body: string;
  occurredAt: string;
  createdBy: string | null;
  createdByName: string | null;
  meta: Record<string, unknown>;
};

export type StageHistoryRow = {
  id: number;
  fromStage: Stage | null;
  toStage: Stage;
  changedBy: string | null;
  changedByName: string | null;
  note: string | null;
  createdAt: string;
};

export type Contact = {
  id: string;
  savedFunderId: string | null;
  fullName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  source: "filing_part_xv" | "manual" | "import" | "web";
  sourceUrl: string | null;
  createdAt: string;
  version: number;
};

export const KNOWLEDGE_KINDS = ["fact", "program", "outcome", "boilerplate"] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export type KnowledgeItem = {
  id: string;
  kind: KnowledgeKind;
  title: string;
  body: string;
  approved: boolean;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type Member = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
};

export type Collection = {
  id: string;
  name: string;
  description: string | null;
  isShared: boolean;
  itemCount: number;
  createdBy: string | null;
  version: number;
};

export type ImportSummary = {
  id: string;
  filename: string;
  rowCount: number;
  matched: number;
  unmatched: number;
  createdAt: string;
  createdByName: string | null;
};
