-- ============================================================
-- 044 — AI edit conversations, kept for good
--
-- Hani, 2026-11-09: every AI edit panel (media, core post chat, format copy)
-- keeps its conversation per post for ever, on every device. "שיחה חדשה"
-- doesn't throw the old one away: it goes to the panel's archive, and she can
-- bring it back from there. Screenshots she attached are kept too — as files
-- in her user-media folder (ai-chat/), referenced by URL from the messages.
--
-- One row per conversation. chat_key is the panel's key
-- (media:<post>:<format>:<ai|own>, core:<post>, copy:<post>:<format>).
-- archived_at null = the conversation the panel shows now; at most one per key.
-- ============================================================

create table ai_chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  chat_key text not null,
  messages jsonb not null default '[]'::jsonb,
  extra jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ai_chat_threads_one_active
  on ai_chat_threads (user_id, chat_key) where archived_at is null;
create index ai_chat_threads_by_key
  on ai_chat_threads (user_id, chat_key, archived_at desc);

alter table ai_chat_threads enable row level security;

create policy "own ai chat threads: select" on ai_chat_threads
  for select using (user_id = (select auth.uid()));
create policy "own ai chat threads: insert" on ai_chat_threads
  for insert with check (user_id = (select auth.uid()));
create policy "own ai chat threads: update" on ai_chat_threads
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own ai chat threads: delete" on ai_chat_threads
  for delete using (user_id = (select auth.uid()));
