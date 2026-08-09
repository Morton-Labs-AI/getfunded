-- 0015: link funding_events to filings + grant detail columns + commitments.
--
-- Filing linkage: object_id is position 2 of source_record_key for every IRS
-- key format (irs990pf:{oid}:grant:{i}, irs990:{oid}:schedi:{i}, and the new
-- irs990pf:{oid}:futgrant:{i}). An expression index beats a backfilled column:
-- zero rewrite of 6.5M rows, and non-IRS keys (sbir:, formd:, seed:) yield
-- inert values that never collide with 18-digit object_ids.

create index ix_events_filing_oid
  on internal.funding_events (split_part(source_record_key, ':', 2));

-- Grant detail dropped by the Phase-1 parser, now captured. All nullable —
-- no default, no table rewrite.
alter table internal.funding_events
  add column recipient_address           text,
  add column recipient_zip               text,
  add column recipient_country           text,  -- NULL = US
  add column recipient_foundation_status text,  -- RecipientFoundationStatusTxt (PC/PF/NC/...)
  add column recipient_relationship      text;  -- RecipientRelationshipTxt

-- Future-approved grants (Part XV GrantOrContriApprvForFutGrp) are a distinct
-- event_type, NOT a boolean flag: every existing consumer that groups or
-- filters on event_type ('grant' totals, MVs, benchmarks) stays truthful by
-- construction instead of needing a WHERE clause added.
alter table internal.funding_events drop constraint ck_events_type;
alter table internal.funding_events add constraint ck_events_type check (event_type in
  ('grant','grant_commitment','sbir_award','sttr_award','federal_grant',
   'federal_contract','reg_d_offering','equity_investment','other'));
