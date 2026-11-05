-- ============================================================
-- 043 — YouTube privacy, chosen per post
--
-- Hani, 2026-11-05: a post going to YouTube goes out ציבורי / לא רשום / פרטי,
-- picked in the calendar preview on the YouTube tab. The choice belongs to the
-- YouTube target of that one post, so it lives on its target row (042).
--
-- Null means "never chosen" and is sent as public — the default she asked for.
-- Only YouTube rows ever carry a value; the check keeps it to the three words
-- the provider accepts as `youtubePostDetails.privacyLevel`.
--
-- Additive, no backfill. Covered by 042's RLS (own rows only).
-- ============================================================

alter table scheduled_post_targets
  add column youtube_privacy text
    check (youtube_privacy in ('public', 'unlisted', 'private'));
