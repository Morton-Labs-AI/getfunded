-- 0004: widen org_identifiers.id_type to include SEC private fund IDs
-- (Form ADV Schedule D 7.B.1 "Fund ID", e.g. 805-4964869201). These identify
-- the FUND entities advised by RIA/ERA firms — the crosswalk key that later
-- links Form D issuers to their ADV-listed funds.

alter table internal.org_identifiers
  drop constraint ck_org_identifiers_type;

alter table internal.org_identifiers
  add constraint ck_org_identifiers_type check (id_type in
    ('ein','cik','crd','sec_file_number','uei','duns',
     'ror','lei','sam_entity_id','openalex_funder','crossref_funder',
     'sec_private_fund_id'));
