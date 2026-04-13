-- Custom cover text override (user can change the text shown on the cover)
alter table core_posts add column if not exists cover_text text;
