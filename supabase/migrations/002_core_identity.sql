-- ============================================================
-- Core Identity — stores user's brand voice & identity
-- ============================================================
create table core_identities (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references users on delete cascade,
  who_i_am   text not null default '',
  who_i_serve text not null default '',
  how_i_sound text not null default '',
  slang_examples text not null default '',
  what_i_never_do text not null default '',
  product_name text not null default '',
  niche       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger core_identities_updated_at
  before update on core_identities
  for each row execute function update_updated_at();

-- RLS
alter table core_identities enable row level security;

create policy "core_identities_select_own" on core_identities
  for select using (auth.uid() = user_id);
create policy "core_identities_insert_own" on core_identities
  for insert with check (auth.uid() = user_id);
create policy "core_identities_update_own" on core_identities
  for update using (auth.uid() = user_id);
