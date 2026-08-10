-- ============================================================
-- 033 — social publishing: the calendar grows a publish button
--
-- Until now `scheduled_posts` (026) was a board: it remembered that a post
-- belongs on Tuesday at 09:00, and `published_at` was set by hand when Hani
-- went and posted it herself. This migration is what turns the board into a
-- pipeline — the calendar slot becomes the trigger for an actual publish.
--
-- ---- The one decision this schema encodes ----
--
-- Instagram's API has no scheduling. There is no "publish this on Tuesday"
-- parameter (that exists for Facebook Pages only). *Someone* has to be awake
-- at 09:00 and press publish. Every scheduling product on the market is a
-- queue plus a clock; you don't buy scheduling from them, you buy the
-- connection to the user's account.
--
-- So we rent the connection instead of owning it — for now. HighLevel holds
-- the OAuth relationship with Instagram and holds the clock. But *this*
-- database stays the source of truth: the calendar is ours, the queue is
-- ours, and the provider is a dumb executor we push to. Nothing here knows
-- what a HighLevel is beyond an opaque id in an `external_*` column.
--
-- That is deliberate. The moment nlcai ships outside the founders' HighLevel
-- account it needs its own Meta app (business verification + app review,
-- roughly a month of queueing, then free forever at any volume). When that
-- day comes, the migration is: point `provider` at 'meta', build a cron to
-- replace HighLevel's clock, and ask every user to reconnect once. No table
-- here changes shape. That reconnect is unavoidable in any provider switch —
-- OAuth tokens belong to whoever owns the app, not to us.
-- ============================================================


-- ---------- social_tenants ----------
--
-- Provider-scoped workspace for one user. For HighLevel this is a sub-account
-- ("location"): the founders are on Agency Pro, so we can mint one per user
-- over the API instead of clicking through the UI.
--
-- One sub-account per user rather than one shared bucket for everyone, for
-- two reasons — and the first one is the one that matters:
--   1. Isolation. In a shared bucket there is no physical barrier between
--      customers; a single bad lookup posts one woman's content to another
--      woman's Instagram. That is not a bug you recover from.
--   2. HighLevel caps Instagram at 25 posts / 24h. If that ceiling is counted
--      per sub-account rather than per Instagram account, one shared bucket
--      means everybody jams at once.
--
-- Providers that have no such concept (Meta talks to accounts directly) simply
-- never get a row here. The table is allowed to be provider-specific — that is
-- what living behind the seam means.
create table social_tenants (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users on delete cascade,

  -- 'highlevel' today, 'meta' when we own the Meta app.
  provider           text not null,

  -- HighLevel locationId. Opaque here on purpose.
  external_tenant_id text not null,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- A user has at most one workspace per provider. Doubles as the lookup key
-- for "does this user need provisioning?" on the connect path.
create unique index social_tenants_user_provider_idx
  on social_tenants (user_id, provider);


-- ---------- social_accounts ----------
--
-- One connected destination — today always an Instagram professional account.
-- (Personal Instagram accounts cannot be published to by *any* route, ours or
-- anyone else's; that is a Meta-side restriction and worth surfacing in the
-- connect UI rather than failing at publish time.)
create table social_accounts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users on delete cascade,
  provider            text not null,

  -- 'instagram'. Free text rather than an enum to match how `format` is
  -- handled in 026 — the UI ships destinations before the database hears
  -- about them, and a failed publish is a better failure than a failed insert.
  platform            text not null,

  -- Provider's id for the account: HighLevel's accountId today, the Instagram
  -- user id if we ever go direct.
  external_account_id text not null,

  -- Denormalised copy of the tenant so the publish path is a single row read.
  external_tenant_id  text,

  -- Display only — what the user sees on the connections screen.
  handle              text,
  avatar_url          text,

  -- 'connected'     — good to publish
  -- 'needs_reconnect' — token lapsed. THE failure mode of this whole feature:
  --                   Instagram connections die after ~60 days, and earlier if
  --                   the user changes her password or flips account type. The
  --                   post silently doesn't go out and nobody finds out. This
  --                   column exists so we can warn her *before* the calendar
  --                   quietly stops working.
  -- 'revoked'       — user disconnected on purpose.
  status              text not null default 'connected',

  connected_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Reconnecting the same Instagram account updates the row in place rather
-- than growing a second one.
create unique index social_accounts_identity_idx
  on social_accounts (user_id, provider, platform, external_account_id);

create index social_accounts_user_idx on social_accounts (user_id);


-- ---------- scheduled_posts grows a publishing arm ----------
alter table scheduled_posts
  -- Null means "board only" — the slot is a plan, not a promise. Every row
  -- that existed before this migration is exactly that, which is why there is
  -- no backfill: nothing retroactively becomes something we owe Instagram.
  add column social_account_id uuid references social_accounts on delete set null,

  -- The provider's handle on the queued post. Without this we can create but
  -- never edit or cancel — and the calendar is drag-and-drop, so a slot that
  -- moves has to move on the provider too.
  add column provider_post_id  text,

  -- 'idle'      — not queued with any provider (the pre-033 world)
  -- 'queued'    — provider is holding it and will publish at the slot time
  -- 'published' — provider confirmed it went out
  -- 'failed'    — see publish_error
  add column publish_status    text not null default 'idle',

  -- Human-readable, and it is meant to reach the user. "Your Instagram
  -- connection expired" and "this image is taller than 4:5" are both things
  -- she can act on; neither is something she should learn from an empty feed.
  add column publish_error     text,

  add column publish_synced_at timestamptz;

-- `published_at` (026) predates this and means "this went live" regardless of
-- who did it — Hani ticking the box by hand, or the provider reporting back.
-- Auto-publish sets both it and publish_status; nothing about the manual path
-- changes. Anything reading the calendar keeps reading one column.
comment on column scheduled_posts.published_at is
  'Live-on-Instagram mark. Set by hand (manual posting) or by the provider callback (auto-publish). Deliberately provider-agnostic.';

-- The publish worker's query: what is queued, in slot order. Partial, because
-- the overwhelming majority of rows are 'idle' board entries forever.
create index scheduled_posts_publish_queue_idx
  on scheduled_posts (scheduled_date, scheduled_time)
  where publish_status = 'queued';


-- ---------- triggers ----------
create trigger social_tenants_updated_at
  before update on social_tenants
  for each row execute function update_updated_at();

create trigger social_accounts_updated_at
  before update on social_accounts
  for each row execute function update_updated_at();


-- ---------- RLS: own rows only, mirroring 026 ----------
-- Server-side publishing runs through the service role, which bypasses these.
alter table social_tenants enable row level security;

create policy "social_tenants_select_own" on social_tenants
  for select using (auth.uid() = user_id);
create policy "social_tenants_insert_own" on social_tenants
  for insert with check (auth.uid() = user_id);
create policy "social_tenants_update_own" on social_tenants
  for update using (auth.uid() = user_id);
create policy "social_tenants_delete_own" on social_tenants
  for delete using (auth.uid() = user_id);

alter table social_accounts enable row level security;

create policy "social_accounts_select_own" on social_accounts
  for select using (auth.uid() = user_id);
create policy "social_accounts_insert_own" on social_accounts
  for insert with check (auth.uid() = user_id);
create policy "social_accounts_update_own" on social_accounts
  for update using (auth.uid() = user_id);
create policy "social_accounts_delete_own" on social_accounts
  for delete using (auth.uid() = user_id);
