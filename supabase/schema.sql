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
  stories jsonb default '[]'::jsonb
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

create index if not exists reel_snapshots_username_idx
  on reel_snapshots (username);

-- Stores the saved login credentials (single row) when "Save login credentials" is on.
create table if not exists credentials (
  id bigint primary key,
  username text,
  password text,
  updated_at bigint
);

-- This app uses the anon key from the browser. The passcode screen gates the UI.
-- Row Level Security is left disabled for simplicity (single-user personal tool).
-- For stricter access, enable RLS and add policies that match your auth setup.
