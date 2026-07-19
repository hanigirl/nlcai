-- Widen learning_logs beyond "the user hand-edited the text".
--
-- Until now the only learning signal was a manual diff, captured at a single
-- button click. The chat refine flow carries a much richer signal that was
-- being thrown away: the user states in words what they want changed, and then
-- explicitly keeps ("החל שינויים") or rejects ("בטל שינוי") the AI's revision.
-- That accept/reject is the only real "what worked / what didn't" the product
-- has, so it gets first-class columns.

alter table learning_logs
  add column source text not null default 'manual_edit'
    check (source in ('manual_edit', 'chat_instruction')),
  -- null for manual edits (an edit is an implicit preference, not a verdict);
  -- set only on chat revisions the user explicitly kept or reverted.
  add column outcome text
    check (outcome in ('accepted', 'rejected')),
  -- The user's own words for the change they asked for. Verbatim, not summarized.
  add column instruction text;

-- fetchLearningInsights reads the newest N rows per (user, content_type) and
-- now also splits them by outcome; index the exact access path.
create index learning_logs_user_type_recent
  on learning_logs (user_id, content_type, created_at desc);
