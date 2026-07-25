-- 0006: pin search_path on trigger functions (Supabase linter
-- function_search_path_mutable). Both functions reference tables
-- schema-qualified (or none), so an empty search_path is safe.

alter function internal.tg_set_updated_at() set search_path = '';
alter function internal.tg_contact_license_guard() set search_path = '';
