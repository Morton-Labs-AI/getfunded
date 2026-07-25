-- 0005: filing-level idempotency for IRS 990 XML ingestion. Filings are
-- immutable once published (a new OBJECT_ID appears for amendments), so
-- "seen object_id => skip" is the correct re-run semantics.

create table internal.processed_filings (
  object_id    text constraint pk_processed_filings primary key,
  ein          char(9) not null,
  return_type  text not null,
  tax_period   text,
  raw_file_id  bigint not null
               constraint fk_processed_filings_raw_file references internal.raw_files(id),
  processed_at timestamptz not null default now()
);

create index ix_processed_filings_ein on internal.processed_filings (ein);
