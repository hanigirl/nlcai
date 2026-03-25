-- ============================================================
-- Audience Identity — stores user's target audience profile
-- ============================================================
create table audience_identities (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null unique references users on delete cascade,

  -- Demographics
  location        text not null default '',
  employment      text not null default '',
  education       text not null default '',
  income          text not null default '',
  behavioral      text not null default '',
  awareness_level text not null default '',

  -- Pains
  daily_pains     text not null default '',
  emotional_pains text not null default '',
  unresolved_consequences text not null default '',

  -- Fears
  fears           text not null default '',

  -- Failed solutions
  failed_solutions text not null default '',

  -- Limiting beliefs
  limiting_beliefs text not null default '',

  -- Myths
  myths           text not null default '',

  -- Dreams & desires
  daily_desires   text not null default '',
  emotional_desires text not null default '',
  small_wins      text not null default '',
  ideal_solution  text not null default '',
  bottom_line     text not null default '',

  -- Quotes & language
  cross_audience_quotes text not null default '',
  ideal_solution_words  text not null default '',
  identity_statements   text not null default '',

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger audience_identities_updated_at
  before update on audience_identities
  for each row execute function update_updated_at();

-- RLS
alter table audience_identities enable row level security;

create policy "audience_identities_select_own" on audience_identities
  for select using (auth.uid() = user_id);
create policy "audience_identities_insert_own" on audience_identities
  for insert with check (auth.uid() = user_id);
create policy "audience_identities_update_own" on audience_identities
  for update using (auth.uid() = user_id);
