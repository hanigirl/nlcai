-- ============================================================
-- Products — stores user's products/services
-- ============================================================
create type product_type as enum ('front', 'premium', 'lead_magnet');

create table products (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users on delete cascade,
  name        text not null,
  type        product_type not null default 'front',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index products_user_id_idx on products (user_id);

create trigger products_updated_at
  before update on products
  for each row execute function update_updated_at();

-- RLS
alter table products enable row level security;

create policy "products_select_own" on products
  for select using (auth.uid() = user_id);
create policy "products_insert_own" on products
  for insert with check (auth.uid() = user_id);
create policy "products_update_own" on products
  for update using (auth.uid() = user_id);
create policy "products_delete_own" on products
  for delete using (auth.uid() = user_id);
