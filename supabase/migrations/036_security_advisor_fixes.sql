-- Security advisor fixes (2026-09-16).
--
-- 1. media_assets_dupe_backup_20260728 had RLS off, so anyone holding the
--    anon key could read it over the REST API. Enable RLS with no policies:
--    the backup rows stay intact and only the service role can reach them.
-- 2. handle_new_user / update_updated_at had a mutable search_path. Pin it.
--    Both bodies already schema-qualify their tables (or use only pg_catalog).
-- 3. handle_new_user is a trigger function, not an RPC. Triggers don't need
--    EXECUTE grants, so revoke it from the API roles.
--
-- Left as-is on purpose:
--   - is_email_allowed stays callable by anon: the login page calls it before
--     signup (see 023_email_allowlist.sql). It only returns a boolean.
--   - allowed_emails / social_provider_credentials have RLS with no policies
--     by design — service role only.

alter table public.media_assets_dupe_backup_20260728 enable row level security;

alter function public.handle_new_user() set search_path = '';
alter function public.update_updated_at() set search_path = '';

revoke execute on function public.handle_new_user() from public, anon, authenticated;
