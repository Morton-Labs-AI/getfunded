-- 0013: processed_filings becomes a first-class filings entity.
--
-- The 0005 table was a pure idempotency ledger (seen object_id => skip).
-- The filing layer needs a real spine: index metadata (DLN, batch, submitted),
-- XML header facts (period dates, accounting method, signing officer), and
-- amended-return supersession. Rename in place — the PK/object_id contract is
-- unchanged, and existing rows keep their processed timestamps.
--
-- Two independent idempotency markers replace the single processed_at:
--   grants_processed_at  — the officers+grants pass ran (0005 semantics)
--   details_parsed_at    — the financials/detail pass ran (new)
-- Spine rows loaded from index CSVs alone have both NULL.

alter table internal.processed_filings rename to filings;
alter table internal.filings rename constraint pk_processed_filings to pk_filings;
alter table internal.filings
  rename constraint fk_processed_filings_raw_file to fk_filings_raw_file;
alter index internal.ix_processed_filings_ein rename to ix_filings_ein;

alter table internal.filings rename column processed_at to grants_processed_at;
alter table internal.filings alter column grants_processed_at drop not null;
alter table internal.filings alter column grants_processed_at drop default;

alter table internal.filings
  -- index-sourced
  add column dln              text,
  add column sub_date         text,   -- raw index value; year-only 2022+, garbage
                                      -- timestamps in 2021 — NEVER used for logic
  add column xml_batch_id     text,
  add column taxpayer_name    text,
  add column tax_period_end   date,
  add column org_id           uuid
      constraint fk_filings_org references internal.organizations(id),
  -- XML-header-sourced (detail pass)
  add column tax_period_begin date,
  add column return_version   text,
  add column amended_return   boolean,
  add column return_ts        timestamptz,
  add column phone            text,
  add column in_care_of_name  text,
  add column filer_addr_line1 text,
  add column filer_addr_line2 text,
  add column filer_city       text,
  add column filer_state      text,
  add column filer_zip        text,
  add column filer_country    text,
  add column accounting_method text
      constraint ck_filings_acct_method
      check (accounting_method in ('cash','accrual','other')),
  add column signing_officer_name  text,
  add column signing_officer_title text,
  add column signature_date   date,
  -- supersession + detail-pass state
  add column superseded_by_object_id text
      constraint fk_filings_superseded references internal.filings(object_id),
  add column details_parsed_at  timestamptz,
  add column detail_parse_error text;

-- Sweep partition key + org profile lookups + detail-pass done-set.
create index ix_filings_ein_type_period on internal.filings (ein, return_type, tax_period);
create index ix_filings_org             on internal.filings (org_id, return_type, tax_period);
create index ix_filings_details_pending on internal.filings (return_type)
  where details_parsed_at is null;

comment on table internal.filings is
  'One row per IRS e-filed return (object_id = IRS OBJECT_ID). Spine rows come '
  'from the annual index CSVs; header columns from the XML detail pass. '
  'Supersession: within (ein, return_type, tax_period) the greatest object_id '
  'wins; losers carry superseded_by_object_id.';
