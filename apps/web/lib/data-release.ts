import "server-only";

import { z } from "zod";

import rawRelease from "@/content/data-release.json";
import { MDASH } from "@/lib/format";
import { site } from "@/lib/site";

/**
 * The public data release behind /foundations ("The Open Foundation List").
 *
 * The downloads are GitHub Release assets. The release process rewrites one
 * small file, `content/data-release.json`, and the site is rebuilt. That file
 * is imported here, so it is part of the build (no file read at request time)
 * and is validated once per process.
 *
 * Shape of the file:
 *
 *   {
 *     "tag": "data-…" | null,          the GitHub release tag
 *     "vintage": "…" | null,           the pipeline's label for the export
 *     "published_at": "ISO date" | null,
 *     "index_years": [2017, …],        IRS e-file index years in the export
 *     "licence": "CC BY 4.0",
 *     "attribution": "…",
 *     "release_url": "https://…" | null,
 *     "files": [{ "name", "url", "bytes", "sha256", "rows", "description" }]
 *   }
 *
 * Honesty rules:
 *  - `tag: null` or `files: []` means there is no release yet. The page says
 *    so and shows no download button.
 *  - A file that fails validation never reaches the page: the whole release
 *    falls back to "no release yet" and the build log says why. A wrong
 *    download link is worse than no link.
 *  - `bytes: 0`, `rows: 0` and a `sha256` that is not 64 hex characters are
 *    placeholders, not facts. They become null and render "Not available".
 */

export type DataReleaseFile = {
  /** File name as published, for example `foundations.csv.gz`. */
  name: string;
  /** The https download link. */
  url: string;
  /** Size of the compressed file, or null when the release did not record it. */
  bytes: number | null;
  /** Full sha256 of the file, 64 lowercase hex characters, or null. */
  sha256: string | null;
  /** Data rows in the file (the header row is not counted), or null. */
  rows: number | null;
  /** One plain sentence about the file. May be empty. */
  description: string;
};

export type DataRelease = {
  tag: string | null;
  vintage: string | null;
  /** ISO 8601 date or date-time of the release, or null. */
  publishedAt: string | null;
  /** IRS e-file index years in the export, oldest first, no repeats. */
  indexYears: number[];
  licence: string;
  attribution: string;
  /** The release page on GitHub, or null when there is no release. */
  releaseUrl: string | null;
  files: DataReleaseFile[];
  /** True only when there is a tag and at least one valid file. */
  published: boolean;
};

export const DEFAULT_ATTRIBUTION = "Open Funder Database contributors (GetFunded), from IRS e-file data";

export const EMPTY_DATA_RELEASE: DataRelease = {
  tag: null,
  vintage: null,
  publishedAt: null,
  indexYears: [],
  licence: site.license.data,
  attribution: DEFAULT_ATTRIBUTION,
  releaseUrl: null,
  files: [],
  published: false,
};

/** A real https link with no unfilled `<placeholder>` left in it. */
function isHttpsUrl(value: string): boolean {
  if (/[<>\s]/.test(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Text or a number → trimmed text; null, undefined and "" → null. */
const optionalText = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => {
    const s = v === null || v === undefined ? "" : String(v).trim();
    return s === "" ? null : s;
  });

/** A count that must be above zero to be a fact; anything else → null. */
const optionalCount = z
  .number()
  .nullish()
  .transform((v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null));

const httpsUrl = z.string().trim().refine(isHttpsUrl, "must be an https URL with no placeholder in it");

const fileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "must be a plain file name"),
  url: httpsUrl,
  bytes: optionalCount,
  sha256: z
    .string()
    .nullish()
    .transform((v) => {
      const s = (v ?? "").trim().toLowerCase();
      return /^[0-9a-f]{64}$/.test(s) ? s : null;
    }),
  rows: optionalCount,
  description: z
    .string()
    .nullish()
    .transform((v) => (v ?? "").trim()),
});

const releaseSchema = z.object({
  tag: optionalText,
  vintage: optionalText,
  published_at: optionalText,
  index_years: z.array(z.coerce.number().int().min(1990).max(2200)).nullish(),
  licence: optionalText,
  attribution: optionalText,
  release_url: z.union([httpsUrl, z.literal("")]).nullish(),
  files: z.array(fileSchema).nullish(),
});

function validDateOrNull(value: string | null): string | null {
  if (!value) return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

/**
 * Validate the raw JSON. Never throws: anything that does not match the
 * contract returns the empty release, so the page shows "being prepared"
 * instead of a broken or wrong download.
 */
export function parseDataRelease(raw: unknown): DataRelease {
  const parsed = releaseSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(
      "[data-release] content/data-release.json does not match the contract; the page will show no downloads.",
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
    return EMPTY_DATA_RELEASE;
  }
  const r = parsed.data;
  const files = r.files ?? [];
  const tag = r.tag;
  const published = tag !== null && files.length > 0;
  const indexYears = [...new Set(r.index_years ?? [])].sort((a, b) => a - b);
  const releaseUrl = r.release_url ? r.release_url : tag ? `${site.github}/releases/tag/${encodeURIComponent(tag)}` : null;
  return {
    tag,
    vintage: r.vintage,
    publishedAt: validDateOrNull(r.published_at),
    indexYears,
    licence: r.licence ?? site.license.data,
    attribution: r.attribution ?? DEFAULT_ATTRIBUTION,
    releaseUrl,
    files,
    published,
  };
}

const RELEASE: DataRelease = parseDataRelease(rawRelease as unknown);

/** The current public data release, validated. Safe to call from any Server Component. */
export function getDataRelease(): DataRelease {
  return RELEASE;
}

/** "2017 to 2020", "2020", or null when no year is recorded. */
export function formatYearRange(years: readonly number[]): string | null {
  if (years.length === 0) return null;
  const first = Math.min(...years);
  const last = Math.max(...years);
  return first === last ? String(first) : `${first} to ${last}`;
}

/**
 * A file size people can compare with what their computer shows:
 * "812 bytes", "4.2 KB", "38.6 MB", "1.3 GB". Units step by 1,024, the same
 * as the GitHub release page the file is downloaded from. Missing or zero is
 * an em dash, never "0 bytes".
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return MDASH;
  const units = ["KB", "MB", "GB", "TB"] as const;
  if (bytes < 1024) return `${Math.round(bytes)} ${Math.round(bytes) === 1 ? "byte" : "bytes"}`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
