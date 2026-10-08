/**
 * CSV import: pure normalisation, column guessing, and the matching decision.
 * No I/O here, so every rule is unit tested. The corpus lookups themselves
 * (EIN, then exact normalised name) run in lib/workspace/imports.ts.
 *
 * The rule that matters: nothing merges silently. A row joins the list only
 * when exactly one organization matches by EIN, or exactly one matches by
 * exact normalised name. Several candidates, a fuzzy-only hit, or a funder
 * that is already on the list are all REPORTED, never guessed.
 */

export type ImportColumns = { name: string | null; ein: string | null; notes: string | null };

export type ImportRow = {
  /** 1-based, as a spreadsheet user counts (header excluded). */
  rowNumber: number;
  name: string | null;
  ein: string | null;
  notes: string | null;
};

export type MatchCandidate = { orgId: string; name: string; city: string | null; state: string | null; ein: string | null };

export type MatchStatus =
  | "matched_ein"
  | "matched_name"
  | "already_saved"
  | "ambiguous"
  | "unmatched"
  | "empty"
  | "limit_reached";

export type MatchDecision = {
  status: MatchStatus;
  orgId: string | null;
  /** One plain sentence the report shows next to the row. */
  reason: string;
  candidates: MatchCandidate[];
};

export const IMPORT_MAX_ROWS = 300;

/** EIN: strip non-digits, zero-pad Excel's dropped leading zero. Garbage is null. */
export function normalizeEin(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0 || digits.length > 9) return null;
  const padded = digits.padStart(9, "0");
  return Number(padded) > 0 ? padded : null;
}

const CORP_SUFFIX = /\b(incorporated|inc|corporation|corp|co|llc|ltd|limited|the)\b/g;

/**
 * Name key for exact matching: lower-case, ASCII letters and digits only,
 * common corporate suffixes and a leading/trailing "the" removed, single
 * spaces. "The Valley Foundation, Inc." and "VALLEY FOUNDATION" agree.
 */
export function normalizeName(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(CORP_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
  return key.length > 0 ? key : null;
}

const HEADER_PATTERNS: Array<[RegExp, keyof ImportColumns]> = [
  [/^(ein|tax\s*id|fein|employer\s*id)/i, "ein"],
  [/^(org|organization|organisation|foundation|funder|company|name)$/i, "name"],
  [/(organization|organisation|foundation|funder|company)\s*name/i, "name"],
  [/^name$/i, "name"],
  [/note|comment|memo|why|reason/i, "notes"],
];

/** Guess which header holds the name, the EIN and the notes. Each field is taken at most once. */
export function guessColumns(headers: ReadonlyArray<string>): ImportColumns {
  const out: ImportColumns = { name: null, ein: null, notes: null };
  for (const raw of headers) {
    const header = raw.trim();
    for (const [re, field] of HEADER_PATTERNS) {
      if (out[field] === null && re.test(header)) {
        out[field] = raw;
        break;
      }
    }
  }
  return out;
}

/** Apply a column choice to the parsed CSV rows. Blank rows stay in the list so the report can count them. */
export function parseRows(records: ReadonlyArray<Record<string, string>>, columns: ImportColumns): ImportRow[] {
  const pick = (record: Record<string, string>, header: string | null): string | null => {
    if (!header) return null;
    const v = record[header];
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 500) : null;
  };
  return records.map((record, i) => ({
    rowNumber: i + 1,
    name: pick(record, columns.name),
    ein: normalizeEin(pick(record, columns.ein)),
    notes: pick(record, columns.notes),
  }));
}

/**
 * The decision for one row, given what the corpus returned.
 *  - `einHits`: organizations whose EIN equals the row's EIN (0, 1, or more).
 *  - `nameHits`: organizations the name search returned; only those whose
 *    normalised name EQUALS the row's are exact. Fuzzy neighbours are shown as
 *    candidates and never auto-matched.
 *  - `savedOrgIds`: organizations already on this workspace's list.
 */
export function decideMatch(input: {
  row: ImportRow;
  einHits: ReadonlyArray<MatchCandidate>;
  nameHits: ReadonlyArray<MatchCandidate>;
  savedOrgIds: ReadonlySet<string>;
}): MatchDecision {
  const { row, einHits, nameHits, savedOrgIds } = input;

  if (!row.name && !row.ein) {
    return { status: "empty", orgId: null, reason: "The row has no name and no EIN.", candidates: [] };
  }

  if (row.ein) {
    if (einHits.length === 1) {
      const hit = einHits[0];
      if (savedOrgIds.has(hit.orgId)) {
        return { status: "already_saved", orgId: hit.orgId, reason: "Already on your list. Nothing was changed.", candidates: [hit] };
      }
      return { status: "matched_ein", orgId: hit.orgId, reason: "Matched by EIN.", candidates: [hit] };
    }
    if (einHits.length > 1) {
      return {
        status: "ambiguous",
        orgId: null,
        reason: "More than one organization carries this EIN in the filings. Pick one by hand.",
        candidates: einHits.slice(0, 5),
      };
    }
  }

  if (row.name) {
    const key = normalizeName(row.name);
    const exact = key ? nameHits.filter((h) => normalizeName(h.name) === key) : [];
    if (exact.length === 1) {
      const hit = exact[0];
      if (savedOrgIds.has(hit.orgId)) {
        return { status: "already_saved", orgId: hit.orgId, reason: "Already on your list. Nothing was changed.", candidates: [hit] };
      }
      return {
        status: "matched_name",
        orgId: hit.orgId,
        reason: row.ein ? "The EIN was not found; matched by exact name instead." : "Matched by exact name.",
        candidates: [hit],
      };
    }
    if (exact.length > 1) {
      return {
        status: "ambiguous",
        orgId: null,
        reason: `${exact.length} organizations share this name. Add an EIN to the row to tell them apart.`,
        candidates: exact.slice(0, 5),
      };
    }
    if (nameHits.length > 0) {
      return {
        status: "unmatched",
        orgId: null,
        reason: "No exact match. Similar names are listed; add an EIN if one of them is right.",
        candidates: nameHits.slice(0, 5),
      };
    }
  }

  return {
    status: "unmatched",
    orgId: null,
    reason: row.ein && !row.name ? "That EIN is not in the filings we have." : "Not found in the filings we have.",
    candidates: [],
  };
}

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  matched_ein: "Added (EIN match)",
  matched_name: "Added (name match)",
  already_saved: "Already on your list",
  ambiguous: "Needs a decision",
  unmatched: "Not found",
  empty: "Blank row",
  limit_reached: "Not added: plan limit",
};

export function isAdded(status: MatchStatus): boolean {
  return status === "matched_ein" || status === "matched_name";
}
