# Funder signals

*A funder's own dated announcement, found, classified once, and routed to the people it concerns.*

On 2026-10 the MacArthur Foundation announced it was dedicating $750 million to impact
investments through 2028, an impact-first approach across program-related investments (which
reach nonprofits) and mission-related investments from the endowment (which can back for-profit
companies and funds). A fundraiser at a nonprofit and a founder of a first-of-a-kind clean energy
company should both have heard about it the day it happened. Neither product could tell them,
because filings describe what a foundation did eighteen months ago and nothing in the corpus
carried a press release. This document is the design that fixes that, across every Morton Labs
repository.

## 1. The idea in one paragraph

A **signal** is a dated, sourced public announcement about a funder that changes what, whom or
how it funds. Signals are a **corpus fact**: fetched, snapshotted and classified **once** in the
shared Open Funder Database (`internal.funder_signals`, corpus migration 0032), linked to the
organization row every app already uses, and published by a human. Each workspace app then does
its own **relevance matching** over its own private data (saved funders, owners, initiatives,
lists, profile) and writes **notifications** for the right people, with the reasons on the row.
Nothing is estimated; every classified field is backed by a passage quoted from the page; the
summary is labelled as the model's paraphrase everywhere it renders.

## 2. Where each piece lives

| Layer | Repository | What |
|---|---|---|
| Fact table, pipeline, public view | `open-funder-db` and `getfunded/corpus` (same files, migration `0032_funder_signals.sql`) | `internal.signal_sources` (watch list), `internal.funder_signals`, `internal.funder_signal_orgs`; `funderdb signals load-sources · add · add-urls · poll · process · publish · reject · status`; `public.funder_signals` + `public.funder_signal_orgs` |
| Human review gate | `open-funder-db-ui` (`/admin/signals`, dev-only) | Publish / reject / reopen candidates; record a URL by hand (file-first, EIN-linked) |
| Read-only profile | `open-funder-db-ui` (`/org/[id]` → Signals) | Published signals with the Provenance Seal |
| Free + paid product | `getfunded/apps/web` | Profile section, bell, `/app/notifications`, Settings → Notifications, dashboard panel, door `getfunded.sync_signal_notifications()` on `/api/cron/signals` (migrations `getfunded_0015`, `getfunded_0016`) |
| Private tenant (DNW) | `dnw-funder-intelligence` | Signals tab (count badge), existing bell gains two kinds, `funder_signal` timeline activity, `dnw.sync_signal_notifications()` (migration `dnw_0021`), `npm run signals:sync` |
| Morton Labs' own CRM | `morton-fundraising` | Workspace `signals` + `signalAlerts`; flag a URL in the app or a LinkedIn/X post from the extension; `/api/signals/classify` runs the same classifier against the same vocabulary; `/signals` page; dashboard nudges |
| Lovable prototype | `get-funded` | `public.funder_signals`, insert trigger → `notifications` (+ `href`), edge function `funder-signals`, organization card |

## 3. The data

### 3.1 Vocabulary (a CHECK in Postgres, a zod/pydantic enum in code; identical everywhere)

| Field | Values |
|---|---|
| `signal_type` | `capital_commitment`, `program_launch`, `rfp_open`, `deadline`, `grant_announced`, `investment_announced`, `fund_close`, `strategy_shift`, `leadership_change`, `partnership`, `event`, `other` |
| `eligible_recipients[]` | `nonprofit`, `for_profit`, `fund`, `government`, `academic`, `individual`, `unspecified` |
| `instruments[]` | `grant`, `pri`, `mri`, `equity`, `debt`, `guarantee`, `prize`, `contract`, `technical_assistance`, `unspecified` |
| `sectors[]` | `climate`, `clean_energy`, `nuclear_energy`, `energy_other`, `environment_conservation`, `health`, `education`, `housing`, `economic_opportunity`, `journalism_media`, `democracy_civic`, `arts_culture`, `science_research`, `criminal_justice`, `international_development`, `human_services`, `other` |
| `amount_usd`, `amount_kind` | a figure **stated on the page in USD**, else NULL; `total_commitment`, `annual_budget`, `per_award`, `single_award`, `fund_size`, `range`, `other` |
| `horizon_end` | "through 2028" → `2028-12-31` |
| `relevance` | the classifier's triage: `high`, `medium`, `low`, `none` |
| `status` | `candidate` → `published` \| `rejected` (→ `superseded` when a newer row replaces it) |

The MacArthur example classifies as `capital_commitment`, `$750,000,000` `total_commitment`,
recipients `nonprofit` + `for_profit` + `fund`, instruments `pri` + `mri`, sectors `clean_energy`
+ `climate` + `economic_opportunity`, horizon `2028-12-31`.

### 3.2 Two files, two licences

Every row carries two provenance pointers. `raw_file_id` is **our** run manifest or seed CSV
(licence `cc_by`): the URL, headline, date, amount and classification are facts we compiled.
`snapshot_raw_file_id` is the **publisher's** page as fetched (licence `publisher_website`,
`republishable = false`). `public.funder_signals` joins on the first, so it passes the
`licensing_map` filter like every other public view, while the publisher's expression never
leaves `internal`: verbatim excerpts live only in `raw_source`, which no view selects.

### 3.3 Org links

`internal.funder_signal_orgs (signal_id, org_id, role, match_method, confidence)`. Roles:
`subject`, `partner`, `recipient`, `investee`. Methods, strongest first: `source_feed` (the watch
list says this newsroom is org X), `ein` (a person supplied it), `manual`, `name` (exactly one
canonical normalized-name match, never more), `model` (the classifier named it; 0.6).
Workspace apps join on `org_id`, which is the same soft reference their saved funders already
carry.

## 4. The pipeline (`funderdb signals`)

```
load-sources   data/seed/signal_sources.csv  → internal.signal_sources   (EIN resolved; unresolved reported)
add / add-urls a URL (+EIN, +how it was found) → one 'candidate' row, file-first (submission JSON, cc_by)
poll           due sources (RSS / Atom / HTML index + link regex) → new 'candidate' rows (poll manifest, cc_by)
process        robots.txt → fetch (2 MiB cap) → snapshot (publisher_website) → extract title/date/text
               → classify (Claude structured output, or SIGNALS_AI_MODE=mock) → VERIFY every excerpt
               → link orgs → 'candidate' (or 'rejected' by model triage, or 'published' with --auto-publish)
publish/reject the human decision (also the Greenbook console)
```

Rules the code enforces: a field whose excerpt is not on the page is dropped, not trusted;
`amount_usd` is never derived; mock-mode rows carry `extraction_model = 'mock'` and can never
auto-publish; every run brackets its writes in `internal.ingestion_ledger`.

## 5. Relevance: a score with reasons

Each app computes the same shape over its own data and stores the reasons on the notification,
so the bell can say *why* in words and nobody re-derives the score.

| Signal | Points | Reason code | GetFunded | DNW | Morton Capital |
|---|---|---|---|---|---|
| The org is tracked here | +50 | `saved` / `tracked` | saved funder | saved funder | on a list, in the pipeline, or has a contact |
| This person owns it | +15 | `owner` | `saved_funders.owner_id` | `owner_user_id` | opportunity or contact owner |
| This person has an open task on it | +10 | `task` | — | `tasks.assigned_to` | — |
| Our kind of org is eligible | +20 | `eligible` | nonprofits | nonprofits | companies (Startup profile) or nonprofits |
| A sector matches our thesis | +15 | `sector` / `initiative` | profile `program_areas` + `keywords` → `signal_sector_keywords` | active `initiatives.keywords` → `signal_sector_keywords` | profile `sectors` → map in `lib/signals.ts` |
| Actionable type | +10 | `actionable` | commitment, program, call, deadline, strategy | same | same |
| Amount ≥ $10M | +5 | `amount` | ✓ | ✓ | ✓ |
| Names our geography | +5 | `geography` | profile state | CA / NV | — |

**Floors.** A tracked funder alerts at 50 (tracking alone is enough). An untracked funder is a
**discovery** and alerts at 40: eligibility plus a sector match plus something actionable or
large. Discovery alerts are a paid feature in GetFunded (Starter and above; every self-install);
admins-only in DNW; every member in Morton Capital. Per-person floors are adjustable in
GetFunded (Settings → Notifications).

**Recipients.** GetFunded: every member with alerts on (preferences are per person).
DNW: the funder's owner, anyone with an open task on it, whoever saved it; nobody specific →
everyone active; discoveries → admins. Morton Capital: every member who clears the floor.

**Idempotency.** A cursor per workspace (`signal_cursors` / `dnw.signal_cursor`) and a unique
`(user, signal)` index. A brand-new workspace starts 30 days back, not at the beginning of time.
The sync runs from `/api/cron/signals` (Vercel, every 6 hours) in GetFunded, from
`npm run signals:sync` or pg_cron in DNW, and inline at classify time in Morton Capital.

## 6. Surfaces

- **Funder profile → Signals**: date, type, amount and chips as Source-class facts with the
  Provenance Seal (GetFunded) / SourceFact popover (DNW) / SourceGlyph (Greenbook) to our
  compilation file; the paragraph in an AI card with its reason. Renders nothing when there are
  none.
- **Bell**: unread count and the recent eight; each row carries its reason chips (and
  "Discovery" when the funder is not saved). Mark all read is one action.
- **Notifications page**: all / unread, reasons, relevance score, link to alert settings.
- **Timeline**: a `system` (GetFunded) or `funder_signal` (DNW) activity on the saved funder, so
  the announcement sits next to the calls and notes it should prompt.
- **Dashboard**: GetFunded panel "Funder signals" (saved funders' latest); Morton Capital nudges
  ("3 funder announcements concern you").

## 7. What is deliberately not here

- **E-mail and Slack.** GetFunded records `email_digest` per person but has no transactional
  sender (outreach goes through the user's own Gmail, which is not a channel for system mail).
  DNW decided notifications are in-app only. When a sender exists, the digest reads the same
  rows.
- **Automatic publication at scale.** `--auto-publish` exists behind a confidence floor and a
  linked org, writes `reviewed_by = model:<id>`, and is off by default. Turn it on after the first
  hundred human decisions agree with the model.
- **Writing the corpus from an app.** DNW and GetFunded never write `internal.*`. Morton Capital
  classifies locally with the same schema so a confirmed record can be contributed through
  `funderdb signals add` later; that contribution path is manual today.
- **Web search as the source.** Signals come from the funder's own newsroom (watch list) or from
  a person. Third-party news coverage would need a licence decision first.

## 8. Operating it

```bash
# corpus (either repo), once per 6-24 h, after the migration is applied
uv run funderdb signals load-sources
uv run funderdb signals add-urls                     # the curated examples
uv run funderdb signals poll
uv run funderdb signals process --limit 50           # ANTHROPIC_API_KEY, or SIGNALS_AI_MODE=mock
uv run funderdb signals status
# review in Greenbook at /admin/signals, or: uv run funderdb signals publish <id>

# apps
curl -H "Authorization: Bearer $CRON_SECRET" https://getfunded.ai/api/cron/signals
DNW_ACTOR=<admin id> npm run signals:sync            # dnw-funder-intelligence
```

Environment: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-opus-5-5`),
`SIGNALS_AI_MODE` in the corpus; `CRON_SECRET` in GetFunded; nothing new in DNW; Morton Capital
reuses `ANTHROPIC_API_KEY` / `RESEARCH_MODEL`.
