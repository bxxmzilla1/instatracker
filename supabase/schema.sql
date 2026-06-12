-- Instatracker Supabase schema
-- Run this in the Supabase SQL editor (Project → SQL Editor → New query).

create table if not exists accounts (
  username text primary key,
  added_at bigint not null,
  full_name text,
  bio text,
  profile_pic_url text,
  is_verified boolean default false,
  last_followers bigint,
  last_following bigint,
  last_media_count bigint,
  last_checked_at bigint,
  stories jsonb default '[]'::jsonb,
  login_username text,
  login_password text
);

-- If the accounts table already exists, add the credential/owner columns:
alter table accounts add column if not exists login_username text;
alter table accounts add column if not exists login_email text;
alter table accounts add column if not exists login_phone text;
alter table accounts add column if not exists login_password text;
alter table accounts add column if not exists auth_secret text;
alter table accounts add column if not exists owner text;
alter table accounts add column if not exists banned boolean default false;
alter table accounts add column if not exists banned_at bigint;

-- Employees (sub-accounts created by the admin).
create table if not exists employees (
  username text primary key,
  password text,
  created_at bigint
);

-- Blaze licenses assigned to employees.
create table if not exists licenses (
  id text primary key,
  license text,
  employee text,
  created_at bigint
);

create table if not exists follower_snapshots (
  id bigint generated always as identity primary key,
  username text not null,
  followers bigint,
  following bigint,
  media_count bigint,
  captured_at bigint not null
);

create index if not exists follower_snapshots_username_idx
  on follower_snapshots (username);

create table if not exists reel_snapshots (
  id bigint generated always as identity primary key,
  reel_id text not null,
  username text not null,
  shortcode text,
  caption text,
  thumbnail_url text,
  views bigint,
  likes bigint,
  comments bigint,
  captured_at bigint not null
);

alter table reel_snapshots add column if not exists taken_at bigint;

create index if not exists reel_snapshots_username_idx
  on reel_snapshots (username);

-- This app uses the anon key from the browser. The passcode screen gates the UI.
-- The app needs the anon role to read/write these tables. Run the block below so
-- it works whether or not Row Level Security is enabled on your project.

alter table accounts enable row level security;
alter table follower_snapshots enable row level security;
alter table reel_snapshots enable row level security;
alter table employees enable row level security;
alter table licenses enable row level security;

drop policy if exists "allow anon all" on accounts;
drop policy if exists "allow anon all" on follower_snapshots;
drop policy if exists "allow anon all" on reel_snapshots;
drop policy if exists "allow anon all" on employees;
drop policy if exists "allow anon all" on licenses;

create policy "allow anon all" on accounts
  for all to anon using (true) with check (true);
create policy "allow anon all" on follower_snapshots
  for all to anon using (true) with check (true);
create policy "allow anon all" on reel_snapshots
  for all to anon using (true) with check (true);
create policy "allow anon all" on employees
  for all to anon using (true) with check (true);
create policy "allow anon all" on licenses
  for all to anon using (true) with check (true);

-- Storage bucket for cached profile pictures, reel thumbnails, and story images.
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

drop policy if exists "media anon read" on storage.objects;
drop policy if exists "media anon write" on storage.objects;

create policy "media anon read" on storage.objects
  for select to anon using (bucket_id = 'media');
create policy "media anon write" on storage.objects
  for all to anon using (bucket_id = 'media') with check (bucket_id = 'media');
