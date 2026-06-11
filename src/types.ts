export interface StoryPreview {
  id: string;
  thumbnailUrl?: string;
  isVideo?: boolean;
  expiringAt?: number;
}

export interface TrackedAccount {
  username: string;
  addedAt: number;
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
  loginPassword?: string;
  authSecret?: string;
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
}

export interface ReelHistory {
  reelId: string;
  username: string;
  shortcode: string;
  thumbnailUrl?: string;
  caption?: string;
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
