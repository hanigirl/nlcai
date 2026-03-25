create table learning_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users on delete cascade,
  content_type text not null check (content_type in ('hook', 'core_post')),
  original_text text not null,
  edited_text text not null,
  insight     text not null,
  created_at  timestamptz not null default now()
);

create index learning_logs_user_recent on learning_logs (user_id, created_at desc);

-- RLS
alter table learning_logs enable row level security;

create policy "learning_logs_select_own" on learning_logs
  for select using (auth.uid() = user_id);
create policy "learning_logs_insert_own" on learning_logs
  for insert with check (auth.uid() = user_id);
