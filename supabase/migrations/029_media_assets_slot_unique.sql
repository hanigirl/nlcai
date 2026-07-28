-- Structural backstop for the single-slot invariant.
--
-- `video` and `cover` are one-per-format-variant by contract. Nothing enforced
-- that, so when the replace-delete silently matched zero rows the insert simply
-- appended — 238 cover rows across 13 variants by the time it was measured
-- (see 028, which cleaned them up).
--
-- `image` is EXCLUDED: carousel and story legitimately hold N image rows per
-- variant, one per slide/frame. Hence a partial index rather than a table-wide
-- unique constraint.
--
-- SEQUENCING: this must land only AFTER the writers verify their deletes
-- (clearAssetSlot in api/core-posts/[id]/route.ts, and the wipe+leftover check
-- in api/core-posts/[id]/media/route.ts) and after the client surfaces save
-- failures to the user (savePatch in app/project/page.tsx). This index converts
-- a silent duplicate into a 23505 → 500; without those two changes in place that
-- would just trade invisible duplication for an invisible error.
--
-- 028 must have run first — the index cannot be created while duplicates exist.

create unique index if not exists media_assets_one_video_cover_per_variant
  on media_assets (format_variant_id, asset_type)
  where asset_type in ('video', 'cover');
