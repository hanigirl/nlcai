-- ============================================================
-- 045 — a post's description, apart from its script
--
-- Hani, 2026-11-09: the description (the caption that goes out with the post)
-- is written in the panel's תזמון tab and shown in the calendar under the
-- time; the script is what the media is made from and stays out of the way
-- when scheduling. Publishing sends the description; a format without one
-- still sends its script, as before.
--
-- Additive, nullable, no backfill. Covered by format_variants' RLS.
-- ============================================================

alter table format_variants add column if not exists description text;
