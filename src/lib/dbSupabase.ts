import { supabase } from './supabase';
import { groupReelHistories } from './dbLocal';
import type { FollowerSnapshot, ReelHistory, ReelSnapshot, TrackedAccount } from '../types';

function client() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

interface AccountRow {
  username: string;
  added_at: number;
  full_name: string | null;
  bio: string | null;
  profile_pic_url: string | null;
  is_verified: boolean | null;
  last_followers: number | null;
  last_following: number | null;
  last_media_count: number | null;
  last_checked_at: number | null;
  stories: unknown;
  login_username: string | null;
  login_password: string | null;
}

interface ReelRow {
  reel_id: string;
  username: string;
  shortcode: string | null;
  caption: string | null;
  thumbnail_url: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  captured_at: number;
}

interface FollowerRow {
  username: string;
  followers: number | null;
  following: number | null;
  media_count: number | null;
  captured_at: number;
}

function toAccount(row: AccountRow): TrackedAccount {
  return {
    username: row.username,
    addedAt: row.added_at,
    fullName: row.full_name ?? undefined,
    bio: row.bio ?? undefined,
    profilePicUrl: row.profile_pic_url ?? undefined,
    isVerified: row.is_verified ?? undefined,
    lastFollowers: row.last_followers ?? undefined,
    lastFollowing: row.last_following ?? undefined,
    lastMediaCount: row.last_media_count ?? undefined,
    lastCheckedAt: row.last_checked_at ?? undefined,
    stories: Array.isArray(row.stories) ? (row.stories as TrackedAccount['stories']) : [],
    loginUsername: row.login_username ?? undefined,
    loginPassword: row.login_password ?? undefined,
  };
}

function fromAccount(account: TrackedAccount): AccountRow {
  return {
    username: account.username,
    added_at: account.addedAt,
    full_name: account.fullName ?? null,
    bio: account.bio ?? null,
    profile_pic_url: account.profilePicUrl ?? null,
    is_verified: account.isVerified ?? null,
    last_followers: account.lastFollowers ?? null,
    last_following: account.lastFollowing ?? null,
    last_media_count: account.lastMediaCount ?? null,
    last_checked_at: account.lastCheckedAt ?? null,
    stories: account.stories ?? [],
    login_username: account.loginUsername ?? null,
    login_password: account.loginPassword ?? null,
  };
}

function toReelSnapshot(row: ReelRow): ReelSnapshot {
  return {
    id: row.reel_id,
    username: row.username,
    shortcode: row.shortcode ?? '',
    caption: row.caption ?? '',
    thumbnailUrl: row.thumbnail_url ?? undefined,
    views: row.views ?? 0,
    likes: row.likes ?? 0,
    comments: row.comments ?? 0,
    capturedAt: row.captured_at,
  };
}

function toFollowerSnapshot(row: FollowerRow): FollowerSnapshot {
  return {
    username: row.username,
    followers: row.followers ?? 0,
    following: row.following ?? 0,
    mediaCount: row.media_count ?? 0,
    capturedAt: row.captured_at,
  };
}

export async function getAccounts(): Promise<TrackedAccount[]> {
  const { data, error } = await client()
    .from('accounts')
    .select('*')
    .order('added_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as AccountRow[]).map(toAccount);
}

export async function addAccount(account: TrackedAccount): Promise<void> {
  const { error } = await client().from('accounts').upsert(fromAccount(account));
  if (error) throw new Error(error.message);
}

export async function updateAccount(account: TrackedAccount): Promise<void> {
  const { error } = await client().from('accounts').upsert(fromAccount(account));
  if (error) throw new Error(error.message);
}

export async function removeAccount(username: string): Promise<void> {
  const db = client();
  const name = username.toLowerCase();
  await db.from('reel_snapshots').delete().eq('username', name);
  await db.from('follower_snapshots').delete().eq('username', name);
  const { error } = await db.from('accounts').delete().eq('username', name);
  if (error) throw new Error(error.message);
}

export async function saveFollowerSnapshot(snapshot: FollowerSnapshot): Promise<void> {
  const { error } = await client().from('follower_snapshots').insert({
    username: snapshot.username,
    followers: snapshot.followers,
    following: snapshot.following,
    media_count: snapshot.mediaCount,
    captured_at: snapshot.capturedAt,
  });
  if (error) throw new Error(error.message);
}

export async function getFollowerHistory(username: string): Promise<FollowerSnapshot[]> {
  const { data, error } = await client()
    .from('follower_snapshots')
    .select('*')
    .eq('username', username.toLowerCase())
    .order('captured_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as FollowerRow[]).map(toFollowerSnapshot);
}

export async function getAllFollowerSnapshots(): Promise<FollowerSnapshot[]> {
  const { data, error } = await client().from('follower_snapshots').select('*');
  if (error) throw new Error(error.message);
  return (data as FollowerRow[]).map(toFollowerSnapshot);
}

export async function saveReelSnapshots(snapshots: ReelSnapshot[]): Promise<void> {
  if (snapshots.length === 0) return;
  const rows = snapshots.map((snapshot) => ({
    reel_id: snapshot.id,
    username: snapshot.username,
    shortcode: snapshot.shortcode,
    caption: snapshot.caption,
    thumbnail_url: snapshot.thumbnailUrl ?? null,
    views: snapshot.views,
    likes: snapshot.likes,
    comments: snapshot.comments,
    captured_at: snapshot.capturedAt,
  }));
  const { error } = await client().from('reel_snapshots').insert(rows);
  if (error) throw new Error(error.message);
}

export async function getAllReelSnapshots(): Promise<ReelSnapshot[]> {
  const { data, error } = await client().from('reel_snapshots').select('*');
  if (error) throw new Error(error.message);
  return (data as ReelRow[]).map(toReelSnapshot);
}

export async function getReelHistories(username: string): Promise<ReelHistory[]> {
  const { data, error } = await client()
    .from('reel_snapshots')
    .select('*')
    .eq('username', username.toLowerCase());
  if (error) throw new Error(error.message);
  return groupReelHistories((data as ReelRow[]).map(toReelSnapshot));
}
