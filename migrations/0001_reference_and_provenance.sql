-- 0001: internal schema, extensions, licensing map, raw-file registry, ingestion ledger.
-- All base tables live in `internal`, which is NEVER added to PostgREST's exposed
-- schemas. `public` holds only filtered views (see 0003) — the publishability
-- boundary is structural, not procedural.

create schema if not exists internal;

create extension if not exists pg_trgm;

-- Shared updated_at trigger
create function internal.tg_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- licensing_map: every fact's redistribution rights derive from its source
-- file's license. License is declared once, at file-staging time, not per row.
-- ---------------------------------------------------------------------------
create table internal.licensing_map (
  license_code         text primary key,
  license_name         text not null,
  republishable        boolean not null,
  attribution_required boolean not null default false,
  license_url          text,
  notes                text
);

insert into internal.licensing_map
  (license_code, license_name, republishable, attribution_required, notes) values
  ('us_public_domain',     'U.S. Government public domain', true,  false,
   'Federal government works: IRS filings data, SEC EDGAR/ADV, SBIR/STTR, USAspending.'),
  ('cc0',                  'Creative Commons Zero',         true,  false,
   'e.g. Crossref Open Funder Registry.'),
  ('cc_by',                'Creative Commons Attribution',  true,  true,  null),
  ('odbl',                 'Open Database License',         true,  true,  null),
  ('community_unverified', 'Community-contributed, license unverified', false, false,
   'e.g. OpenVC until its ToS is confirmed. Not republishable until upgraded.'),
  ('vendor_internal_only', 'Commercial vendor, internal use only', false, false,
   'Stage-3 enrichment (Apollo/Clay/PDL/Hunter/Bright Data). Contractually barred from republication.');

-- ---------------------------------------------------------------------------
-- raw_files: hash-first staging registry. Doctrine: file-first ingestion —
-- even API pulls and hand-curated seed CSVs are dumped to a file, hashed, and
-- registered here before parsing. Every fact row FKs into this table.
-- ---------------------------------------------------------------------------
create table internal.raw_files (
  id            bigint generated always as identity
                constraint pk_raw_files primary key,
  dataset_name  text not null,
  source_url    text,
  storage_path  text not null,
  sha256        char(64) not null constraint uq_raw_files_sha256 unique,
  byte_size     bigint,
  content_type  text,
  license_code  text not null
                constraint fk_raw_files_license references internal.licensing_map(license_code),
  as_of_date    date,
  downloaded_at timestamptz not null default now(),
  meta          jsonb
);

create index ix_raw_files_dataset on internal.raw_files (dataset_name);

-- ---------------------------------------------------------------------------
-- ingestion_ledger: one row per ingest run of a staged file.
-- ---------------------------------------------------------------------------
create table internal.ingestion_ledger (
  id            bigint generated always as identity
                constraint pk_ingestion_ledger primary key,
  raw_file_id   bigint not null
                constraint fk_ledger_raw_file references internal.raw_files(id),
  dataset_name  text not null,
  status        text not null
                constraint ck_ledger_status check (status in ('running','completed','failed')),
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  rows_inserted integer not null default 0,
  rows_updated  integer not null default 0,
  rows_skipped  integer not null default 0,
  created_by    text not null default 'agent',
  notes         text
);

create index ix_ledger_dataset_status on internal.ingestion_ledger (dataset_name, status);
