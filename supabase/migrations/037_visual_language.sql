-- Visual language (Settings → Media → שפה ויזואלית), 2026-10-07.
--
-- The user describes her brand with three inputs — up to three brand
-- colours, graphic elements (each with a note on when it's used) and design
-- examples (uploaded images or a link to her site / sales page). Claude
-- distils them into one design brief that every AI image generator follows.
--
-- users.brand_colors           — up to 3 hex strings, in the order she set them.
-- users.visual_language        — the analysed brief (or the "no consistent
--                                language" warning). Written by the server.
-- users.niche_visual_language  — fallback brief derived from her niche when
--                                she has no visual language; cached per niche.

alter table users add column if not exists brand_colors text[] not null default '{}';
alter table users add column if not exists visual_language jsonb;
alter table users add column if not exists niche_visual_language jsonb;

alter table users drop constraint if exists users_brand_colors_max_3;
alter table users add constraint users_brand_colors_max_3
  check (coalesce(array_length(brand_colors, 1), 0) <= 3);

-- Design examples live next to the other media rows. A link example has no
-- file: storage_path is "url:<link>" and metadata.url carries the link (the
-- same shape Google Fonts rows use).
alter table user_media drop constraint if exists user_media_category_check;
alter table user_media add constraint user_media_category_check
  check (category in ('font', 'element', 'cover', 'style_file', 'audience_file', 'brand_example'));

-- Element descriptions are stored in metadata.description and edited in
-- place, so the owner needs UPDATE (only select/insert/delete existed).
drop policy if exists "user_media_update_own" on user_media;
create policy "user_media_update_own" on user_media
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
