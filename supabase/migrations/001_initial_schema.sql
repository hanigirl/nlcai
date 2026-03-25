-- ============================================================
-- Content Creator Platform — Initial Schema
-- ============================================================

-- Enums
create type plan_tier as enum ('front', 'premium');
create type format_type as enum ('story', 'talking_head', 'carousel', 'image_post');
create type generation_status as enum ('pending', 'processing', 'completed', 'failed');

-- ============================================================
-- Helper: auto-update updated_at
-- ============================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- 1. users (synced from auth.users)
-- ============================================================
create table users (
  id         uuid primary key references auth.users on delete cascade,
  email      text not null,
  full_name  text,
  avatar_url text,
  plan       plan_tier not null default 'front',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger users_updated_at
  before update on users
  for each row execute function update_updated_at();

-- Sync new auth signups into public.users
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', '')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- 2. projects
-- ============================================================
create table projects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users on delete cascade,
  title      text not null default 'Untitled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_user_id_idx on projects (user_id);

create trigger projects_updated_at
  before update on projects
  for each row execute function update_updated_at();

-- ============================================================
-- 3. ideas (1:1 with project)
-- ============================================================
create table ideas (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects on delete cascade,
  brief      text not null,
  expansion  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ideas_updated_at
  before update on ideas
  for each row execute function update_updated_at();

-- ============================================================
-- 4. hooks (3 per idea, 1 selected)
-- ============================================================
create table hooks (
  id            uuid primary key default gen_random_uuid(),
  idea_id       uuid not null references ideas on delete cascade,
  hook_text     text not null,
  is_selected   boolean not null default false,
  display_order smallint not null,
  status        generation_status not null default 'pending',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index hooks_idea_id_idx on hooks (idea_id);

-- Only one hook can be selected per idea
create unique index hooks_one_selected_per_idea
  on hooks (idea_id) where (is_selected = true);

create trigger hooks_updated_at
  before update on hooks
  for each row execute function update_updated_at();

-- ============================================================
-- 5. core_posts (1 per selected hook)
-- ============================================================
create table core_posts (
  id         uuid primary key default gen_random_uuid(),
  hook_id    uuid not null unique references hooks on delete cascade,
  project_id uuid not null references projects on delete cascade,
  body       text not null,
  status     generation_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index core_posts_project_id_idx on core_posts (project_id);

create trigger core_posts_updated_at
  before update on core_posts
  for each row execute function update_updated_at();

-- ============================================================
-- 6. format_variants (4 per core_post)
-- ============================================================
create table format_variants (
  id           uuid primary key default gen_random_uuid(),
  core_post_id uuid not null references core_posts on delete cascade,
  format       format_type not null,
  body         text not null default '',
  is_edited    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (core_post_id, format)
);

create index format_variants_core_post_id_idx on format_variants (core_post_id);

create trigger format_variants_updated_at
  before update on format_variants
  for each row execute function update_updated_at();

-- ============================================================
-- 7. media_assets
-- ============================================================
create table media_assets (
  id                uuid primary key default gen_random_uuid(),
  format_variant_id uuid not null references format_variants on delete cascade,
  asset_type        text not null,
  url               text not null,
  provider          text,
  provider_ref_id   text,
  status            generation_status not null default 'pending',
  metadata          jsonb default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index media_assets_format_variant_id_idx on media_assets (format_variant_id);

create trigger media_assets_updated_at
  before update on media_assets
  for each row execute function update_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================
alter table users enable row level security;
alter table projects enable row level security;
alter table ideas enable row level security;
alter table hooks enable row level security;
alter table core_posts enable row level security;
alter table format_variants enable row level security;
alter table media_assets enable row level security;

-- users: own row only
create policy "users_select_own" on users
  for select using (auth.uid() = id);
create policy "users_update_own" on users
  for update using (auth.uid() = id);

-- projects: own rows
create policy "projects_select_own" on projects
  for select using (auth.uid() = user_id);
create policy "projects_insert_own" on projects
  for insert with check (auth.uid() = user_id);
create policy "projects_update_own" on projects
  for update using (auth.uid() = user_id);
create policy "projects_delete_own" on projects
  for delete using (auth.uid() = user_id);

-- ideas: via project ownership
create policy "ideas_select_own" on ideas
  for select using (
    exists (select 1 from projects where projects.id = ideas.project_id and projects.user_id = auth.uid())
  );
create policy "ideas_insert_own" on ideas
  for insert with check (
    exists (select 1 from projects where projects.id = ideas.project_id and projects.user_id = auth.uid())
  );
create policy "ideas_update_own" on ideas
  for update using (
    exists (select 1 from projects where projects.id = ideas.project_id and projects.user_id = auth.uid())
  );
create policy "ideas_delete_own" on ideas
  for delete using (
    exists (select 1 from projects where projects.id = ideas.project_id and projects.user_id = auth.uid())
  );

-- hooks: via idea → project ownership
create policy "hooks_select_own" on hooks
  for select using (
    exists (
      select 1 from ideas
      join projects on projects.id = ideas.project_id
      where ideas.id = hooks.idea_id and projects.user_id = auth.uid()
    )
  );
create policy "hooks_insert_own" on hooks
  for insert with check (
    exists (
      select 1 from ideas
      join projects on projects.id = ideas.project_id
      where ideas.id = hooks.idea_id and projects.user_id = auth.uid()
    )
  );
create policy "hooks_update_own" on hooks
  for update using (
    exists (
      select 1 from ideas
      join projects on projects.id = ideas.project_id
      where ideas.id = hooks.idea_id and projects.user_id = auth.uid()
    )
  );
create policy "hooks_delete_own" on hooks
  for delete using (
    exists (
      select 1 from ideas
      join projects on projects.id = ideas.project_id
      where ideas.id = hooks.idea_id and projects.user_id = auth.uid()
    )
  );

-- core_posts: denormalized project_id for fast RLS
create policy "core_posts_select_own" on core_posts
  for select using (
    exists (select 1 from projects where projects.id = core_posts.project_id and projects.user_id = auth.uid())
  );
create policy "core_posts_insert_own" on core_posts
  for insert with check (
    exists (select 1 from projects where projects.id = core_posts.project_id and projects.user_id = auth.uid())
  );
create policy "core_posts_update_own" on core_posts
  for update using (
    exists (select 1 from projects where projects.id = core_posts.project_id and projects.user_id = auth.uid())
  );
create policy "core_posts_delete_own" on core_posts
  for delete using (
    exists (select 1 from projects where projects.id = core_posts.project_id and projects.user_id = auth.uid())
  );

-- format_variants: via core_post → project
create policy "format_variants_select_own" on format_variants
  for select using (
    exists (
      select 1 from core_posts
      join projects on projects.id = core_posts.project_id
      where core_posts.id = format_variants.core_post_id and projects.user_id = auth.uid()
    )
  );
create policy "format_variants_insert_own" on format_variants
  for insert with check (
    exists (
      select 1 from core_posts
      join projects on projects.id = core_posts.project_id
      where core_posts.id = format_variants.core_post_id and projects.user_id = auth.uid()
    )
  );
create policy "format_variants_update_own" on format_variants
  for update using (
    exists (
      select 1 from core_posts
      join projects on projects.id = core_posts.project_id
      where core_posts.id = format_variants.core_post_id and projects.user_id = auth.uid()
    )
  );
create policy "format_variants_delete_own" on format_variants
  for delete using (
    exists (
      select 1 from core_posts
      join projects on projects.id = core_posts.project_id
      where core_posts.id = format_variants.core_post_id and projects.user_id = auth.uid()
    )
  );

-- media_assets: via format_variant → core_post → project
create policy "media_assets_select_own" on media_assets
  for select using (
    exists (
      select 1 from format_variants
      join core_posts on core_posts.id = format_variants.core_post_id
      join projects on projects.id = core_posts.project_id
      where format_variants.id = media_assets.format_variant_id and projects.user_id = auth.uid()
    )
  );
create policy "media_assets_insert_own" on media_assets
  for insert with check (
    exists (
      select 1 from format_variants
      join core_posts on core_posts.id = format_variants.core_post_id
      join projects on projects.id = core_posts.project_id
      where format_variants.id = media_assets.format_variant_id and projects.user_id = auth.uid()
    )
  );
create policy "media_assets_update_own" on media_assets
  for update using (
    exists (
      select 1 from format_variants
      join core_posts on core_posts.id = format_variants.core_post_id
      join projects on projects.id = core_posts.project_id
      where format_variants.id = media_assets.format_variant_id and projects.user_id = auth.uid()
    )
  );
create policy "media_assets_delete_own" on media_assets
  for delete using (
    exists (
      select 1 from format_variants
      join core_posts on core_posts.id = format_variants.core_post_id
      join projects on projects.id = core_posts.project_id
      where format_variants.id = media_assets.format_variant_id and projects.user_id = auth.uid()
    )
  );
