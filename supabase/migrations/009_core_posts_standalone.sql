-- ============================================================
-- Allow core_posts to be saved directly (without project/hook chain)
-- Adds title, user_id, hook_text, user_response for standalone use
-- ============================================================

-- Add new columns
alter table core_posts add column title text;
alter table core_posts add column user_id uuid references users on delete cascade;
alter table core_posts add column hook_text text;
alter table core_posts add column user_response text;

-- Make hook_id and project_id nullable (existing rows keep their values)
alter table core_posts alter column hook_id drop not null;
alter table core_posts alter column project_id drop not null;

-- Drop the unique constraint on hook_id (allows multiple posts without hooks)
alter table core_posts drop constraint if exists core_posts_hook_id_key;

-- Index for fast user listing
create index core_posts_user_id_idx on core_posts (user_id);

-- RLS policy for direct user_id access (in addition to existing project-based policies)
create policy "core_posts_select_own_direct" on core_posts
  for select using (auth.uid() = user_id);
create policy "core_posts_insert_own_direct" on core_posts
  for insert with check (auth.uid() = user_id);
create policy "core_posts_update_own_direct" on core_posts
  for update using (auth.uid() = user_id);
create policy "core_posts_delete_own_direct" on core_posts
  for delete using (auth.uid() = user_id);

-- Also allow format_variants access via user_id on core_posts
create policy "format_variants_select_own_direct" on format_variants
  for select using (
    exists (select 1 from core_posts where core_posts.id = format_variants.core_post_id and core_posts.user_id = auth.uid())
  );
create policy "format_variants_insert_own_direct" on format_variants
  for insert with check (
    exists (select 1 from core_posts where core_posts.id = format_variants.core_post_id and core_posts.user_id = auth.uid())
  );
create policy "format_variants_update_own_direct" on format_variants
  for update using (
    exists (select 1 from core_posts where core_posts.id = format_variants.core_post_id and core_posts.user_id = auth.uid())
  );
create policy "format_variants_delete_own_direct" on format_variants
  for delete using (
    exists (select 1 from core_posts where core_posts.id = format_variants.core_post_id and core_posts.user_id = auth.uid())
  );
