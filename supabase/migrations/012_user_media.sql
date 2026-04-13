-- User media: fonts, graphic elements, cover examples
-- Files stored in Supabase Storage bucket "user-media"

create table if not exists user_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  category text not null check (category in ('font', 'element', 'cover')),
  file_name text not null,
  storage_path text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index user_media_user_category_idx on user_media (user_id, category);

alter table user_media enable row level security;

create policy "user_media_select_own" on user_media
  for select using (auth.uid() = user_id);

create policy "user_media_insert_own" on user_media
  for insert with check (auth.uid() = user_id);

create policy "user_media_delete_own" on user_media
  for delete using (auth.uid() = user_id);

-- Storage bucket
insert into storage.buckets (id, name, public)
values ('user-media', 'user-media', true)
on conflict (id) do nothing;

-- Storage policies: users can manage their own folder (user_id/)
create policy "user_media_storage_select" on storage.objects
  for select using (
    bucket_id = 'user-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "user_media_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'user-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "user_media_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'user-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
