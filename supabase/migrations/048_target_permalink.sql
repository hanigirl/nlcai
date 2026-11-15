-- The live post's link, kept once the provider reports it (QA 2026-11-15).
-- Until now permalinks were re-read on every refresh, capped at 10 posts, so
-- a busy month lost most of its links.
alter table public.scheduled_post_targets add column if not exists permalink text;
