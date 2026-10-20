# Funder-focused identity validation

October 20, 2026. Original source annotation and analysis: Codex.

The requested challenge-set validation is complete. **Keep broad scaling on
hold.** Better EIN recovery does not resolve publisher identity: seven of the
18 existing exact-EIN hints identify directory pages. Source-scope review supports
15 of the 40 candidate entity/domain associations, while only two primary sites
explicitly invite requests from outside organizations. These are source-supported
leads, not verified current funders or newly discovered websites.

| Measure | Legacy v1 | Fixed v2 |
| --- | ---: | ---: |
| Usable source EIN pairs recovered | 167/179 (93.3%) | 171/179 (95.5%) |
| Usable-EIN precision | 167/168 (99.4%) | 171/172 (99.4%) |
| Complete usable identifier sets correct per distinct normalized text | 173/179 | 177/179 |
| Existing exact-EIN hint precision for primary-site identity | 11/18 (61.1%) | 11/18 (61.1%) |
| Existing exact-EIN hint recall against 15 scoped source bridges | 11/15 (73.3%) | 11/15 (73.3%) |
| Paired extraction wall time | 1.905 seconds | 2.135 seconds |
| Paired extraction CPU time | 1.767 seconds | 1.971 seconds |
| Wall time per correctly recovered usable EIN pair | 11.4 milliseconds | 12.5 milliseconds |
| Repeated within-snapshot mentions, excluded from unique yield | 11 | 16 |

V2 recovers four additional source/EIN pairs: a 2.2-percentage-point recall gain.
One explicit all-zero placeholder for an unidentified organization is emitted by both
versions and counts as a false *usable* EIN. Every emitted token occurs literally
in its source; literal span correctness does not establish legal validity. Eight
EINs in one directory table are missed because their shared column header is
separated from the numbers. The fix was not tuned or changed after these results.

The existing exact-set classifier is a **semantic-review-pending hint**, never an
approval. Seven directory profiles produce misleading primary-site hints, while
four legitimate scoped primary-site associations remain conservatively flagged
because other entities are also named. A looser “target EIN anywhere” rule would
produce 28 leads, of which 13 lack a supported current primary-publisher bridge:
53.6% precision against these source-review labels. No such rule was deployed.

## Sample and source scope

The sample has 40 distinct organizations: ten namesake/misassigned-site cases,
ten multi-entity or identifier-conflict cases, ten single-EIN funder candidates,
and ten directory cases. It excludes all 1,000 pilot members and the previous
40-page evaluation. Selection screened 937 saved metadata records, using a fixed
order within challenge strata and one explicit locality-namesake anchor. The
inventory classifies 27 as private foundations and 13 as T-category public
charities. Neither classification proves current outgoing grantmaking.

Membership and source labels were frozen and hashed before running the unchanged
v2 extractor. All 180 saved source envelopes were hash-checked. Labels came from
agent review of separately delimited source contexts, entity histories and
selected program/contact passages. This is **not independent human review** or a
representative population estimate. The labels express conservative source scope,
not legal determinations. Source captures range from October 17 through October
20, 2026; this evaluation made no new HTTP requests or liveness observations.
Whole-site update month and current IRS standing remain unknown.

## Yield and useful dispositions

Source review supports ten straightforward primary associations and five scoped
regional/chapter/partner associations: **15/40 (37.5%) within this deliberately
enriched challenge set**. The other 25 remain rejected or held: ten directory
sites, ten wrong-EIN/namesake/related-entity cases, and five conflicting,
historical-merger, dissolution or affiliate cases. No population discovery yield
can be inferred. The original missing-site pilot remains four websites out of
1,000; this validation discovers zero new domains.

Among the 15 source-supported associations:

- Two primary sites explicitly invite organization donation requests or rolling
  nonprofit inquiries. Linked request-form terms still need separate review where
  not acquired; undated rolling guidance is not a dated grant cycle.
- One route runs through a separately identified program partner with specific
  network/course conditions. Its discontinued predecessor is preserved.
- One closed program invites information for future consideration. Invitation-only
  and currently closed policies on two other sites remain restrictive.
- Regional internal funding, teachers/students, donors, individual assistance,
  service/in-kind programs and adoption applications retain their own audiences.
  A short HTML grant-application link does not establish the linked document's terms.

These observations improve fit/inquiry interpretation without turning generic
contact forms, fundraising requests or old awards into current grant invitations.
Forty actual bounded identity reviews were recorded once through local
`research_steps`, with source hashes, scoped notes and literal identity anchors.
They recheck existing organizations and add zero acquisition audits, new
organization coverage, strict proposals, qualified funders, applications, human
approvals or published profiles.

## Cost, duplicates and next step

The fixed extractor took about **12.1% more wall time overall and 9.4% more per
correctly recovered usable identifier** on this sample. This differs from the
previous easier sample's improvement per result. One paired pass alternated
version order; timings include source/hash/JSON/HTML work and are sensitive to
caching and background activity. The complete evaluation, including packet
classification, took 4.49 seconds. No repeated benchmark runs were performed.

No research web, Supabase or extractor-model calls were needed. Agent screening,
annotation and reporting still consume tokens; actual own-chat counter receipts
remain private, with cached and uncached input separated. Billed dollars are
unavailable. These measurements do not price a future discovery campaign.

Duplicate scopes remain separate: 40 organizations/zero duplicate members;
180 page references/180 source hashes/zero repeated snapshot references;
179 source URLs/one URL repetition with a different snapshot. Both versions have
179 distinct normalized texts and one repeated text, which contains no EIN and
does not inflate identifier-pair yield; text accuracy above excludes it. There are 40
canonical review records/40 hashes/zero repeated inputs. Within-page mention
repetitions are shown above. Existing campaign proposal/claim duplicate indexes
were not recomputed or extended; new proposals and claims are zero.

**Next implementation:** add a source-role and entity-scope gate before any
website acceptance: directory exclusion, placeholder rejection, per-entity EIN
association, temporal succession holds, and separate partner/recipient identity.
Add table-aware recovery only where an explicit EIN column supplies the label;
do not accept arbitrary nine-digit numbers. Preserve audience, application posture
and source-dated currentness independently. Freeze a fresh challenge set before
validating that gate, then measure new supported-domain yield and total usage on
a bounded discovery extension. Do not scale the missing-site campaign yet.

Supabase remained read-only: zero calls and zero mutations. Existing workers were
not restarted or requeued. The 2,309,073-organization inventory and its immutable
hash are untouched. Sources, excerpts, labels, searches, contacts and before-images
stay private; candidates require a separately requested application session.

Private sample, labels, results, source-scope records, cost and exact handoff:
`corpus/data/research/funder-focused-validation-2026-10-20/`.
Pending application:
`corpus/data/research/active-funders-150k-2026-10-18/APPLICATION-BACKLOG.json`.

Verified by: one frozen paired 40-case/180-source evaluation and exact hash
readback of 40 canonical review records. Tests: not run (weekly review policy).
CI not polled.
