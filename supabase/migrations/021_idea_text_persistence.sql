-- Persist the originating idea text alongside every hook and core_post in
-- the standalone flow. Matches the existing denormalization pattern (hooks
-- already carry hook_text, core_posts already carry hook_text) — the idea
-- is a snapshot of the context that produced the hook, so we want the text
-- preserved per-row even if the user later edits their /ideas list.
alter table hooks add column idea_text text;
alter table core_posts add column idea_text text;

-- Look up all hooks generated from the same idea text.
create index hooks_idea_text_idx on hooks (user_id, idea_text);
