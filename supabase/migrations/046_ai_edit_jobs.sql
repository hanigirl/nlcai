-- ============================================================
-- 046 — AI edit agent runs, on the server
--
-- Hani, 2026-11-10: the AI edit chat becomes an agent that works on the
-- server — a reload, a closed tab or another device never loses the edit
-- or its reply. One row per run: the panel follows it (status + the step
-- it's on), and the run writes its reply into the conversation itself
-- (ai_chat_threads), so whoever opens the panel next sees it.
--
-- Written by the server (service role) while it runs; she reads her own.
-- ============================================================

create table ai_edit_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null,
  format text not null,
  chat_key text not null,
  -- running → done | asking | failed
  status text not null default 'running' check (status in ('running', 'asking', 'done', 'failed')),
  -- The step it's on, in her language ("מצלם את הטיוטה כדי לבדוק אותה...").
  progress text not null default '',
  -- What the run handed back (reply, options for a question, the new media).
  outcome jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_edit_jobs_by_chat on ai_edit_jobs (user_id, chat_key, created_at desc);

alter table ai_edit_jobs enable row level security;

create policy "own ai edit jobs: select" on ai_edit_jobs
  for select using (user_id = (select auth.uid()));
