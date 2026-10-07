-- 0025: raw_files vintage — keep "fetched", "source-modified" and "parsed"
-- apart so a re-ingest of an old file cannot advance verification time.
--
-- Before this, raw_files had one timestamp (downloaded_at, defaulted to the
-- row's insert time) and loaders stamped organizations.last_verified_at with
-- now(). Re-running `ingest bmf` over a July snapshot in September therefore
-- made every foundation look verified in September. The audit called this
-- out (P1, "refresh commands can indefinitely reuse old data and falsely
-- refresh verification timestamps").
--
--   fetched_at            when WE downloaded these exact bytes (UTC)
--   source_last_modified  the publisher's Last-Modified for those bytes, if sent
--   parsed_at             the most recent ingest run that parsed this file
--
-- downloaded_at is kept for backward compatibility; new rows set it and
-- fetched_at together. Loaders now stamp last_verified_at from the file's
-- vintage (source_last_modified, else fetched_at) via funderdb.staging.verified_at.

alter table internal.raw_files
  add column if not exists fetched_at           timestamptz,
  add column if not exists source_last_modified timestamptz,
  add column if not exists parsed_at            timestamptz;

-- Backfill: the only surviving evidence for pre-0025 rows is downloaded_at,
-- which was the fetch time for every row inserted by stage_download.
update internal.raw_files
   set fetched_at = coalesce(fetched_at, downloaded_at),
       parsed_at  = coalesce(parsed_at, downloaded_at)
 where fetched_at is null or parsed_at is null;

comment on column internal.raw_files.fetched_at is
  'When this exact byte content was downloaded by the pipeline (UTC).';
comment on column internal.raw_files.source_last_modified is
  'Publisher Last-Modified header for these bytes, when the server sent one.';
comment on column internal.raw_files.parsed_at is
  'Most recent ingest run that parsed this file. Re-parsing moves ONLY this column.';
