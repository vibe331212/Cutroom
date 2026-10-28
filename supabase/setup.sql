-- Cutroom accounts, settings and saved projects.
-- Paste this whole file into the Supabase SQL Editor (Run) once, on Cutroom's own project.
-- Row level security means each person can only read and change their own things.

-- profiles: the username people sign in with
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text,
  created_at timestamptz not null default now()
);

-- settings: mode, captions and other choices that follow you to any computer
create table if not exists public.settings (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- projects: the edit (clips, cuts, captions, filters, voices); the video files live in storage
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  data jsonb not null,
  thumb text,
  size_bytes bigint not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_updated on public.projects (user_id, updated_at desc);

alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.projects enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own projects" on public.projects;
create policy "own projects" on public.projects for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- media: a private bucket; every file sits in a folder named after its owner's id.
-- 50 MB per file is the most the free plan allows.
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists "own media read" on storage.objects;
create policy "own media read" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "own media write" on storage.objects;
create policy "own media write" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "own media update" on storage.objects;
create policy "own media update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "own media delete" on storage.objects;
create policy "own media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
