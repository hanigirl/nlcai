-- image_post is a single-image slot too — dedupe it.
--
-- 028 cleaned the `video` and `cover` slots. The same unverified-delete bug also
-- affected `image` rows under the `image_post` format: 4 variants were left
-- holding 2-5 rows with distinct URLs, each accumulated minutes-to-hours apart
-- as the user replaced their image.
--
-- Why this matters NOW and not before: the detail endpoint's `formatMedia`
-- lookup takes the FIRST row it sees per format, and its ordering was just
-- changed from `created_at desc` to `asc` (so that carousel and story, which
-- insert their frames in array order, report slide 1 instead of the last slide).
-- For a genuinely single-slot format that flip means the OLDEST row wins — i.e.
-- these four posts would start showing the image the user had replaced. Removing
-- the stale rows makes ascending order correct for every format.
--
-- carousel and story are deliberately untouched: N image rows per variant is
-- their correct shape.
--
-- Keep-newest, same rule and same backup table as 028.

with ranked as (
  select ma.id,
         row_number() over (
           partition by ma.format_variant_id
           order by ma.created_at desc, ma.id desc
         ) as rn
  from media_assets ma
  join format_variants fv on fv.id = ma.format_variant_id
  where ma.asset_type = 'image'
    and fv.format = 'image_post'
)
insert into media_assets_dupe_backup_20260728
select m.*
from media_assets m
join ranked r on r.id = m.id
where r.rn > 1;

delete from media_assets m
using media_assets_dupe_backup_20260728 b
where m.id = b.id;
