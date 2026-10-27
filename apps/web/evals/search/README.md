# Search eval suite

Is funder search fast, accurate, useful to every kind of nonprofit, and does it
change for the organization that is searching? This suite answers with numbers,
so anyone (a person, a coding agent, the weekly workflow) can change search and
know whether it got better. [IMPROVE.md](IMPROVE.md) is the loop to follow.

## Run it

```sh
cd apps/web
npm run eval:search -- --target prod --sample 10            # a quick look at getfunded.ai
npm run eval:search -- --target <preview-url> --save-report # a full run on a preview
```

A run makes about 460 searches (fewer with `--sample N`), writes everything to
`evals/search/out/` (ignored by git), prints the scorecard, and exits non-zero
when a guard in `thresholds.json` fails or a measure regresses against
`baseline.json`. `--save-report` also writes `reports/<date>-<label>.{md,json}`:
commit those for milestone runs. `--update-baseline` makes the run the new
baseline.

### Targets and the eval token

| Target | How requests go | Rate limit | Relevance facts |
|---|---|---|---|
| `prod` (getfunded.ai) | `fetch` | public, 30 a minute: the runner throttles to 25 | from `--facts-from` (a preview) |
| a preview (`*.vercel.app`) | `vercel curl` (uses the project's own protection bypass; run from `apps/web`) | lifted by the eval token | from the preview itself |
| `local` (`npm run dev`) | `fetch` | lifted by the eval token | from the dev server |

The eval token is `EVAL_TOKEN` in your environment or in
`apps/web/.env.development.local` (gitignored). A deployment honours it only
when it was created with the same value, for a preview:

```sh
vercel deploy --env EVAL_TOKEN=$TOKEN --build-env EVAL_TOKEN=$TOKEN
```

Production sets no token, so its rate limit stays on and `/api/eval/facts` is a
404 there. Never set `EVAL_TOKEN` as a project-wide environment variable.

## What it measures

Every relevance number is computed from the funders' **own grant records**
(`/api/eval/facts`, lib/queries/corpus/eval-facts.ts), never from what search
said about them, and every number divides by 10, so an empty slot counts as a
miss.

| Measure | Meaning |
|---|---|
| `error_rate`, `degraded_rate` | Searches that failed; searches that timed out and were answered another way |
| `latency.*` | Client and server time by mode (server time from the response's `timing`) |
| `topical.funder_rate_at10` | Share of the top 10 with paid grants on file: is it a funder at all? |
| `topical.topic_match_at10` | Share with ≥ 2 grants on the case's topic (grant purpose or recipient text), or ≥ 3 grants to organizations in its NTEE group, in the last five fiscal years |
| `topical.geo_match_at10` | For cases with a place: share that paid ≥ 1 grant to a recipient in that state in the last five fiscal years |
| `topical.recency_at10` | Share whose latest grant is within three years of the corpus's latest fiscal year |
| `topical.coverage` | Cases with at least 10 results |
| `navigational.at3` | A funder typed by name (or EIN) is in the top 3 |
| `personalization.*` | The same words searched by 100 synthetic nonprofits, with and without their profile. Guarded: the share of the top 10 that gives in their state (`geo_with_profile`) and funds their cause (`cause_with_profile`) with the profile attached, and how different twins' lists are (`twin_jaccard_*`, lower is more personal). Reported only: the lift over the same words without the profile (`geo_lift`, `cause_lift`), which also falls when the results without a profile get better |
| `determinism` | The same search twice gives the same top 20 |

### The cases

- `cases/industries.json`: 24 NTEE major groups × 3 phrasings (a short topic, a
  sentence, a sentence with a place). Every kind of nonprofit gets a turn.
- `cases/robustness.json`: typos, capitals, a city instead of a state, a pasted
  mission paragraph, a question.
- `cases/navigational.json`: well-known funders by name and by EIN (checked
  against the corpus).
- `cases/profiles.mjs`: 100 seeded synthetic nonprofits. 10 pairs differ only
  by state, 10 only by cause, 10 only by budget, and 40 are mixed. Each runs the
  two shared queries in `SHARED_QUERIES` and its own mission sentence, with
  its profile (`for_state`, `for_cause`, `for_budget`, `for_city`) and
  without.
- `cases/causes.json`: what each NTEE group's grants say (the topic words the
  facts count), and the mission sentences profiles use.

Change a case only to fix it, and say why in the commit: a case edited to pass
is a measure lost.

## Files

| File | Role |
|---|---|
| `run.mjs` | The runner (searches, determinism, facts, scorecard, report) |
| `lib/http.mjs` | `fetch` or `vercel curl`, throttling, a small worker pool |
| `lib/facts.mjs` | `/api/eval/facts` with a week-long disk cache (`.cache/`, ignored) |
| `lib/metrics.mjs` | The measures above, guards and regressions |
| `lib/report.mjs` | The markdown scorecard |
| `judge.mjs` | Packets for agent-judged relevance labels (`labels/golden/`) |
| `thresholds.json` | Guard targets and regression tolerances |
| `baseline.json` | The run later runs are compared to |
| `reports/` | Milestone scorecards, committed |
