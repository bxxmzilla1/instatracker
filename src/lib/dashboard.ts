import type { FollowerSnapshot, ReelSnapshot, TrackedAccount } from '../types';

export interface SeriesPoint {
  t: number;
  value: number;
}

export interface TopProfile {
  username: string;
  views: number;
  profilePicUrl?: string;
  followers?: number;
}

export interface TopReel {
  username: string;
  shortcode: string;
  views: number;
  thumbnailUrl?: string;
  caption?: string;
}

export interface DashboardStats {
  totalFollowers: number;
  totalReelViews: number;
  accountCount: number;
  reelCount: number;
  topProfile?: TopProfile;
  topReel?: TopReel;
}

export function latestByReel(snapshots: ReelSnapshot[]): ReelSnapshot[] {
  const map = new Map<string, ReelSnapshot>();
  for (const snapshot of snapshots) {
    const previous = map.get(snapshot.id);
    if (!previous || snapshot.capturedAt >= previous.capturedAt) {
      map.set(snapshot.id, snapshot);
    }
  }
  return [...map.values()];
}

export function computeStats(
  accounts: TrackedAccount[],
  reelSnapshots: ReelSnapshot[],
): DashboardStats {
  const reels = latestByReel(reelSnapshots);
  const totalReelViews = reels.reduce((sum, reel) => sum + reel.views, 0);
  const totalFollowers = accounts.reduce((sum, account) => sum + (account.lastFollowers ?? 0), 0);

  const viewsByUser = new Map<string, number>();
  for (const reel of reels) {
    viewsByUser.set(reel.username, (viewsByUser.get(reel.username) ?? 0) + reel.views);
  }

  let topProfile: TopProfile | undefined;
  for (const [username, views] of viewsByUser) {
    if (!topProfile || views > topProfile.views) {
      const account = accounts.find((a) => a.username === username);
      topProfile = {
        username,
        views,
        profilePicUrl: account?.profilePicUrl,
        followers: account?.lastFollowers,
      };
    }
  }

  let topReel: TopReel | undefined;
  for (const reel of reels) {
    if (!topReel || reel.views > topReel.views) {
      topReel = {
        username: reel.username,
        shortcode: reel.shortcode,
        views: reel.views,
        thumbnailUrl: reel.thumbnailUrl,
        caption: reel.caption,
      };
    }
  }

  return {
    totalFollowers,
    totalReelViews,
    accountCount: accounts.length,
    reelCount: reels.length,
    topProfile,
    topReel,
  };
}

interface SeriesRow {
  id: string;
  capturedAt: number;
  value: number;
}

export function buildCumulativeSeries(rows: SeriesRow[]): SeriesPoint[] {
  const byTime = new Map<number, SeriesRow[]>();
  for (const row of rows) {
    const bucket = byTime.get(row.capturedAt);
    if (bucket) bucket.push(row);
    else byTime.set(row.capturedAt, [row]);
  }

  const times = [...byTime.keys()].sort((a, b) => a - b);
  const latest = new Map<string, number>();
  const points: SeriesPoint[] = [];

  for (const time of times) {
    for (const row of byTime.get(time)!) {
      latest.set(row.id, row.value);
    }
    let total = 0;
    for (const value of latest.values()) total += value;
    points.push({ t: time, value: total });
  }

  return points;
}

export function followerSeries(snapshots: FollowerSnapshot[]): SeriesPoint[] {
  return buildCumulativeSeries(
    snapshots.map((snapshot) => ({
      id: snapshot.username,
      capturedAt: snapshot.capturedAt,
      value: snapshot.followers,
    })),
  );
}

export function reelViewSeries(snapshots: ReelSnapshot[]): SeriesPoint[] {
  return buildCumulativeSeries(
    snapshots.map((snapshot) => ({
      id: snapshot.id,
      capturedAt: snapshot.capturedAt,
      value: snapshot.views,
    })),
  );
}

export function filterWindow(points: SeriesPoint[], windowMs: number): SeriesPoint[] {
  if (points.length === 0) return points;
  const cutoff = Date.now() - windowMs;
  const filtered = points.filter((point) => point.t >= cutoff);
  return filtered.length >= 2 ? filtered : points.slice(-Math.min(points.length, 2));
}

export interface DayBar {
  day: number;
  value: number;
  isFuture: boolean;
  isToday: boolean;
}

export function currentMonthLabel(): string {
  return new Date().toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function buildMonthlyBars(rows: SeriesRow[]): DayBar[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthStart = new Date(year, month, 1).getTime();
  const monthEnd = new Date(year, month + 1, 1).getTime();

  const monthRows = rows.filter(
    (row) => row.capturedAt >= monthStart && row.capturedAt < monthEnd,
  );
  const points = buildCumulativeSeries(monthRows);

  const bars: DayBar[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const endOfDay = new Date(year, month, day, 23, 59, 59, 999).getTime();
    let value = 0;

    if (day <= today) {
      for (const point of points) {
        if (point.t <= endOfDay) value = point.value;
        else break;
      }
    }

    bars.push({ day, value, isFuture: day > today, isToday: day === today });
  }

  return bars;
}

export function monthlyReelViewBars(snapshots: ReelSnapshot[]): DayBar[] {
  return buildMonthlyBars(
    snapshots.map((snapshot) => ({
      id: snapshot.id,
      capturedAt: snapshot.capturedAt,
      value: snapshot.views,
    })),
  );
}

export function monthlyFollowerBars(snapshots: FollowerSnapshot[]): DayBar[] {
  return buildMonthlyBars(
    snapshots.map((snapshot) => ({
      id: snapshot.username,
      capturedAt: snapshot.capturedAt,
      value: snapshot.followers,
    })),
  );
}

export function monthlyViewBarsForReel(
  snapshots: { views: number; capturedAt: number }[],
): DayBar[] {
  return buildMonthlyBars(
    snapshots.map((snapshot) => ({
      id: 'reel',
      capturedAt: snapshot.capturedAt,
      value: snapshot.views,
    })),
  );
}
