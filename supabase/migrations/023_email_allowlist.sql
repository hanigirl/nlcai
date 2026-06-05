-- Email allowlist — gate signups to an approved cohort.
--
-- Three pieces:
--   1. public.allowed_emails — the editable list (one row per approved email).
--   2. enforce_email_allowlist() — a BEFORE INSERT trigger on auth.users.
--      This is the REAL server-side gate: it blocks creation of any auth user
--      whose email isn't on the list, across ALL signup paths (email/password
--      AND Google OAuth). It can't be bypassed from the client.
--   3. is_email_allowed(text) — a SECURITY DEFINER probe the unauthenticated
--      login page calls to show a friendly message *before* attempting signup,
--      without ever exposing the list itself.
--
-- Existing users are unaffected: the trigger fires only on INSERT (new
-- signups), never on login. Owner emails are seeded so they can't lock
-- themselves out.

create table if not exists public.allowed_emails (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

-- Store + match case-insensitively: normalize to lowercase on the way in,
-- so a row added via the Supabase table editor as "Foo@Bar.com" still matches.
create or replace function public.normalize_allowed_email()
returns trigger as $$
begin
  new.email := lower(trim(new.email));
  return new;
end;
$$ language plpgsql set search_path = '';

create trigger allowed_emails_normalize
  before insert or update on public.allowed_emails
  for each row execute function public.normalize_allowed_email();

-- RLS on, with NO anon/authenticated policies → the list is never readable
-- from the browser. Access is only via the service role and the
-- SECURITY DEFINER function below.
alter table public.allowed_emails enable row level security;

-- Friendly pre-check for the login page. SECURITY DEFINER so it can read past
-- RLS, but it only ever returns a boolean — never the list itself.
create or replace function public.is_email_allowed(check_email text)
returns boolean as $$
  select exists (
    select 1 from public.allowed_emails
    where email = lower(trim(check_email))
  );
$$ language sql security definer stable set search_path = '';

grant execute on function public.is_email_allowed(text) to anon, authenticated;

-- The real gate: block disallowed emails at the DB, regardless of path.
create or replace function public.enforce_email_allowlist()
returns trigger as $$
begin
  if not exists (
    select 1 from public.allowed_emails
    where email = lower(trim(new.email))
  ) then
    raise exception 'email_not_allowed'
      using errcode = 'P0001',
            hint = 'This email is not on the invite list.';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = '';

-- It's a trigger function only — never meant to be called via the REST API.
revoke execute on function public.enforce_email_allowlist() from public, anon, authenticated;

-- Runs BEFORE the existing on_auth_user_created (AFTER INSERT) — reject early.
create trigger enforce_email_allowlist_before_insert
  before insert on auth.users
  for each row execute function public.enforce_email_allowlist();

-- Seed: owners first so they can never be locked out. Add the rest of the
-- approved cohort here, or via the Supabase table editor, or with a follow-up
-- insert ... on conflict (email) do nothing.
insert into public.allowed_emails (email, note) values
  ('hanigirl@gmail.com', 'owner'),
  ('nataliya@nataliyarey.com', 'owner')
on conflict (email) do nothing;

-- Grandfather everyone who already has an account, so an existing user is
-- never blocked by a future re-signup / email-change edge case. These users
-- can already log in regardless (the trigger is INSERT-only), so this just
-- keeps the list complete and consistent.
insert into public.allowed_emails (email, note)
  select lower(email), 'grandfathered' from auth.users
  where email is not null
  on conflict (email) do nothing;
