# Evidence enhancement demonstration

Author: Codex (AI-assisted implementation and original research paraphrases), 2026-10-19.
Human review and live application remain pending.

The former `Morton-Labs-AI/open-funder-db-ui` repository directs development to
this app. The demonstration lives at `/demo/evidence` and leaves the existing
`/org/[id]` route and shared profile components unchanged.

## View locally

```bash
cd apps/greenbook
npm ci --ignore-scripts
npm run dev -- --hostname 127.0.0.1
```

Open <http://127.0.0.1:3010/demo/evidence>. This route requires no database
credentials or model key. It returns 404 outside development and requests no
indexing. Other existing app routes retain their own data dependencies.

## Comparison scope

The **Before** panel uses existing Greenbook profile primitives and locally
available registry fields. It is a limited baseline, not a full historical
database before-image. Financial figures are explicitly not loaded. Existing
filing provenance, grant history and human-confirmed website facts are not
represented as absent from Greenbook.

The **After** panel adds program-specific applicant criteria, geography, inquiry
steps, current-cycle caveats and source references. It separates website
reachability on the saved check date from dated program content and the unknown
whole-site update month. It makes no personalized eligibility or funder-interest
prediction. All interpretations remain staged, agent-reviewed and awaiting human
review; none become verified profiles or published database facts.

Use the example selector and Compare / Before / After controls to inspect:

- **South Dakota Fund:** year-round letters of inquiry, followed by an invited
  full application; other foundation funds retain separate terms.
- **Minneapolis:** a dated past deadline alongside conflicting overview notices.
  A planned 2027 guidelines update does not establish an opening date.
- **Hopewell Valley:** a current fall cycle restricted to district educators,
  with school approvals and a November 18, 2026 deadline.

## Evidence and privacy

`lib/demo/evidence-examples.ts` contains original paraphrases, public source
URLs, observation dates and real snapshot SHA-256 prefixes where available.
The Minneapolis dated call has no publisher-byte fingerprint in this demo;
that gap is visible. Publication dates, observation dates and cycle dates have
different meanings and remain separate.

Private snapshots, source excerpts, search results, access configuration,
contacts and database before-images are excluded. The page reads a local
fixture and uses client state; it performs no database request, model call,
application submission or outreach. Evidence anchors navigate locally; official
program links open publisher pages only when the user follows them.

Production integration, complete claim-level licensing/provenance, live source
refresh, approval and application to the database are separate work. The research
campaign's private pending-application backlog remains the source for application
work in a separately authorized session.

## Direct verification

On 2026-10-19, `node_modules/.bin/tsc --noEmit` completed successfully. One
desktop browser pass loaded the route (HTTP 200), switched all three comparison
views and all three examples, followed the local evidence anchor, and expanded
provenance and unresolved questions. The rendered comparison and evidence
sections were visually inspected. Responsive breakpoints are implemented;
mobile rendering was not separately exercised. No Supabase calls were made.

Verified by: TypeScript typecheck and one desktop browser interaction pass. Tests: not run (weekly review policy).
