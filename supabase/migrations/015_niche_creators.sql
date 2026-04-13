-- Verified niche creators cache
-- Stores verified creators per niche so we don't re-scan every time
create table if not exists niche_creators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  niche text not null,
  handle text not null,
  platform text not null check (platform in ('instagram', 'youtube', 'tiktok', 'linkedin')),
  followers integer not null default 0,
  bio text not null default '',
  profile_url text not null,
  verified_at timestamptz not null default now()
);

create unique index niche_creators_unique on niche_creators (user_id, handle, platform);
create index niche_creators_user_niche on niche_creators (user_id, niche);

alter table niche_creators enable row level security;

create policy "niche_creators_select_own" on niche_creators
  for select using (auth.uid() = user_id);

create policy "niche_creators_insert_own" on niche_creators
  for insert with check (auth.uid() = user_id);

create policy "niche_creators_delete_own" on niche_creators
  for delete using (auth.uid() = user_id);
