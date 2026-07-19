-- ============================================================
-- Business knowledge sources — optional per-user knowledge the AI uses to
-- write better hooks & content (past meetings, webinars, docs, links).
-- Storage-light: we keep only distilled TEXT (summary + optional raw_text)
-- and a link reference (source_url) — never the raw media/file.
-- ============================================================
create table business_sources (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users on delete cascade,
  source_type text not null default 'other'
              check (source_type in ('meeting', 'webinar', 'doc', 'link', 'other')),
  title       text not null,
  source_url  text,                      -- reference only (Drive/Docs/article); never the media
  summary     text,                      -- distilled text injected into prompts
  raw_text    text,                      -- optional extracted text, for re-summarization (null for pdf/link)
  status      text not null default 'ready'
              check (status in ('ready', 'pending', 'failed')),
  active      boolean not null default true,   -- user toggle: feed this to the AI or not
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index business_sources_user_recent on business_sources (user_id, created_at desc);

create trigger business_sources_updated_at
  before update on business_sources
  for each row execute function update_updated_at();

-- RLS
alter table business_sources enable row level security;

create policy "business_sources_select_own" on business_sources
  for select using (auth.uid() = user_id);
create policy "business_sources_insert_own" on business_sources
  for insert with check (auth.uid() = user_id);
create policy "business_sources_update_own" on business_sources
  for update using (auth.uid() = user_id);
create policy "business_sources_delete_own" on business_sources
  for delete using (auth.uid() = user_id);
