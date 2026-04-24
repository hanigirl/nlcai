-- One-time backfill: mark hooks as used when their text matches a hook_text
-- in the user's existing core_posts. Previously the is_used flag was set by
-- a text-equality match on the API write path, which silently failed when
-- the hook was edited between the hooks page and the project page.
update hooks h
set is_used = true
from core_posts cp
where cp.user_id = h.user_id
  and cp.hook_text = h.hook_text
  and h.is_used = false;
