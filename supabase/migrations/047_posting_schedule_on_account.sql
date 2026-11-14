-- The weekly posting routine ("הגדרות תזמון") lived only in one browser's
-- localStorage, so it never followed her to another device and could leak
-- between accounts in one browser (QA 2026-11-15). It belongs to the account.
-- users_update_own already lets her write her own row (email/plan stay protected, 044).
alter table public.users add column if not exists posting_schedule jsonb;
comment on column public.users.posting_schedule is 'Weekly posting routine (lib/posting-schedule PostingSchedule). Null = never saved → default routine.';
