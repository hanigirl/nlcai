-- ============================================================
-- 040 — hooks know where they came from, and what she thought of them
--
-- Groundwork for a source mix that learns from the user instead of always
-- taking 3 of 6 hooks from the knowledge sources (Hani, 2026-10-08):
--
--   hooks.source_kind / source_ref — which family (knowledge / product /
--     audience / creator / trend) and which item (an insight id
--     "<business_source_id>:<index>", a product id) the angle was built on.
--   hooks.angle_summary — what the video reveals; kept so a liked hook's
--     CONTENT can be marked as used without re-deriving it.
--   hooks.deleted_at — deleting a hook was a hard delete, so the strongest
--     negative signal left no trace. Now it hides the hook instead.
--
--   learning_logs.source 'liked_hook' — a lesson distilled from a hook she
--     starred or turned into a post: what WORKED in its form, not its topic.
-- ============================================================

alter table hooks
  add column source_kind   text,
  add column source_ref    text,
  add column angle_summary text,
  add column deleted_at    timestamptz;

create index hooks_user_source_idx on hooks (user_id, source_kind, created_at desc);

alter table learning_logs drop constraint learning_logs_source_check;
alter table learning_logs add constraint learning_logs_source_check
  check (source = any (array['manual_edit', 'chat_instruction', 'scheduled_post', 'liked_hook']));
