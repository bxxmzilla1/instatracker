export interface StoryPreview {
  id: string;
  thumbnailUrl?: string;
  isVideo?: boolean;
  expiringAt?: number;
}

export interface Employee {
  username: string;
  password: string;
  createdAt: number;
}

export type Platform = 'instagram' | 'bluesky';

export interface Session {
  role: 'admin' | 'employee';
  username: string;
  platform?: Platform;
}

/** A Bluesky banner or profile-picture image asset assigned to employees. */
export interface ImageAsset {
  id: string;
  url: string;
  caption?: string;
  employees: string[];
  allEmployees: boolean;
  createdAt: number;
}

/** A Bluesky text post (with optional image) assigned to employees. */
export interface BskyPost {
  id: string;
  text: string;
  imageUrl?: string;
  employees: string[];
  allEmployees: boolean;
  scheduledAt?: number;
  createdAt: number;
}

/** A saved Bluesky account (added by the admin or an employee). */
export interface BskySavedAccount {
  id: string;
  handle: string;
  email?: string;
  password?: string;
  notes?: string;
  owner?: string;
  banned?: boolean;
  createdAt: number;
}

/** A saved target profile to mass-follow, assignable to employees. */
export interface BskyTarget {
  id: string;
  handle: string;
  notes?: string;
  employees: string[];
  allEmployees: boolean;
  createdAt: number;
}

/** Live run status for a Bluesky follow account, shared across sessions. */
export interface BskyRun {
  accountId: string;
  identifier?: string;
  owner?: string;
  state: string;
  text: string;
  done: number;
  total: number;
  success: number;
  skipped: number;
  failed: number;
  live: string;
  active: boolean;
  updatedAt: number;
}

/** A recorded batch of follows performed by a Bluesky follow account. */
export interface BskyFollowEvent {
  id: string;
  accountId: string;
  count: number;
  capturedAt: number;
}

/** A Bluesky account configured for the mass-follow tool. */
export interface BskyAccount {
  id: string;
  identifier: string;
  password: string;
  target: string;
  type: 'followers' | 'following';
  service?: string;
  proxyId?: string;
  maxFollowers?: number;
  skipExisting?: boolean;
  delayMode?: 'fixed' | 'random';
  delayMs?: number;
  delayMin?: number;
  delayMax?: number;
  employees: string[];
  allEmployees: boolean;
  createdAt: number;
}

export interface License {
  id: string;
  license: string;
  employees: string[];
  allEmployees: boolean;
  employee?: string;
  createdAt: number;
}

export interface Proxy {
  id: string;
  raw: string;
  type: string;
  host: string;
  port: string;
  username: string;
  password: string;
  rotatingLink: string;
  employees: string[];
  allEmployees: boolean;
  employee?: string;
  createdAt: number;
}

export interface Bio {
  id: string;
  text: string;
  employees: string[];
  allEmployees: boolean;
  createdAt: number;
}

export interface Cta {
  id: string;
  text: string;
  employees: string[];
  allEmployees: boolean;
  createdAt: number;
}

export interface StoryNote {
  id: string;
  text: string;
  employees: string[];
  allEmployees: boolean;
  createdAt: number;
}

export interface ContentReel {
  id: string;
  caption: string;
  videoUrl: string;
  employees: string[];
  allEmployees: boolean;
  targetAccount?: string;
  scheduledAt?: number;
  createdAt: number;
}

export interface TrackedAccount {
  username: string;
  addedAt: number;
  owner?: string;
  fullName?: string;
  bio?: string;
  profilePicUrl?: string;
  isVerified?: boolean;
  lastFollowers?: number;
  lastFollowing?: number;
  lastMediaCount?: number;
  lastCheckedAt?: number;
  stories?: StoryPreview[];
  loginUsername?: string;
  loginEmail?: string;
  loginPhone?: string;
  loginPassword?: string;
  authSecret?: string;
  banned?: boolean;
  bannedAt?: number;
}

export interface FollowerSnapshot {
  username: string;
  followers: number;
  following: number;
  mediaCount: number;
  capturedAt: number;
}

export interface ReelSnapshot {
  id: string;
  username: string;
  shortcode: string;
  caption: string;
  thumbnailUrl?: string;
  views: number;
  likes: number;
  comments: number;
  capturedAt: number;
  takenAt?: number;
}

export interface ReelHistory {
  reelId: string;
  username: string;
  shortcode: string;
  thumbnailUrl?: string;
  caption?: string;
  takenAt?: number;
  snapshots: { views: number; likes: number; comments: number; capturedAt: number }[];
}

export interface ParsedProfile {
  username: string;
  fullName: string;
  profilePicUrl: string;
  followers: number;
  following: number;
  mediaCount: number;
  isVerified: boolean;
  biography: string;
}

export interface ParsedReel {
  id: string;
  shortcode: string;
  caption: string;
  thumbnailUrl?: string;
  views: number;
  likes: number;
  comments: number;
  takenAt?: number;
}

export interface ParsedStory {
  id: string;
  thumbnailUrl?: string;
  isVideo?: boolean;
  expiringAt?: number;
}
