import { SearchX } from "lucide-react";

import { NlFilterBar } from "@/components/ai/nl-filter-bar";
import { SaveFunderButton } from "@/components/workspace/save-funder-button";
import { NO_RESULTS_HINT, NO_RESULTS_TITLE, RESULT_COUNT, SEARCH_TAGLINE, SEARCH_TITLE, SORTED_WITHIN_POOL_NOTE } from "@/lib/content/copy";
import { searchFunders, emptyResult, timedOutResult } from "@/lib/queries/corpus/search";
import { softFail } from "@/lib/queries/corpus/safe";
import { getCorpusCounts } from "@/lib/queries/corpus/stats";
import type { SearchHit, SearchResult } from "@/lib/queries/corpus/types";
import { limitSearchRender } from "@/lib/search/limit";
import { isEmptySearch, parseSearchParams, type RawSearchParams } from "@/lib/search/params";

import { FilterChips } from "./filter-chips";
import { FilterControls } from "./filter-controls";
import { SearchNotices } from "./notices";
import { Pager } from "./pager";
import { ResultCards, ResultsTable, type RenderSave } from "./results";
import { SearchForm } from "./search-form";
import { SearchLanding } from "./search-landing";

export type SearchViewProps = {
  mode: "public" | "app";
  searchParams: RawSearchParams;
  /** The workspace plan, in app mode (for the AI filter bar's gating copy). */
  plan?: string;
  /** org id → saved_funders.id, when the app page already knows what is saved. */
  savedByOrg?: Record<string, string>;
};

/**
 * The search surface, shared by /search (public) and /app/search (app).
 * Server component: parses the URL, rate limits, runs the query, renders.
 * In app mode every result gets a save button and the natural-language
 * filter bar sits under the query box.
 */
export async function SearchView({ mode, searchParams, plan, savedByOrg }: SearchViewProps) {
  const params = parseSearchParams(searchParams);
  const base = mode === "app" ? "/app/search" : "/search";
  const funderBase = mode === "app" ? "/app/funders" : "/funder";

  const renderSave: RenderSave | undefined =
    mode === "app"
      ? (hit: SearchHit) => {
          const savedFunderId = savedByOrg?.[hit.orgId];
          return <SaveFunderButton orgId={hit.orgId} snapshot={hit.snapshot} saved={Boolean(savedFunderId)} savedFunderId={savedFunderId} />;
        }
      : undefined;

  const header = (
    <header className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{SEARCH_TITLE}</h1>
      <p className="text-sm text-muted-foreground">{SEARCH_TAGLINE}</p>
    </header>
  );

  if (isEmptySearch(params)) {
    const counts = await softFail("corpus counts", null, () => getCorpusCounts());
    return (
      <div className="flex flex-col gap-6">
        {header}
        <SearchForm current={params} base={base} />
        {mode === "app" ? <NlFilterBar current={params} /> : null}
        <SearchLanding base={base} counts={counts} />
      </div>
    );
  }

  const gate = await limitSearchRender();
  let result: SearchResult;
  if (gate.ok) {
    try {
      result = await searchFunders(params);
    } catch (err) {
      // The statement timeout is an answer, not a crash: say so and keep the
      // form and filters on screen. Anything else still reaches the error page.
      const timedOut = timedOutResult(err, params);
      if (!timedOut) throw err;
      result = timedOut;
    }
  } else {
    result = emptyResult(params, { notices: ["rate_limited"], retryAfterSec: gate.retryAfterSec });
  }

  const shown = result.hits.length;
  const sortedWithinPool = result.ran !== null && result.ran !== "ein" && result.params.sort !== "relevance";

  return (
    <div className="flex flex-col gap-5" data-plan={plan}>
      {header}
      <SearchForm current={params} base={base} />
      {mode === "app" ? <NlFilterBar current={params} /> : null}
      <FilterControls current={params} base={base} />
      <FilterChips params={params} base={base} />
      <SearchNotices result={result} />

      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-ink-3">
        <p className="tnum" aria-live="polite">
          {RESULT_COUNT(shown, result.total, result.truncated)}
        </p>
        {sortedWithinPool && result.total > 0 ? <p className="text-xs">{SORTED_WITHIN_POOL_NOTE(result.poolLimit)}</p> : null}
      </div>

      {shown === 0 ? (
        gate.ok ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-12 text-center">
            <SearchX className="size-6 text-ink-4" aria-hidden />
            <p className="font-medium text-foreground">{NO_RESULTS_TITLE}</p>
            <p className="max-w-md text-sm text-muted-foreground">{NO_RESULTS_HINT}</p>
          </div>
        ) : null
      ) : params.view === "table" ? (
        <ResultsTable hits={result.hits} funderBase={funderBase} renderSave={renderSave} />
      ) : (
        <ResultCards hits={result.hits} funderBase={funderBase} renderSave={renderSave} />
      )}

      <Pager params={params} base={base} total={result.total} pageSize={result.pageSize} />
    </div>
  );
}
