# Organization research protocol

Extend the filing spine with current, attributable web evidence. Include every
organization: no website, no recorded grants, unknown posture, a confirmed web
profile, or a canonical redirect are all valid inventory entries. A download is
evidence acquisition, not completed research or approval.

## Freeze the population

`funderdb research inventory --out data/research/<campaign>/inventory.jsonl`
streams every organization in a repeatable-read, read-only transaction. It checks
the exported count against the same transaction's denominator and writes a
SHA-256/metadata sidecar. No limit, posture filter, minimum assets, or website
requirement removes an organization. A supplied target file is also supported;
its report explicitly says **supplied targets only**.

The existing Greenbook queue prioritizes known websites by distributions and
omits confirmed profiles. It is not an exhaustive census. Use a new campaign
directory for each inventory vintage. Re-parsing old evidence cannot refresh its
observation date. At large scale, run inventory with a read-only session
connection and adequate statement timeout; it reads the filing website view.

When a session connection is unavailable, `research export-api` uses the existing
Supabase public Data API and an enabled publishable key. It makes GET requests
only: no role changes, password resets or privileged key are needed. The access
JSON stays in ignored local storage. UUID/keyset shards resume from hashed raw
pages and stop only on an empty page. A source-binding manifest prevents resuming
against a different project or selection. Up to eight requests can be in flight.

`research compile-inventory` reconciles both organization and unsuperseded filing
website counts against an independently obtained database census. It reduces
filings locally by `(tax_period, object_id)` and preserves registry identifiers,
locality, NTEE, source locators, licenses and selected filing evidence. Supply the
existing confirmed-site export separately. Check that the selected website rows
were parsed and that canonical merges are absent, or provide a merge supplement
before using this API path. The current public view does not expose those fields.

This is a **multi-request observation interval**, not a transactional snapshot.
Reconcile the census at the end; concurrent database ingestion can require a new
vintage or a reconciliation pass. Matching counts alone cannot prove that no
same-count membership changes occurred during export.

## Acquisition states

| State | Meaning | Next step |
| --- | --- | --- |
| pending | Candidate site not fetched in this campaign | Crawl |
| running | Worker owns the current attempt | Crash recovery returns it to pending |
| needs_discovery | No candidate site in the inventory | Search and identity research |
| evidence_ready | At least one HTML page acquired | Identity, completeness and claim review |
| blocked | No usable page acquired | Inspect robots, HTTP, DNS or TLS failure |
| merged | Points to a canonical organization | Check canonical identity; retain in denominator |

Keep inventoried, attempted, evidence-ready, reviewed and published counts
separate. The acquisition workflow cannot confirm a profile or publish a signal.
It reports `all_organizations_researched=false` because it cannot certify the
remaining research and review stages. A blocked page is not a closed funder.

## Identity and website discovery

Start with EIN/CRD/CIK and the latest parsed, unsuperseded filing. Website
precedence is confirmed web fact, filer-stated website, then registry URL. Keep
the selected filing and tax period. A filer-stated site can be stale, a directory,
a trustee or a parent organization.

For missing sites, search exact legal name + EIN + locality. Inspect official
about/contact/financial pages. Record the query, evidence URL, outcome and
uncertainty. A snippet is a discovery lead. An EIN in an official financial
document is strong identity evidence; a similar name alone is weak.

Do not merge entities based on a shared domain. Gates Foundation and its trust
are separate; Pivotal lists several foundations; CZI lists a foundation, an LLC,
a DAF and an advocacy organization. The Oregon Knight Foundation is not the
Florida John S. and James L. Knight Foundation. CHDI Foundation's Huntington's
research site is not the Child Health and Development Institute.

`research assign-website` hashes a discovery amendment and queues a candidate.
It does not approve the entity/domain relationship. Unresolved search results
stay unresolved; never guess a domain to improve a coverage percentage.

`research discovery-next` selects missing-site organizations without a recorded
website search, prioritizing foundations but excluding no organization type.
It emits suggested queries with `search_executed=false`. After actually doing
the work, `research record-step` stores a hashed private record containing
`org_id`, `stage`, `outcome`, `performed_at`, `method`, `queries`, `source_urls`
and `note`. Stages distinguish website search, news search, reverse research,
identity review and claim review. Outcomes remain candidate-found, no-result,
blocked or needs-review; this command never confirms an entity or a claim.

## Evidence surfaces

The worker starts with the seed and supplied URLs, then selects same-site links
across application, program, grant, news, identity and people categories. Default:
six page attempts per organization; maximum twelve per pass. Unvisited URLs are
recorded. Six pages can reveal leads; they do not prove research completeness.

When the seed names a specific program, prioritize links sharing that program's
path and links in the page body before generic navigation. Keep explicitly
supplied research URLs ahead of discovered links. Scholarship, fellowship and
award pages count as grant leads; routine branding, privacy and login pages do
not consume the bounded crawl budget. Preserve their discovered links anyway.
This priority improves depth but does not certify eligibility, identity or
complete coverage of a program's application pages.

| Surface | Enrichment |
| --- | --- |
| About, financials, annual reports | Legal identity, aliases, operating/grantmaking role, current strategy |
| Programs and science pages | Disciplines, disease areas, basic/translational/clinical stage, infrastructure, open science |
| Guidelines, FAQs, linked portals | Applicant type, geography, career stage, nominations, LOI stages, cycle and deadline |
| Grant databases and award lists | Explicit recipient, purpose, amount, currency, award year, duration; commitments versus payments |
| Newsroom, RSS, Atom | Dated program launches, grants, commitments, leadership changes and partnerships |
| Public structured metadata | JSON-LD identity/date leads and feed/resource discovery |
| Staff/contact pages | Public program responsibilities and role channels under existing privacy rules |
| Recipient/university announcements | Reverse discovery and corroboration of specific awards |

Public HTML and JSON-LD acquisition, RSS/Atom discovery and publisher-linked
PDF/CSV/JSON/XML/spreadsheet discovery are implemented. Resource links are leads,
not fetched or parsed datasets. PDF parsing, sitemap
expansion, JavaScript rendering, public grant API pagination, automated web
search and program-specific structured extraction are future adapters. Do not
present them as current features. Do not probe private backends, log in, defeat
CAPTCHAs, or treat a visible endpoint as authorization.

Explicitly labelled EIN mentions (including footer identifiers) are captured as
private identity evidence. An exact target-EIN match is a review aid, not an
automatic identity decision. Publisher-linked machine-readable resources can
guide a later documented API/export adapter without guessing backend endpoints.

## Claim schema and fundraising analysis

Every reviewed claim needs organization/legal-entity scope, program and cycle,
field/value, units/currency, publisher/source class/URL, snapshot hash and locator,
observation date, publication/effective dates if stated, private excerpt, identity
basis, evidence strength, review status and any conflicting/superseded claim.

Review these fields when explicitly supported:

- Scientific discipline, disease, methodology and research stage. Distinguish
  research funding from service delivery, patient assistance or investment.
- Eligible legal entities, fiscal sponsorship, academic affiliation, career
  stage, residency, institutional nominations and geographic restrictions.
- Open inquiry, invited full proposal, rolling LOI, periodic call, or no
  statement. An institution's overall posture is separate from a specific call.
- Opening/deadline dates, time zones and cycle year. An Apply button does not
  establish that applications are currently open.
- Stated award amount/range, duration, cost sharing, indirect costs, allowed
  expenses, reporting requirements and expected research outputs.
- Operating/project support, fellowships, equipment, infrastructure, prizes,
  collaborative awards, PRIs and MRIs as explicitly described.
- Named past recipients, partners, program officers and official inquiry paths.

Never infer eligibility from a past grantee, check size from assets, or interest
in an applicant from thematic overlap. Qualifying distributions can include
operating expenditures and in-kind medicine: they are a triage measure, not a
measure of cash grants open to outside nonprofits.

## Reverse research and news

Inspect latest unsuperseded grants. Select and document recent recipients across
programs. Search their official sites for the funder's name, program, award and
year. Keep recipient claims attributed to recipients and link only with explicit
evidence. Record no-result outcomes too. Similar names or topics do not prove an
award or partnership. This remains an analyst stage, not a completed crawler
feature.

News can reveal leads and strategy shifts. Seek the original funder announcement
before promoting eligibility, amounts or deadlines. Separate publication, event
and observation dates. Deduplicate syndication; do not count an announcement and
a later IRS payment as two awards without identifier-level evidence.

The additional watch list uses the existing first-party signals source category.
Third-party reporting stays an attributed research lead pending the repository's
license review. Do not silently relicense it into the public dataset.

## Conflicts and freshness

Prefer explicit current-cycle guidelines over general pages. Compare effective
dates and scope, not download timestamps. A newer page about a different cycle
does not supersede an old cycle's amount. Preserve both assertions if uncertain.

Initial research surfaced useful examples: Packard's 2026 announcement and its
general fellowship page state different amounts; Templeton's process describes
applying while its portal says the 2026 window is closed; HHMI rejects unsolicited
proposals while offering named competitions; McDonnell's current mission focuses
on St. Louis economic opportunity despite historical science funding. Specific
source links and candidate notes belong in the dated research report.

Suggested refresh policy for a future scheduler: current calls and approaching
deadlines daily; news weekly; program/eligibility quarterly; identity annually
and after redirects/renames. These are proposed cadences, not scheduled jobs.

## Provenance, privacy and publication

Each page and robots response is hashed and saved before extraction. HTML,
excerpts and JSON-LD stay in gitignored `data/research/`, defaulting to
`publisher_website`, nonrepublishable. Web values never overwrite government
organization rows. Only original URL/identifier compilations and short original
research notes enter seed files. Register them in `internal.raw_files` before
loading source/candidate rows and bracket the load in the ingestion ledger.
Future claim imports must separately register publisher snapshots.

Existing contact redaction, entity-resolution gates and public-view filters
remain. Publication approval stays in Greenbook or the existing signals path.
Agents never write `reviewed_by=human:*` for their own decisions. Do not use
`--auto-publish` for a new source family. No outreach is part of this workflow.

## Crawl conduct and recovery

Check robots for each path and after redirects; combine matching groups, use
longest-match rules with Allow winning ties, and support wildcard/end anchors
and percent-encoded paths per [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html).
Missing policies (404/410) permit requests; denied/unknown/server-error responses
defer them. Cache policies for at most 24 hours. Crawl delays above 30 seconds
defer the target rather than blocking the worker.

Identify the crawler, pace per host, validate public IPs and pin the socket to a
checked address, preserve TLS validation, recheck redirects and cap responses at
2 MiB. No cookies or credentials. Record failures without changing posture.
SQLite commits after each organization; one worker process holds the campaign lock.
Crashes release the lock; restarts recover interrupted rows. Explicit retries
preserve prior results and snapshots rather than looping on denial.

`research work` runs bounded concurrent acquisition with one shared pacing lock
per hostname. Server crawl delays apply across workers. Robots permission policies expire
after 24 hours and the in-memory policy cache is bounded. New snapshots use
deterministic gzip, SHA-256 of the stored bytes and a separate uncompressed hash,
with two-character directory shards. `read_snapshot` validates and reads old and
new formats. Results use directory shards too; retries archive earlier results.
The worker stops claiming new jobs below 10 GiB free disk and drains active jobs.
Use `--follow` to await newly attributed websites after the current queue empties.
Following an empty queue does not mean research is complete.

Successful page references can be reused for one hour across organizations that
share a URL; original observation dates and hashes remain intact. Only references
are cached in memory. Reuse never merges identities. Retry-After deferrals apply
across workers on the same host, and denied robots responses are cached to avoid
repeated requests from organizations sharing a domain.

`research carry-forward` reuses exact prior result bytes for matching UUIDs before
starting the worker. It preserves acquisition dates and private snapshot references;
it does not turn old evidence into a fresh observation. Keep the previous campaign
directories available. Coverage reports are cheap count summaries by default;
`--export-discovery` explicitly streams the potentially very large missing-site list.

## Commands and completion

```bash
cd corpus
uv run funderdb research inventory --out data/research/full/inventory.jsonl
uv run funderdb research init --targets data/research/full/inventory.jsonl --run data/research/full
uv run funderdb research crawl --run data/research/full
uv run funderdb research report --run data/research/full

# Alternative full inventory using existing public Data API access:
# access.json: {"url":"https://<project>.supabase.co","key":"<publishable-key>"}
# Keep it under data/research/ and chmod 600; never commit it.
uv run funderdb research export-api --access data/research/access.json --run data/research/full
uv run funderdb research compile-inventory --run data/research/full \
  --expected-organizations <live-census> --expected-filings <live-website-filing-count> \
  --confirmed-sites data/research/confirmed-sites.json
uv run funderdb research init --targets data/research/full/inventory.jsonl --run data/research/full
uv run funderdb research carry-forward --run data/research/full --previous data/research/science
uv run funderdb research work --run data/research/full --workers 8 --follow
uv run funderdb research discovery-next --run data/research/full --limit 20
uv run funderdb research record-step --run data/research/full --record data/research/actual-search.json

# Reproduce the supplied science-funder acquisition without a model/database key:
uv run funderdb research init --targets data/seed/research/science-funders-2026-10-17.jsonl --run data/research/science
uv run funderdb research crawl --run data/research/science

# Attribution of a discovered candidate:
uv run funderdb research assign-website --run data/research/full --org-id <uuid> \
  --url <candidate-url> --evidence-url <source-url> --note '<basis and uncertainty>'

# Existing first-party signals path (writes need DATABASE_URL):
uv run funderdb signals load-sources --csv data/seed/science_signal_sources.csv
uv run funderdb signals poll
uv run funderdb signals process --limit 50
```

The SQL inventory needs a read-only Postgres session connection; the alternative
API inventory uses an existing publishable key. Local acquisition needs
no model key and makes no model API calls. Existing model classification uses its
configured provider key. These commands create no background scheduler.

Completion means every inventory organization has a documented research
disposition: identity checked, website/news/reverse research performed or a
specific blocker recorded, claims reviewed, and approved updates applied through
provenance-preserving paths. Report remaining counts honestly. Estimate large-run
costs from measured throughput, page sizes and actual model usage. A million
inventory rows are not a million researched funders.
