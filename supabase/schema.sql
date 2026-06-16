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
  employees jsonb default '[]'::jsonb,
  all_employees boolean default false,
  created_at bigint
);

alter table licenses add column if not exists employees jsonb default '[]'::jsonb;
alter table licenses add column if not exists all_employees boolean default false;

-- Proxies assigned to employees.
create table if not exists proxies (
  id text primary key,
  raw text,
  type text,
  host text,
  port text,
  username text,
  password text,
  rotating_link text,
  employee text,
  created_at bigint
);

alter table proxies add column if not exists rotating_link text;
alter table proxies add column if not exists employees jsonb default '[]'::jsonb;
alter table proxies add column if not exists all_employees boolean default false;

-- Account bios assigned to employees (or all).
create table if not exists bios (
  id text primary key,
  text text,
  employees jsonb default '[]'::jsonb,
  all_employees boolean default false,
  created_at bigint
);

-- CTAs assigned to employees (or all).
create table if not exists ctas (
  id text primary key,
  text text,
  employees jsonb default '[]'::jsonb,
  all_employees boolean default false,
  created_at bigint
);

-- Stories assigned to employees (or all).
create table if not exists stories (
  id text primary key,
  text text,
  employees jsonb default '[]'::jsonb,
  all_employees boolean default false,
  created_at bigint
);

-- Uploaded content reels assigned to employees (or all).
create table if not exists content (
  id text primary key,
  caption text,
  video_url text,
  employees jsonb default '[]'::jsonb,
  all_employees boolean default false,
  target_account text,
  scheduled_at bigint,
  created_at bigint
);
alter table content add column if not exists scheduled_at bigint;
alter table content add column if not exists target_account text;

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
alter table proxies enable row level security;
alter table bios enable row level security;
alter table ctas enable row level security;
alter table stories enable row level security;
alter table content enable row level security;

drop policy if exists "allow anon all" on accounts;
drop policy if exists "allow anon all" on follower_snapshots;
drop policy if exists "allow anon all" on reel_snapshots;
drop policy if exists "allow anon all" on employees;
drop policy if exists "allow anon all" on licenses;
drop policy if exists "allow anon all" on proxies;
drop policy if exists "allow anon all" on bios;
drop policy if exists "allow anon all" on ctas;
drop policy if exists "allow anon all" on stories;
drop policy if exists "allow anon all" on content;

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
create policy "allow anon all" on proxies
  for all to anon using (true) with check (true);
create policy "allow anon all" on bios
  for all to anon using (true) with check (true);
create policy "allow anon all" on ctas
  for all to anon using (true) with check (true);
create policy "allow anon all" on stories
  for all to anon using (true) with check (true);
create policy "allow anon all" on content
  for all to anon using (true) with check (true);

-- ===========================================================================
-- BLUESKY SECTION — fully separate tables from the Instagram section above.
-- ===========================================================================

create table if not exists bsky_employees (
  username text primary key,
  password text,
  created_at bigint
);

create table if not exists bsky_proxies (
  id text primary key,
  raw text,
  type text,
  host text,
  port text,
  username text,
  password text,
  rotating_link text,
  label text,
  employee text,
  employees jsonb default '[]'::jsonb,
  all_employees boolean default false,
  created_at bigint
);

alter table bsky_proxies add column if not exists label text;

create table if not exists bsky_bios (
  id text primary key,
  text text,
  employees jsonb default '[]'::jsonb,
  all_employees boolean default false,
  created_at bigint
);

create table if not exists bsky_ctas (
  id text primary key,
  text text,
  employees jsonb default '[]'::jsonb,
  all_employees boolean default false,
  created_at bigint
);

create table if not exists bsky_banners (
  id text primary key,
  url text,
  caption text,
  employees jsonb default '[]'::jsonb,
  all_employees boolean default false,
  created_at bigint
);

create table if not exists bsky_profile_pics (
  id text primary key,
  url text,
  caption text,
  employees jsonb default '[]'::jsonb,
  all_employees boolean default false,
  created_at bigint
);

create table if not exists bsky_posts (
  id text primary key,
  text text,
  image_url text,
  employees jsonb default '[]'::jsonb,
  all_employees boolean default false,
  scheduled_at bigint,
  created_at bigint
);

create table if not exists bsky_accounts (
  id text primary key,
  identifier text,
  password text,
  target text,
  type text,
  service text,
  proxy_id text,
  max_followers bigint,
  skip_existing boolean,
  delay_mode text,
  delay_ms bigint,
  delay_min bigint,
  delay_max bigint,
  employees jsonb default '[]'::jsonb,
  all_employees boolean default false,
  created_at bigint
);

alter table bsky_accounts add column if not exists proxy_id text;
alter table bsky_accounts add column if not exists max_followers bigint;
alter table bsky_accounts add column if not exists skip_existing boolean;
alter table bsky_accounts add column if not exists delay_mode text;
alter table bsky_accounts add column if not exists delay_ms bigint;
alter table bsky_accounts add column if not exists delay_min bigint;
alter table bsky_accounts add column if not exists delay_max bigint;

-- Saved Bluesky accounts added by the admin or employees.
create table if not exists bsky_saved_accounts (
  id text primary key,
  handle text,
  email text,
  password text,
  notes text,
  owner text,
  banned boolean,
  created_at bigint
);

alter table bsky_saved_accounts add column if not exists banned boolean;

create table if not exists bsky_targets (
  id text primary key,
  handle text,
  notes text,
  employees jsonb default '[]'::jsonb,
  all_employees boolean default false,
  created_at bigint
);

-- Recorded follow batches used for the Bluesky follows dashboard graph.
create table if not exists bsky_follow_events (
  id text primary key,
  account_id text,
  count bigint,
  captured_at bigint
);

-- Live run status per follow account, shared across sessions/devices.
create table if not exists bsky_account_runs (
  account_id text primary key,
  identifier text,
  owner text,
  state text,
  text text,
  done bigint,
  total bigint,
  success bigint,
  skipped bigint,
  failed bigint,
  live text,
  active boolean,
  updated_at bigint
);

alter table bsky_employees enable row level security;
alter table bsky_proxies enable row level security;
alter table bsky_bios enable row level security;
alter table bsky_ctas enable row level security;
alter table bsky_banners enable row level security;
alter table bsky_profile_pics enable row level security;
alter table bsky_posts enable row level security;
alter table bsky_accounts enable row level security;
alter table bsky_saved_accounts enable row level security;
alter table bsky_targets enable row level security;
alter table bsky_follow_events enable row level security;
alter table bsky_account_runs enable row level security;

drop policy if exists "allow anon all" on bsky_employees;
drop policy if exists "allow anon all" on bsky_proxies;
drop policy if exists "allow anon all" on bsky_bios;
drop policy if exists "allow anon all" on bsky_ctas;
drop policy if exists "allow anon all" on bsky_banners;
drop policy if exists "allow anon all" on bsky_profile_pics;
drop policy if exists "allow anon all" on bsky_posts;
drop policy if exists "allow anon all" on bsky_accounts;
drop policy if exists "allow anon all" on bsky_saved_accounts;
drop policy if exists "allow anon all" on bsky_targets;
drop policy if exists "allow anon all" on bsky_follow_events;
drop policy if exists "allow anon all" on bsky_account_runs;

create policy "allow anon all" on bsky_employees
  for all to anon using (true) with check (true);
create policy "allow anon all" on bsky_proxies
  for all to anon using (true) with check (true);
create policy "allow anon all" on bsky_bios
  for all to anon using (true) with check (true);
create policy "allow anon all" on bsky_ctas
  for all to anon using (true) with check (true);
create policy "allow anon all" on bsky_banners
  for all to anon using (true) with check (true);
create policy "allow anon all" on bsky_profile_pics
  for all to anon using (true) with check (true);
create policy "allow anon all" on bsky_posts
  for all to anon using (true) with check (true);
create policy "allow anon all" on bsky_accounts
  for all to anon using (true) with check (true);
create policy "allow anon all" on bsky_saved_accounts
  for all to anon using (true) with check (true);
create policy "allow anon all" on bsky_targets
  for all to anon using (true) with check (true);
create policy "allow anon all" on bsky_follow_events
  for all to anon using (true) with check (true);
create policy "allow anon all" on bsky_account_runs
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
