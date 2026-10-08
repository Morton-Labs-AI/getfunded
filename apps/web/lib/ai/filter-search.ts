/**
 * The bridge from the model's filter vocabulary (./filter-schema) to the
 * search page's URL state (lib/search/params). Pure, client-safe, and the
 * ONLY place the two vocabularies meet, so a model can set exactly what a
 * hand-typed URL can set and nothing more.
 *
 *   q           → q (a name or EIN), mode "name"
 *   like        → q with mode "thesis" (the meaning-based search); when a name
 *                 is also set, it becomes giving_to (recipient keywords) instead
 *   org_type    → type, when the search page knows that type
 *   state       → state
 *   posture     → posture ('preselected_only' is spelled 'preselected' in URLs)
 *   ntee        → ntee
 *   min_giving  → min_distributions
 *   min_assets  → min_assets
 *   max_assets  → (no URL filter yet; reported as dropped, never silently lost)
 */
import {
  DEFAULT_SEARCH_PARAMS,
  MAX_GIVING_TO_CHARS,
  MAX_QUERY_CHARS,
  SEARCH_TYPES,
  withParams,
  type SearchParams,
  type SearchPosture,
  type SearchType,
} from "@/lib/search/params";
import type { FilterChip, NormalizedFilter } from "./filter-schema";

export type FilterDropped = { chip: FilterChip; reason: string };

export type FilterTranslation = {
  params: SearchParams;
  /** The chips that made it into the URL. */
  applied: FilterChip[];
  dropped: FilterDropped[];
};

const POSTURE_FOR_URL: Record<string, SearchPosture> = {
  open: "open",
  preselected_only: "preselected",
  unknown: "unknown",
};

function isSearchType(v: string): v is SearchType {
  return (SEARCH_TYPES as readonly string[]).includes(v);
}

/**
 * Translate a normalized filter into the next search state. `replace` starts
 * from an empty search (keeping the person's sort and view); otherwise the
 * new filters layer over `current`. The page always resets to 1.
 */
export function filterToSearchParams(current: SearchParams, filter: NormalizedFilter): FilterTranslation {
  const base: SearchParams = filter.replace ? { ...DEFAULT_SEARCH_PARAMS, sort: current.sort, view: current.view } : current;
  const patch: Partial<SearchParams> = {};
  const applied: FilterChip[] = [];
  const dropped: FilterDropped[] = [];

  const nameChip = filter.chips.find((c) => c.key === "q");
  for (const chip of filter.chips) {
    switch (chip.key) {
      case "q":
        patch.q = chip.value.slice(0, MAX_QUERY_CHARS);
        patch.mode = "name";
        applied.push(chip);
        break;
      case "like":
        if (nameChip) {
          patch.givingTo = chip.value.slice(0, MAX_GIVING_TO_CHARS);
        } else {
          patch.q = chip.value.slice(0, MAX_QUERY_CHARS);
          patch.mode = "thesis";
        }
        applied.push(chip);
        break;
      case "orgType":
        if (isSearchType(chip.value)) {
          patch.type = chip.value;
          applied.push(chip);
        } else {
          dropped.push({ chip, reason: "The search page has no filter for that kind of funder yet." });
        }
        break;
      case "state":
        patch.state = chip.value;
        applied.push(chip);
        break;
      case "posture": {
        const posture = POSTURE_FOR_URL[chip.value];
        if (posture) {
          patch.posture = posture;
          applied.push(chip);
        } else {
          dropped.push({ chip, reason: "That application status is not one the search page knows." });
        }
        break;
      }
      case "ntee":
        patch.ntee = chip.value;
        applied.push(chip);
        break;
      case "minGiving": {
        const n = Number(chip.value);
        if (Number.isFinite(n) && n > 0) {
          patch.minDistributions = Math.round(n);
          applied.push(chip);
        }
        break;
      }
      case "minAssets": {
        const n = Number(chip.value);
        if (Number.isFinite(n) && n > 0) {
          patch.minAssets = Math.round(n);
          applied.push(chip);
        }
        break;
      }
      case "maxAssets":
        dropped.push({ chip, reason: "The search page has no maximum-assets filter yet." });
        break;
    }
  }

  return { params: withParams(base, patch), applied, dropped };
}
