-- ============================================================
-- 041 — forget the old 👍 / 👎 ("אהבת את מה שיצרנו?") on AI media
--
-- The row under the result cards was removed on 2026-11-05: the AI-edit
-- chat replaced it, and nothing writes or reads these votes any more.
-- Hani asked for the old likes to be deleted too (2026-11-05), so a liked
-- image stops steering new generations.
--
-- What goes: the `feedback` key of users.visual_language (per format) and
-- of users.niche_visual_language (per dark / light tone) — the votes, the
-- reasons and the style-anchor paths.
--
-- What this can't remove: the anchor image files themselves
-- (user-media/<user>/style-anchor/*). Supabase blocks deleting storage
-- objects from SQL; they are unreferenced after this and can be removed in
-- the dashboard (Storage → user-media). Also untouched: a brief that a 👎
-- note already rewrote — that text is now part of the visual language, and
-- re-running the analysis is what resets it.
--
-- Idempotent: safe to run again after the code is deployed.
-- ============================================================

update users
set visual_language = visual_language - 'feedback'
where visual_language ? 'feedback';

update users
set niche_visual_language = niche_visual_language - 'feedback'
where niche_visual_language ? 'feedback';
