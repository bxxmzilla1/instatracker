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

/** A published Bluesky post on a specific account, with optional engagement stats. */
export interface BskyPostPublish {
  accountId: string;
  handle: string;
  uri: string;
  cid: string;
  publishedAt: number;
  likeCount?: number;
  replyCount?: number;
  repostCount?: number;
  statsFetchedAt?: number;
  error?: string;
  /** Slave accounts that liked this post (with their like record URIs, for unliking). */
  slaveLikes?: SlaveEngagement[];
  /** Slave accounts that reposted this post (with their repost record URIs, for unreposting). */
  slaveReposts?: SlaveEngagement[];
}

/** A single mass-engagement action performed by a slave account. */
export interface SlaveEngagement {
  /** Slave account id that performed the action. */
  accountId: string;
  /** Slave account handle (for display). */
  handle: string;
  /** AT URI of the like/repost record, used to undo the action. */
  recordUri: string;
}

/**
 * A throwaway Bluesky account used only for mass liking and reposting.
 * Kept entirely separate from saved "Accounts" so it never appears in
 * normal account dropdowns.
 */
export interface BskySlaveAccount {
  id: string;
  handle: string;
  password: string;
  /** Optional Bluesky proxy to route mass like/repost actions through. */
  proxyId?: string;
  /** Optional free-text note for this slave account. */
  note?: string;
  createdAt: number;
}

/** A Bluesky media post (image or video) with captions and publish history. */
export interface BskyPost {
  id: string;
  text: string;
  imageUrl?: string;
  videoUrl?: string;
  mediaType?: 'image' | 'video';
  employees: string[];
  allEmployees: boolean;
  scheduledAt?: number;
  createdAt: number;
  publishes?: BskyPostPublish[];
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

/** Live warm-up progress for a Bluesky account, shared across sessions/devices. */
export interface BskyWarmupRun {
  accountKey: string;
  handle: string;
  kind: 'follow' | 'slave';
  status: 'waiting' | 'running' | 'done' | 'error';
  step: number;
  totalSteps: number;
  label: string;
  error?: string;
  owner?: string;
  active: boolean;
  updatedAt: number;
  claimedBy?: string;
  queueOrder?: number;
}

/** A recorded batch of follows performed by a Bluesky follow account. */
export interface BskyFollowEvent {
  id: string;
  accountId: string;
  count: number;
  capturedAt: number;
  // Who the followed-with account belongs to ('all', an employee username, or
  // 'admin'). Stored so historical follow stats survive the account being
  // banned or deleted, instead of disappearing when it leaves the live list.
  owner?: string;
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

/** Geo/network details for an IP, resolved via IPinfo. */
export interface ProxyIpInfo {
  ip: string;
  city?: string;
  region?: string;
  /** ISO country code (e.g. "US"). */
  country?: string;
  /** Full country name (e.g. "United States"). */
  countryName?: string;
  /** Network/AS name (e.g. "Comcast Cable"). */
  org?: string;
  hostname?: string;
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
  /** Short display name shown in proxy pickers (e.g. "US-1", "adriel"). */
  label?: string;
  /** Most recently checked exit IP for this proxy. */
  currentIp?: string;
  /** Geo/network details for the current exit IP. */
  ipInfo?: ProxyIpInfo;
  /** When the exit IP was last checked (ms epoch). */
  ipCheckedAt?: number;
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

export const META_SESSIONS_LINK_ID = 'meta-sessions';
export const META_SESSIONS_LINK_ID_2 = 'meta-sessions-2';
export const META_SESSIONS_LINK_ID_3 = 'meta-sessions-3';

/** Saved external API link (e.g. Meta Developer sessions URL). */
export interface ApiLink {
  id: string;
  label: string;
  url: string;
  updatedAt: number;
}

export interface StoryNote {
  id: string;
  text: string;
  employees: string[];
  allEmployees: boolean;
  createdAt: number;
}

export type ContentMediaType = 'reel' | 'image' | 'story' | 'carousel';

/** Uploaded content (reels, images, stories, carousels) assigned to employees. */
export interface ContentReel {
  id: string;
  caption: string;
  videoUrl: string;
  /** Content format: reel, feed image, story, or multi-image carousel. */
  mediaType?: ContentMediaType;
  /** Image URLs for carousel albums (feed carousels only). */
  mediaUrls?: string[];
  employees: string[];
  allEmployees: boolean;
  targetAccount?: string;
  /** Proxy to route Instagram Graph API publish requests through. */
  proxyId?: string;
  scheduledAt?: number;
  createdAt: number;
  /** When the item was successfully published to Instagram (ms epoch). */
  postedAt?: number;
  /** Permalink to the published Instagram media. */
  permalink?: string;
  /** Last publish error message, if any. */
  postError?: string;
  /** Log of every account this item was posted to, with timestamps. */
  postHistory?: PostHistoryEntry[];
  /** Pending posts to different accounts (each with its own time, caption, proxy). */
  scheduledPosts?: ScheduledPost[];
  /** When a background publish job started (ms epoch). */
  publishingAt?: number;
  /** Current stage while publishing (for progress UI). */
  publishStage?: 'creating' | 'processing' | 'publishing';
}

export interface PostHistoryEntry {
  /** Instagram account username it was posted to. */
  account: string;
  /** When it was posted (ms epoch). */
  postedAt: number;
  /** Permalink to the published media, if available. */
  permalink?: string;
  /** Proxy exit IP the post was published through. */
  publishedIp?: string;
  /** Readable country for the publish IP (e.g. "United States"). */
  publishedIpCountry?: string;
}

/** A single scheduled publish of content to one Instagram account. */
export interface ScheduledPost {
  id: string;
  account: string;
  scheduledAt: number;
  caption?: string;
  proxyId?: string;
  publishingAt?: number;
  publishStage?: 'creating' | 'processing' | 'publishing';
  postedAt?: number;
  permalink?: string;
  postError?: string;
  /** Proxy exit IP this post was published through. */
  publishedIp?: string;
  /** Readable country for the publish IP (e.g. "United States"). */
  publishedIpCountry?: string;
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
  /** Instagram Graph API user ID (Business/Creator account) for analytics. */
  igUserId?: string;
  /** Long-lived Instagram Graph API access token for analytics. */
  igAccessToken?: string;
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
