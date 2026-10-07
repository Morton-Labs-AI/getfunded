## What this changes

<!-- One or two sentences. Link the issue if there is one: Fixes #123 -->

## Why

<!-- The problem this solves. -->

## How to test

<!-- Commands you ran, pages you checked. -->

## Checklist

- [ ] Every commit has a `Signed-off-by:` line (`git commit -s`). See the DCO note below.
- [ ] `uv run pytest -q` passes (if `corpus/` changed)
- [ ] `npm run check` passes (if `apps/web/` changed)
- [ ] New behavior has a test
- [ ] `CHANGELOG.md` updated under `Unreleased` (if user-facing)
- [ ] Breaking change: RFC accepted and linked
- [ ] AI helped with this change (say how in the description), and a human reviewed every line

## Data rules

Check each one that applies to your change. All checked boxes must be true.
See **Non-negotiable data rules** in `GOVERNANCE.md`.

- [ ] Absent statements render "Not stated in filings", never "closed"
- [ ] Missing data renders "Not available", never "$0"
- [ ] Contact channels show only when `publishability = 'public'` and are never vendor-sourced
- [ ] Every new fact row carries `raw_file_id` and `source_record_locator`
- [ ] AI output is labelled as AI, cites evidence ids, and never asserts funder interest
- [ ] No fabricated data; no demo data in production tables
- [ ] Superseded (amended) filings are filtered

---

**DCO:** By signing off, you certify the
[Developer Certificate of Origin](https://developercertificate.org/): you
wrote this change or have the right to submit it under the project licenses
(Apache-2.0 for code, CC BY 4.0 for data). CI fails if any commit is missing
the sign-off. Fix with `git rebase --signoff origin/main` and force-push.
