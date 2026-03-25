-- Allow standalone hooks (not tied to an idea)
alter table hooks alter column idea_id drop not null;

-- Add user_id for direct access
alter table hooks add column user_id uuid references users on delete cascade;

-- Add is_used flag to track which hooks became core posts
alter table hooks add column is_used boolean not null default false;

-- Index for fast user listing
create index hooks_user_id_idx on hooks (user_id);

-- RLS policies for direct user_id access
create policy "hooks_select_own_direct" on hooks
  for select using (auth.uid() = user_id);
create policy "hooks_insert_own_direct" on hooks
  for insert with check (auth.uid() = user_id);
create policy "hooks_update_own_direct" on hooks
  for update using (auth.uid() = user_id);
create policy "hooks_delete_own_direct" on hooks
  for delete using (auth.uid() = user_id);
