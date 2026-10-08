-- ============================================================
-- 039 — system notices: "something ran out" reaches a person
--
-- The app's Serper account sat at 0 credits for two weeks and nobody knew:
-- the code swallowed the error and hooks quietly lost their web trends.
-- Users' own limits (Claude credits, Gemini's daily cap, a dead key) only
-- surfaced as a toast at the moment they failed.
--
-- A notice is raised by the server where a failure is detected and shown as
-- a banner on the home page until it is resolved (the next success clears
-- it), dismissed, or expires (Gemini's daily cap resets on its own).
--
--   audience 'user'  — about the user's own account; user_id is set.
--   audience 'admin' — about the APP's accounts (Serper); user_id is null,
--                      shown only to admins. Users can't act on these.
--
-- One open notice per (audience, user, code): raising again just refreshes it.
-- ============================================================

create table system_notices (
  id           uuid primary key default gen_random_uuid(),
  audience     text not null check (audience in ('user', 'admin')),
  user_id      uuid references users on delete cascade,
  code         text not null,
  expires_at   timestamptz,
  resolved_at  timestamptz,
  dismissed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check ((audience = 'user') = (user_id is not null))
);

create index system_notices_open_idx
  on system_notices (audience, user_id, code)
  where resolved_at is null and dismissed_at is null;

create trigger system_notices_updated_at
  before update on system_notices
  for each row execute function update_updated_at();

-- Service role only (same as 034/038): every read and write goes through
-- /api/notices, which decides who may see admin notices.
alter table system_notices enable row level security;
