-- ============================================================
-- 041 — a multi-frame story goes out frame by frame, spaced by her gap
--
-- The routine's "מרווח בין פריימים בסטורי" (5 / 15 / 30 / 60 minutes) was
-- UI-only: a story slot became ONE provider post carrying every frame, and
-- Instagram published all of them in the same minute (verified live
-- 2026-10-29). Now each frame is its own provider post — frame 1 at the slot
-- time, frame 2 at +gap, frame 3 at +2·gap — so the slot needs:
--
--   story_gap_minutes — the gap that applied when the board wrote the row.
--     The routine lives in the browser, so the client sends it with every
--     story row; the server needs it on its own because the bridge re-syncs,
--     moves and repairs slots with no routine in hand. Null = no spacing:
--     the story goes out as one post with every frame, exactly as before.
--
--   provider_post_ids — every provider post the slot holds, in frame order.
--     `provider_post_id` stays, always equal to the first one, so everything
--     that reads a single id keeps working. Null on every pre-041 row: those
--     are read as [provider_post_id].
--
-- No backfill: existing rows keep today's single-post behaviour until the
-- board writes them again.
-- ============================================================

alter table scheduled_posts
  add column story_gap_minutes int
    check (story_gap_minutes is null or story_gap_minutes between 1 and 240),
  add column provider_post_ids text[];

comment on column scheduled_posts.story_gap_minutes is
  'Minutes between frames of a multi-frame story (from the user''s posting routine). Null = all frames in one post at the slot time.';
comment on column scheduled_posts.provider_post_ids is
  'Every provider post this slot holds, in frame order. provider_post_id = the first. Null on pre-041 rows = [provider_post_id].';
