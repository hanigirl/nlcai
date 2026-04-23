-- Creators the user specifies as their primary inspiration sources.
-- These are USER-curated (unlike niche_creators which is the system's discovery cache).
-- The ideas pipeline uses these FIRST — before searching for new creators.
create table if not exists user_top_creators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  url text not null,
  handle text not null,
  platform text not null check (platform in ('instagram', 'youtube', 'tiktok', 'linkedin', 'other')),
  created_at timestamptz not null default now()
);

create unique index user_top_creators_unique on user_top_creators (user_id, handle, platform);
create index user_top_creators_user_idx on user_top_creators (user_id);

alter table user_top_creators enable row level security;

create policy "user_top_creators_select_own" on user_top_creators
  for select using (auth.uid() = user_id);
create policy "user_top_creators_insert_own" on user_top_creators
  for insert with check (auth.uid() = user_id);
create policy "user_top_creators_update_own" on user_top_creators
  for update using (auth.uid() = user_id);
create policy "user_top_creators_delete_own" on user_top_creators
  for delete using (auth.uid() = user_id);
