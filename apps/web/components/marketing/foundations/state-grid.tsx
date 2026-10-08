import Link from "next/link";

import { US_STATES } from "@/lib/content/labels";
import { formatNumber } from "@/lib/format";
import { searchHref } from "@/lib/search/params";

import { getFoundationStateCounts } from "./state-counts";

/**
 * Plain names for the codes in US_STATES (lib/content/labels.ts), which is
 * the same list the search filter offers, so every tile lands on a filter
 * the search page knows. A code with no name here shows as the code.
 */
const STATE_LABELS: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  PR: "Puerto Rico",
  VI: "U.S. Virgin Islands",
  GU: "Guam",
  AS: "American Samoa",
  MP: "Northern Mariana Islands",
};

const STATES: Array<{ code: string; name: string }> = US_STATES.map((code) => ({
  code,
  name: STATE_LABELS[code] ?? code,
})).sort((a, b) => a.name.localeCompare(b.name));

/** `/search?type=private_foundation&state=XX`, built by the search validator's own serializer. */
export function stateSearchHref(code: string): string {
  return searchHref("/search", { type: "private_foundation", state: code });
}

/**
 * Every state as a link to its private foundations in search, with a live
 * count beside it. When the database cannot be reached the same grid renders
 * with no numbers and one sentence that says so; the links still work.
 */
export async function StateGrid() {
  const counts = await getFoundationStateCounts();

  return (
    <div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {STATES.map((state) => {
          // The view has a row for every state that holds at least one
          // foundation, so a state with no row is a real zero.
          const n = counts ? (counts[state.code] ?? 0) : null;
          return (
            <li key={state.code}>
              <Link
                href={stateSearchHref(state.code)}
                data-state={state.code}
                className="flex h-full items-baseline justify-between gap-1.5 rounded-md border bg-card px-2.5 py-2 text-sm transition-[border-color,box-shadow] duration-150 hover:border-primary-border hover:shadow-card sm:gap-2 sm:px-3"
              >
                <span className="min-w-0 font-medium text-pretty [overflow-wrap:anywhere] text-foreground">{state.name}</span>{" "}
                {n === null ? null : (
                  <span className="tnum shrink-0 font-mono text-xs text-ink-3 sm:text-[13px]">
                    {formatNumber(n)}
                    <span className="sr-only"> private foundations</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-pretty text-ink-3">
        {counts
          ? "The number is how many private foundations you can search in that state right now. It comes live from the database and is kept for a few hours. The download can hold fewer, because it lists only the foundations that file Form 990-PF electronically."
          : "Live counts are not available right now. The links still work, and each one opens the private foundations in that state."}
      </p>
    </div>
  );
}
