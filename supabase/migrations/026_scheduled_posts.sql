-- ============================================================
-- 026 — scheduled_posts: the calendar graduates from localStorage
--
-- Until now every calendar placement lived in the browser
-- (`nlcai.timing.scheduled` in localStorage — see src/lib/timing-storage.ts,
-- which called this out as a P0 shortcut: "anything that proves itself here
-- graduates to a real table"). Two things forced the graduation:
--   1. The board only existed on one device / one browser profile.
--   2. Chandler (the newsletter agent) runs in the cloud on Saturday night
--      and has to read "what was on the calendar this week". A localStorage
--      board is invisible to anything that isn't Hani's open tab.
--
-- Identity is (core_post_id, format) — the same core post can sit on the
-- board once per format, which is exactly the localStorage model. The
-- browser keeps writing localStorage as a local mirror; this table is the
-- source of truth and what the agent reads.
-- ============================================================

create table scheduled_posts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users on delete cascade,
  core_post_id   uuid not null references core_posts on delete cascade,

  -- Free text, not the `format_type` enum, on purpose: FormatId in
  -- timing-storage.ts is `"talking_head" | "carousel" | "image_post" | string`
  -- and the UI already ships formats the enum never learned about.
  format         text not null,

  -- Day resolution, local time. "The 5th of May" must mean the same day
  -- regardless of the reader's timezone, so this is a date, not a timestamp.
  scheduled_date date not null,
  -- "HH:00", whole hours 07–23. Text, to match the client model exactly.
  scheduled_time text not null default '09:00',

  -- Set when Hani marks the format as posted. Mirrors the per-format
  -- published mark so a calendar read needs one query, not two.
  published_at   timestamptz,

  -- Denormalised copy of the hook so the day-cell chip renders without a join.
  hook           text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One slot per (post, format) — re-scheduling updates the row in place.
create unique index scheduled_posts_post_format_idx
  on scheduled_posts (core_post_id, format);

-- The two read paths: "my whole board" and "everything in this date range"
-- (the range query is what the newsletter agent runs every Saturday night).
create index scheduled_posts_user_idx on scheduled_posts (user_id);
create index scheduled_posts_user_date_idx on scheduled_posts (user_id, scheduled_date);

create trigger scheduled_posts_updated_at
  before update on scheduled_posts
  for each row execute function update_updated_at();

-- ---- RLS: own rows only. The agent reads through the service role. ----
alter table scheduled_posts enable row level security;

create policy "scheduled_posts_select_own" on scheduled_posts
  for select using (auth.uid() = user_id);
create policy "scheduled_posts_insert_own" on scheduled_posts
  for insert with check (auth.uid() = user_id);
create policy "scheduled_posts_update_own" on scheduled_posts
  for update using (auth.uid() = user_id);
create policy "scheduled_posts_delete_own" on scheduled_posts
  for delete using (auth.uid() = user_id);
