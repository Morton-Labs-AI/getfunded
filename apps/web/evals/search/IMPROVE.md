# Improving search: the loop

For a coding agent (or a person) asked to make funder search better. Search is
better when the scorecard says so; read [README.md](README.md) for what each
number means.

## Before you change anything

1. Read `lib/search/sql.ts` (the header explains every leg), `lib/search/rank.ts`
   (the weights), `lib/search/understand.ts` and `lib/search/context.ts`.
2. Deploy a preview of the current code with the eval token and run the suite:

   ```sh
   cd apps/web
   npm run eval:search -- --target <preview-url> --label before
   ```

   Read `evals/search/out/<stamp>-before.md`: the scorecard, the weakest
   cases (with their top 3), and the per-cause table.

## One iteration

1. **Pick one thing**: the worst failing guard, or the weakest cause, or one
   failing case that stands for many. Write down what you think causes it,
   from the top-3 lists and the facts, before you touch code.
2. **Change one thing**: a weight in `rank.ts`, a leg's limit or order in
   `sql.ts`, a rule in `understand.ts`. Small and explainable.
3. **Check the build**: `npx tsc --noEmit`, then the unit tests for what you
   touched (`npx vitest run tests/unit/search`).
4. **Measure**: deploy a preview, run the suite with `--label after-<what>`.
   Use `--sample 12` while exploring; finish with a full run.
5. **Keep it only if** the measure you aimed at improved and no guard got
   worse beyond the tolerance in `thresholds.json` (the runner prints
   "regressed"). Speed counts: a relevance gain that breaks the latency guard
   is not a gain.
6. **Record it**: commit with the before and after numbers of the measures that
   moved. On a milestone, re-run with `--save-report --update-baseline` and
   commit the report and `baseline.json`.

Do not edit a case or a threshold to make a run pass. If a case is wrong (the
funder named in a navigational case changed its EIN, say), fix it in its own
commit and say so.

## Growing the golden labels

The data-derived measures say whether a funder gives in a state or to a cause;
they cannot say whether it is a *good* lead for a particular nonprofit.
Judged labels can:

```sh
node evals/search/judge.mjs packets --run evals/search/out/<stamp>-<label>.json --limit 40
```

writes `evals/search/out/packets-*.jsonl`: for each unlabeled (case, funder)
pair in a top 10, the nonprofit's profile or query and the funder's evidence
(top grant purposes, recipient states, NTEE mix, posture, median grant). Grade
each 2 (a strong lead), 1 (plausible), 0 (not a fit), with one sentence why,
into `labels/golden/<case>.jsonl` as
`{"case":..,"orgId":..,"label":0|1|2,"why":"..","judgedBy":"<model or name>","at":"YYYY-MM-DD"}`.
`node evals/search/judge.mjs score --run <out json>` then reports nDCG@10 and
P@10 over the judged pairs. Labels accumulate: each run only needs the pairs
nobody has judged yet.

## Where the known opportunities are

The 2026-10-26 review (`reports/`) left these:

- The giving profiles (corpus 0040) must be filled (`uv run funderdb
  refresh-views`) before "gives in" and "funds this cause" work and before
  ranking switches from the summary's top states to exact counts. Measure
  again after the fill: geography and cause should move most.
- About 45 to 50 thousand foundations have no search document (no grants on
  file in the corpus), so topic search cannot find them at all.
- Search summaries spell states as codes ("OH"); embedding them with the full
  name too would help meaning-based search with places.
- Recipient NTEE links cover about 46% of grant rows; Tier-3 recipient matching
  in the corpus would lift the cause measures.
