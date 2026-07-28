-- Media assets: commit the RLS drift, then clean up the duplicate rows it caused.
--
-- PART 1 — RLS drift.
--
-- 001_initial_schema.sql gave media_assets four policies, and every one of them
-- reaches the user through `core_posts.project_id -> projects.user_id`.
-- 009_core_posts_standalone.sql then made core_posts standalone (`user_id` on the
-- row, `project_id` nullable) and added `*_own_direct` policies for core_posts and
-- format_variants — but NOT for media_assets.
--
-- Production has the media_assets `_own_direct` policies; they were added straight
-- to the database and never written down as a migration. So prod works and any
-- environment rebuilt from this folder does not: every standalone post has
-- `project_id IS NULL`, the join yields zero rows, and all four policies evaluate
-- false. SELECT and DELETE then match zero rows *without erroring*, which is the
-- exact failure this file's PART 2 is cleaning up after.
--
-- This part is written to DESCRIBE production, not to change it. The
-- `drop policy if exists` before each create makes it a safe no-op there.

drop policy if exists "media_assets_select_own_direct" on media_assets;
create policy "media_assets_select_own_direct" on media_assets
  for select using (
    exists (
      select 1 from format_variants fv
      join core_posts cp on cp.id = fv.core_post_id
      where fv.id = media_assets.format_variant_id and cp.user_id = auth.uid()
    )
  );

drop policy if exists "media_assets_insert_own_direct" on media_assets;
create policy "media_assets_insert_own_direct" on media_assets
  for insert with check (
    exists (
      select 1 from format_variants fv
      join core_posts cp on cp.id = fv.core_post_id
      where fv.id = media_assets.format_variant_id and cp.user_id = auth.uid()
    )
  );

drop policy if exists "media_assets_update_own_direct" on media_assets;
create policy "media_assets_update_own_direct" on media_assets
  for update using (
    exists (
      select 1 from format_variants fv
      join core_posts cp on cp.id = fv.core_post_id
      where fv.id = media_assets.format_variant_id and cp.user_id = auth.uid()
    )
  );

drop policy if exists "media_assets_delete_own_direct" on media_assets;
create policy "media_assets_delete_own_direct" on media_assets
  for delete using (
    exists (
      select 1 from format_variants fv
      join core_posts cp on cp.id = fv.core_post_id
      where fv.id = media_assets.format_variant_id and cp.user_id = auth.uid()
    )
  );


-- PART 2 — clean up the duplicates.
--
-- The app treats `video` and `cover` as single slots: one row per
-- (format_variant_id, asset_type). Nothing in the schema enforced that, and the
-- writers in api/core-posts/[id]/route.ts delete-then-insert while discarding the
-- delete's error — so once the delete stopped matching rows, every save appended.
-- Measured on 2026-07-28: 238 cover rows across 13 variants and 125 video rows
-- across 16, with one variant holding 138 cover rows pointing at 138 DISTINCT
-- uploads. Rate per month: Mar ~15/variant, Apr ~20, May up to 28.8, Jun 2.0,
-- Jul 1.0 — dormant now, but nothing structural prevents it recurring. That is
-- what 029 is for.
--
-- KEEP-NEWEST is the safe rule: both readers of these slots already sort
-- `created_at desc` and take one row (api/core-posts/[id]/route.ts, the videoUrl
-- and coverUrl lookups), so the rows deleted here are rows nobody can currently
-- see. Nothing changes visually.
--
-- `image` is deliberately excluded — carousel and story legitimately hold N image
-- rows per variant (one per slide/frame).
--
-- The backup table is NOT dropped here. It holds the storage URLs of the deleted
-- rows, which is the only remaining record of the ~350 orphaned files in the
-- `user-media` bucket; a future sweep needs them. Drop it deliberately, later.

create table if not exists media_assets_dupe_backup_20260728
  (like media_assets including all);

with ranked as (
  select id,
         row_number() over (
           partition by format_variant_id, asset_type
           order by created_at desc, id desc
         ) as rn
  from media_assets
  where asset_type in ('video', 'cover')
)
insert into media_assets_dupe_backup_20260728
select m.*
from media_assets m
join ranked r on r.id = m.id
where r.rn > 1;

delete from media_assets m
using media_assets_dupe_backup_20260728 b
where m.id = b.id;
