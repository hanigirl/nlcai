-- Allow storing original identity files (style + audience) in user_media
alter table user_media drop constraint if exists user_media_category_check;
alter table user_media add constraint user_media_category_check
  check (category in ('font', 'element', 'cover', 'style_file', 'audience_file'));
