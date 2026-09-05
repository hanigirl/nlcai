-- Scheduled posts produce ordinary accepted insights in the existing log.
alter table learning_logs drop constraint learning_logs_source_check;
alter table learning_logs add constraint learning_logs_source_check
  check (source in ('manual_edit', 'chat_instruction', 'scheduled_post'));
alter table learning_logs
  add column scheduled_core_post_id uuid references core_posts on delete cascade,
  add column scheduled_fingerprint text,
  add column approval_weight integer not null default 1,
  add column dismissed_at timestamptz;
create unique index learning_logs_scheduled_post_type
  on learning_logs (user_id, scheduled_core_post_id, content_type);

-- Updates are scoped to the caller's own scheduled insights.
create policy "learning_logs_update_scheduled_own" on learning_logs
  for update using (auth.uid() = user_id and source = 'scheduled_post')
  with check (auth.uid() = user_id and source = 'scheduled_post');
