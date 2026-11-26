-- ============================================================
-- 049 — a hook's brief ("מה תרצו להגיד על זה?") lives on the hook
--
-- What she wants to say about a hook, typed on the canvas before (or
-- without ever) clicking "תייצר לי פוסט ליבה", was kept only in one
-- browser's localStorage — in a single slot that the next hook she opened
-- overwrote. It never reached another device and didn't survive an hour of
-- moving between hooks. It belongs to the hook row, next to hook_text.
--
-- Purely additive. hooks already has RLS with per-user policies
-- (hooks_select_own_direct, hooks_update_own_direct: auth.uid() = user_id),
-- which cover this column.
-- ============================================================

alter table public.hooks add column if not exists brief text;
alter table public.hooks add column if not exists brief_updated_at timestamptz;

comment on column public.hooks.brief is 'What she wants to say about this hook (canvas "מה תרצו להגיד על זה?"). Autosaved via /api/hooks/[id]/brief. Null = never typed.';
