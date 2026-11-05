-- ============================================================
-- 042 — one calendar slot, several networks
--
-- Until now a slot in `scheduled_posts` went to exactly one place: the user's
-- Instagram account, with the provider's id and the publish status sitting on
-- the slot row itself (033). YouTube and LinkedIn break that: the same reel
-- now goes to Instagram AND YouTube AND LinkedIn, and each of those can be
-- queued, published or failed on its own. One status column cannot say
-- "Instagram went out, LinkedIn refused the video".
--
-- So the publishing arm moves one level down. A slot keeps its date, hour and
-- content; each network it goes to is a TARGET row with its own provider id,
-- its own status and its own error.
--
-- ---- What stays on `scheduled_posts` ----
-- `publish_status` / `publish_error` / `publish_synced_at` / `published_at`
-- stay, as the ROLL-UP of the slot's targets (worst state wins; "published"
-- only when every target is). Every reader that already looks at those columns
-- (the calendar card, the PUT's "was it failed?" check, the newsletter agent)
-- keeps working unchanged. `social_account_id` / `provider_post_id` stay as
-- legacy, read once to adopt pre-042 Instagram slots, and no longer written.
--
-- ---- Opt-out ----
-- A slot goes to every connected network that fits its format, by default
-- (Hani, 2026-11-05). Taking one network off a single post is a target row with
-- `opted_out = true` — the row remembers the decision, so the next drag of the
-- card doesn't quietly add the network back.
--
-- Additive only. Nothing is dropped, nothing on main reads the new table, so
-- applying this ahead of the code is safe; the backfill is idempotent and can
-- be re-run at merge time to pick up slots queued in between (the bridge also
-- adopts any it missed, lazily, on first touch).
-- ============================================================

create table scheduled_post_targets (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users on delete cascade,
  scheduled_post_id  uuid not null references scheduled_posts on delete cascade,

  -- 'instagram' | 'youtube' | 'linkedin'. Text, like `social_accounts.platform`.
  platform           text not null,

  -- The account this target publishes from. Null after a disconnect, so the
  -- record of where an already-published post went is not erased.
  social_account_id  uuid references social_accounts on delete set null,

  -- The per-post opt-out. A row with this set never talks to the provider.
  opted_out          boolean not null default false,

  -- Same meanings as the columns 033 put on scheduled_posts.
  provider_post_id   text,
  publish_status     text not null default 'idle',
  publish_error      text,
  publish_synced_at  timestamptz,
  published_at       timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- One target per network per slot. One connected account per network today.
create unique index scheduled_post_targets_slot_platform_idx
  on scheduled_post_targets (scheduled_post_id, platform);

create index scheduled_post_targets_user_idx on scheduled_post_targets (user_id);
create index scheduled_post_targets_account_idx
  on scheduled_post_targets (social_account_id) where social_account_id is not null;

create trigger scheduled_post_targets_updated_at
  before update on scheduled_post_targets
  for each row execute function update_updated_at();

-- ---- RLS: own rows only, mirroring 026 / 033 ----
alter table scheduled_post_targets enable row level security;

create policy "scheduled_post_targets_select_own" on scheduled_post_targets
  for select using (auth.uid() = user_id);
create policy "scheduled_post_targets_insert_own" on scheduled_post_targets
  for insert with check (
    auth.uid() = user_id
    -- The slot must be hers too, not just the claimed user_id.
    and exists (
      select 1 from scheduled_posts s
      where s.id = scheduled_post_id and s.user_id = auth.uid()
    )
  );
create policy "scheduled_post_targets_update_own" on scheduled_post_targets
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "scheduled_post_targets_delete_own" on scheduled_post_targets
  for delete using (auth.uid() = user_id);


-- ---- social_accounts: remember WHICH account of a grant was attached ----
-- One LinkedIn login exposes a personal profile and company pages; one
-- Facebook login exposes several Instagram accounts. They share the grant id
-- we store in `external_account_id`, so the provider's own id for the chosen
-- account is kept too. Null on pre-042 rows; the adapter then falls back to
-- matching by handle, as before.
alter table social_accounts add column external_origin_id text;


-- ---- backfill: every pre-042 slot that ever talked to Instagram ----
-- Scoped per row to its own user and its own account; idempotent on the
-- (slot, platform) key, so re-running it never duplicates or overwrites.
insert into scheduled_post_targets (
  user_id, scheduled_post_id, platform, social_account_id,
  provider_post_id, publish_status, publish_error, publish_synced_at, published_at
)
select
  s.user_id, s.id, 'instagram', s.social_account_id,
  s.provider_post_id, s.publish_status, s.publish_error, s.publish_synced_at,
  case when s.publish_status = 'published' then s.published_at end
from scheduled_posts s
where s.social_account_id is not null
   or s.provider_post_id is not null
   or s.publish_status <> 'idle'
on conflict (scheduled_post_id, platform) do nothing;
