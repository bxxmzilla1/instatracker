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

export interface Session {
  role: 'admin' | 'employee';
  username: string;
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
