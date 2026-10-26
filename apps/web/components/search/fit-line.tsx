import { FileCheck } from "lucide-react";

import { formatMoneyCompact, formatNumber } from "@/lib/format";
import type { SearchFit } from "@/lib/queries/corpus/types";
import { CAUSE_WORDS } from "@/lib/search/context";
import { stateName } from "@/lib/search/understand";

function years(fit: SearchFit): string {
  return fit.windowFirstFy && fit.windowLastFy ? `, FY${fit.windowFirstFy}–${fit.windowLastFy}` : "";
}

/**
 * The facts behind a topic result's place in the list, from the funder's own
 * filings: grants paid in the searcher's state and to groups like theirs, and
 * the typical size of a grant. SOURCE class (teal, document glyph), because
 * each is a count of filed grant rows, not a judgment. Nothing is shown that
 * was not computed; an absence is not a finding.
 */
export function fitFacts(fit: SearchFit | null): string[] {
  if (!fit) return [];
  const out: string[] = [];
  const place = fit.state ? stateName(fit.state) : null;
  if (fit.tier === "profiles") {
    if (place && fit.inState5y && fit.inState5y > 0) out.push(`${formatNumber(fit.inState5y)} grant${fit.inState5y === 1 ? "" : "s"} in ${place}${years(fit)}`);
    if (fit.cause && fit.cause5y && fit.cause5y > 0) {
      const label = CAUSE_WORDS[fit.cause]?.label ?? fit.cause;
      out.push(`${formatNumber(fit.cause5y)} grant${fit.cause5y === 1 ? "" : "s"} to ${label} groups${years(fit)}`);
    }
    if (fit.median5y && fit.grants5y) out.push(`Median grant ${formatMoneyCompact(String(fit.median5y))} (${formatNumber(fit.grants5y)} grants${years(fit)})`);
  } else if (place && fit.topStates?.includes(fit.state ?? "")) {
    const rank = fit.topStates.indexOf(fit.state ?? "") + 1;
    out.push(rank === 1 ? `Gives most in ${place}` : `${place} is among its top recipient states`);
  }
  if (place && fit.located) out.push(`Based in ${place}`);
  return out;
}

export function FitLine({ fit }: { fit: SearchFit | null }) {
  const facts = fitFacts(fit);
  if (facts.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-source" aria-label="Why this funder fits">
      {facts.map((f) => (
        <li key={f} className="inline-flex items-center gap-1">
          <FileCheck className="size-3 shrink-0" aria-hidden />
          <span className="data-source">{f}</span>
        </li>
      ))}
    </ul>
  );
}
