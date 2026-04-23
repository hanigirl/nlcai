-- Hook favorites: simple column on existing hooks table
alter table hooks add column is_favorite boolean not null default false;
create index hooks_user_favorite_idx on hooks (user_id) where is_favorite = true;

-- Idea favorites: separate table because content ideas aren't stored in the DB
-- (they're generated client-side and kept in localStorage).
-- idea_text is the stable dedup key; idea_data stores the rest of the IdeaNote
-- so the favorites tab can rehydrate even on a fresh device.
create table if not exists idea_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  idea_text text not null,
  idea_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index idea_favorites_unique on idea_favorites (user_id, idea_text);
create index idea_favorites_user_idx on idea_favorites (user_id);

alter table idea_favorites enable row level security;

create policy "idea_favorites_select_own" on idea_favorites
  for select using (auth.uid() = user_id);
create policy "idea_favorites_insert_own" on idea_favorites
  for insert with check (auth.uid() = user_id);
create policy "idea_favorites_delete_own" on idea_favorites
  for delete using (auth.uid() = user_id);
