/**
 * Evidence packages: the only thing a model is allowed to reason from.
 *
 * Each item carries a short, exact-copyable id (`grant_3`, `posture_1`,
 * `applicant_profile`). Every claim a model makes must cite one of these ids;
 * a citation that is not in the package fails validation before anything is
 * stored. Ids are package-local on purpose: an evidence id has never meant
 * anything outside the package it was built for.
 *
 * Pure module: no database, no server imports, so tests can build packages by
 * hand.
 */
import { createHash } from "node:crypto";

export type EvidenceClass = "source" | "yours";

export type EvidenceKind =
  | "identity"
  | "financials"
  | "series"
  | "posture"
  | "grant_stats"
  | "grant"
  | "geography"
  | "similar"
  | "website"
  | "applicant"
  | "knowledge"
  | "dossier"
  | "template";

export type EvidenceSource = {
  /** Short chip label: "IRS 990-PF · FY2023", "IRS BMF", "Your profile". */
  label: string;
  dataset?: string | null;
  fy?: number | null;
  href?: string | null;
};

export type EvidenceItem = {
  id: string;
  kind: EvidenceKind;
  /** Source = verified from filings; yours = the workspace's own data. */
  cls: EvidenceClass;
  text: string;
  source?: EvidenceSource;
};

/** A small builder that hands out ordinal ids per slug (`grant_1`, `grant_2`, ...). */
export class EvidenceBuilder {
  readonly items: EvidenceItem[] = [];
  private readonly seq = new Map<string, number>();

  /** `slug` ending in `_` gets a sequence number; otherwise it is used as-is (must be unique). */
  add(
    kind: EvidenceKind,
    cls: EvidenceClass,
    slug: string,
    text: string,
    source?: EvidenceSource,
  ): string {
    let id = slug;
    if (slug.endsWith("_")) {
      const n = (this.seq.get(slug) ?? 0) + 1;
      this.seq.set(slug, n);
      id = `${slug}${n}`;
    }
    if (this.items.some((i) => i.id === id)) throw new Error(`duplicate evidence id ${id}`);
    const clean = text.replace(/\s+/g, " ").trim();
    this.items.push(source ? { id, kind, cls, text: clean, source } : { id, kind, cls, text: clean });
    return id;
  }
}

export function packageIds(items: ReadonlyArray<Pick<EvidenceItem, "id">>): Set<string> {
  return new Set(items.map((i) => i.id));
}

/** The package as the model sees it: one line per item, id first. */
export function renderPackage(items: ReadonlyArray<EvidenceItem>): string {
  return items.map((i) => `[${i.id}] ${i.text}`).join("\n");
}

/**
 * The staleness key: a hash of every evidence item plus the prompt version,
 * the weights version and the model. Any change to any of them (a new filing,
 * an edited profile, a retuned weight) produces a new fingerprint, so the
 * panel can say "data changed since this ran" without re-running the model.
 */
export function fingerprintOf(input: {
  items: ReadonlyArray<EvidenceItem>;
  promptVersion: string;
  weightsVersion?: string | null;
  model: string;
}): string {
  const canonical = JSON.stringify({
    items: input.items.map((i) => [i.kind, i.id, i.text]),
    promptVersion: input.promptVersion,
    weightsVersion: input.weightsVersion ?? null,
    model: input.model,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Check a list of cited ids against the package. Returns human-readable
 * violations (empty = valid) so a retry can name exactly what was wrong.
 */
export function unknownRefs(ids: ReadonlyArray<string>, allowed: Set<string>, where: string): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (!allowed.has(id)) out.push(`${where} cites unknown evidence id "${id}"`);
  }
  return out;
}

/**
 * Tool-use output sometimes arrives with a nested object or array serialised
 * as a string. This re-parses only strings that are valid JSON objects or
 * arrays; it cannot invent content and everything still passes the schema.
 */
export function normalizeToolInput(input: unknown): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return input;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t.startsWith("{") && !t.startsWith("[")) continue;
    try {
      out[k] = JSON.parse(t);
    } catch {
      /* not JSON after all; let the schema report it */
    }
  }
  return out;
}

/** Money for the model: whole dollars with separators, or the words "not available". */
export function moneyForModel(v: unknown): string {
  if (v === null || v === undefined || v === "") return "not available";
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return "not available";
  return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n))}`;
}

export function clip(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
