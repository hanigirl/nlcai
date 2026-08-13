-- ============================================================
-- 034 — the agency install: one OAuth grant the whole product runs on
--
-- 033 assumed a static token pasted into an env var. The provider's owner went
-- the other way and built a proper OAuth app, which is the better choice: the
-- documented path for a third party acting on someone else's account, and the
-- one that can mint per-sub-account tokens rather than reusing one agency
-- credential for every call.
--
-- The cost is that a static secret becomes a living one, and it has a sharp
-- edge worth stating plainly:
--
--   REFRESH TOKENS ROTATE. Redeeming one invalidates it and returns a
--   replacement. So the new pair must be written the moment it arrives — if we
--   ever redeem a refresh token and fail to persist what came back, the
--   install is dead and a human has to reinstall the app by hand. That is why
--   this is a table and not an env var: an env var cannot be rewritten by the
--   process that discovers the new value.
--
-- Exactly one row per provider — this is the product's own credential, not a
-- per-user one. Users' Instagram connections live in social_accounts (033) and
-- are unaffected by anything here.
-- ============================================================

create table social_provider_credentials (
  id            uuid primary key default gen_random_uuid(),

  -- 'highlevel'. Unique: a second install would silently orphan the first.
  provider      text not null unique,

  -- The agency this app was installed on. Needed to mint sub-account tokens.
  company_id    text not null,

  access_token  text not null,
  refresh_token text not null,

  -- Access tokens last ~24h. We refresh well before this rather than on 401,
  -- so a burst of publishes at a slot boundary doesn't stampede the refresh.
  expires_at    timestamptz not null,

  installed_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger social_provider_credentials_updated_at
  before update on social_provider_credentials
  for each row execute function update_updated_at();

-- ---- RLS: service role only ----
-- Enabled with NO policies on purpose. Under Postgres RLS that denies every
-- request from the anon and authenticated roles outright, while the service
-- role bypasses it. These are agency-wide credentials; no end user should be
-- able to read them, and there is no legitimate browser-side query for them.
alter table social_provider_credentials enable row level security;
