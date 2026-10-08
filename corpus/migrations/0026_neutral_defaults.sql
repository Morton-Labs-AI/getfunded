-- 0026: neutral defaults for human-review columns.
--
-- 0009 and 0012 gave `labeled_by` / `reviewed_by` a default that named one
-- operator. Defaults must not carry identity: callers pass who did the work.
-- Existing rows are untouched (they are an audit trail).

alter table internal.er_labels
  alter column labeled_by set default 'human:operator';

alter table internal.org_web_facts
  alter column reviewed_by set default 'human:operator';

comment on column internal.er_labels.labeled_by is
  'Who produced the label: human:<handle> or model:<name>. Pass explicitly; the default is a placeholder.';
comment on column internal.org_web_facts.reviewed_by is
  'Who confirmed the fact: human:<handle>. Pass explicitly; the default is a placeholder.';
