-- 0024: grant hygiene on the public views.
--
-- Found 2026-08-10 while checking grants for 0023: Supabase's default
-- privileges had granted ALL (insert/update/delete/truncate/references/
-- trigger) on every public.* view to anon and authenticated, and the Data
-- API (PostgREST) is enabled — meaning the anonymous read API that 0003
-- planned as a deliberate Phase-2 act has in fact been live since the views
-- were created. What it serves is the intended public projection (the views
-- filter through raw_files -> licensing_map, contacts through the triple
-- filter), so the boundary held. But:
--
--   * the write-shaped grants are unused surface (the views are not
--     auto-updatable, so writes fail structurally today — this revoke makes
--     the refusal explicit rather than incidental), and
--   * the views are owner-rights, so a future RLS pass does not bind them
--     until security_invoker flips (the recorded Phase-2 sequence).
--
-- SELECT is deliberately KEPT: anonymous reads of the boundary views are the
-- stated end goal, already live, and serve only republishable data. Rate
-- limiting remains the real gap and belongs to the API phase proper.
--
-- New views do NOT inherit this hygiene — Supabase default privileges will
-- grant ALL again. Until the API phase changes the defaults, every future
-- `create view public.*` migration must repeat the revoke (0023's
-- public.filings recreate is covered below).

-- `anon` and `authenticated` are Supabase roles. On vanilla Postgres they do
-- not exist and `revoke ... from anon` would abort the replay, so the revoke
-- runs only for the roles actually present (there is nothing to revoke from
-- a role that does not exist).
do $$
declare
  v record;
  roles text;
begin
  select string_agg(quote_ident(rolname), ', ') into roles
  from pg_roles where rolname in ('anon', 'authenticated');
  if roles is null then
    raise notice '0024: no anon/authenticated roles in this cluster; nothing to revoke';
    return;
  end if;
  for v in select table_name from information_schema.views
            where table_schema = 'public'
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger '
      'on public.%I from %s', v.table_name, roles);
  end loop;
end $$;
