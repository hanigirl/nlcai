-- 044: security hardening before opening the app to everyone (audit 2026-11-09).
-- Every statement is idempotent (drop ... if exists / create or replace) so it is
-- safe on a production schema that has drifted from the migrations (see 028).

-- ---------------------------------------------------------------------------
-- 1. social_tenants / social_accounts: server-only writes.
--    external_tenant_id decides which HighLevel sub-account the agency
--    credential mints a token for. Users could rewrite it from the browser and
--    point their account at someone else's sub-account. All writes now go
--    through the service role (HighLevelPublisher.writeDb, bridge.markAccountLost).
--    Users keep SELECT on their own rows.
-- ---------------------------------------------------------------------------
drop policy if exists "social_tenants_insert_own" on social_tenants;
drop policy if exists "social_tenants_update_own" on social_tenants;
drop policy if exists "social_tenants_delete_own" on social_tenants;
drop policy if exists "social_accounts_insert_own" on social_accounts;
drop policy if exists "social_accounts_update_own" on social_accounts;
drop policy if exists "social_accounts_delete_own" on social_accounts;

-- ---------------------------------------------------------------------------
-- 2. core_posts / hooks / format_variants / media_assets: drop the legacy
--    project/idea-chain INSERT and UPDATE policies. Postgres ORs permissive
--    policies, and the chain ones never bound user_id, so a user could create
--    (or re-point) a post or hook with another user's user_id. The direct
--    user_id policies (009, 011, 028) cover every write the app makes; the app
--    does not use projects/ideas at all. SELECT/DELETE legacy policies stay.
-- ---------------------------------------------------------------------------
drop policy if exists "core_posts_insert_own" on core_posts;
drop policy if exists "core_posts_update_own" on core_posts;
drop policy if exists "hooks_insert_own" on hooks;
drop policy if exists "hooks_update_own" on hooks;
drop policy if exists "format_variants_insert_own" on format_variants;
drop policy if exists "format_variants_update_own" on format_variants;
drop policy if exists "media_assets_insert_own" on media_assets;
drop policy if exists "media_assets_update_own" on media_assets;

-- Direct update policies were USING-only; make the new row's owner explicit.
drop policy if exists "core_posts_update_own_direct" on core_posts;
create policy "core_posts_update_own_direct" on core_posts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "hooks_update_own_direct" on hooks;
create policy "hooks_update_own_direct" on hooks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. users: email and plan are not user-editable. users_update_own allowed
--    every column, and users.email was trusted by the publishing gate and the
--    newsletter agent lookup. Only the browser roles are pinned; the service
--    role and the auth trigger (handle_new_user) are unaffected.
-- ---------------------------------------------------------------------------
create or replace function public.users_protect_identity_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.email := old.email;
    new.plan := old.plan;
  end if;
  return new;
end;
$$;

drop trigger if exists users_protect_identity_columns on public.users;
create trigger users_protect_identity_columns
  before update on public.users
  for each row execute function public.users_protect_identity_columns();
