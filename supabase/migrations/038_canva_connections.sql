-- ============================================================
-- 038 — Canva connections: a pasted Canva link becomes a real image
--
-- Until now a Canva link in the media field was a bookmark: saved to
-- localStorage, opened by hand, and invisible to everything downstream. The
-- calendar showed an image post with no image. Canva blocks anonymous
-- fetches of its pages outright (403 at the edge), so there is no scraping
-- route — the only way to the pixels is Canva's Connect API, acting as the
-- user, with her one-time consent.
--
-- One row per user. The export is copied into our own storage at paste
-- time, so a post's image never depends on this row again: disconnecting,
-- an expired token, or a deleted design all leave existing posts intact.
-- The row only matters at the moment a NEW link is pasted.
--
-- REFRESH TOKENS ROTATE (same edge as 034): redeeming one invalidates it, so
-- the replacement pair is written the moment it arrives.
-- ============================================================

create table canva_connections (
  user_id       uuid primary key references users on delete cascade,

  access_token  text not null,
  refresh_token text not null,

  -- Canva access tokens last ~4h. Refreshed a few minutes early rather than
  -- on 401.
  expires_at    timestamptz not null,

  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger canva_connections_updated_at
  before update on canva_connections
  for each row execute function update_updated_at();

-- ---- RLS: service role only ----
-- Enabled with NO policies, like 034: these are live credentials to the
-- user's Canva account, and no browser-side query has a reason to read them.
-- The browser only ever learns "connected or not", via the server.
alter table canva_connections enable row level security;
