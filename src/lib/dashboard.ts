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

export interface CardStats {
  totalFollowers: number;
  totalReelViews: number;
  totalAccounts: number;
  totalReels: number;
  newAccounts: number;
  bannedAccounts: number;
  newReels: number;
}

/** Counts reels whose first captured snapshot falls within [start, end]. */
export function countNewReels(
  reelSnapshots: ReelSnapshot[],
  start: number,
  end: number,
): number {
  const firstSeen = new Map<string, number>();
  for (const snapshot of reelSnapshots) {
    const current = firstSeen.get(snapshot.id);
    if (current === undefined || snapshot.capturedAt < current) {
      firstSeen.set(snapshot.id, snapshot.capturedAt);
    }
  }
  let count = 0;
  for (const t of firstSeen.values()) {
    if (t >= start && t <= end) count += 1;
  }
  return count;
}

function latestUpTo<T extends { capturedAt: number }>(rows: T[], asOf?: number): T | undefined {
  let best: T | undefined;
  for (const row of rows) {
    if (asOf !== undefined && row.capturedAt > asOf) continue;
    if (!best || row.capturedAt >= best.capturedAt) best = row;
  }
  return best;
}

/**
 * Computes the dashboard card values. When `asOf` is set, totals reflect the last
 * saved data up to that timestamp; otherwise they reflect the latest known data.
 * `windowStart`/`windowEnd` bound the New/Banned counts.
 */
export function computeCardStats(
  accounts: TrackedAccount[],
  reelSnapshots: ReelSnapshot[],
  followerSnapshots: FollowerSnapshot[],
  asOf: number | undefined,
  windowStart: number,
  windowEnd: number,
): CardStats {
  const reelGroups = new Map<string, ReelSnapshot[]>();
  for (const snapshot of reelSnapshots) {
    const arr = reelGroups.get(snapshot.id);
    if (arr) arr.push(snapshot);
    else reelGroups.set(snapshot.id, [snapshot]);
  }

  let totalReelViews = 0;
  let totalReels = 0;
  for (const snaps of reelGroups.values()) {
    const latest = latestUpTo(snaps, asOf);
    if (latest) {
      totalReelViews += latest.views;
      totalReels += 1;
    }
  }

  let totalFollowers = 0;
  if (asOf === undefined) {
    totalFollowers = accounts.reduce((sum, account) => sum + (account.lastFollowers ?? 0), 0);
  } else {
    const followerGroups = new Map<string, FollowerSnapshot[]>();
    for (const snapshot of followerSnapshots) {
      const arr = followerGroups.get(snapshot.username);
      if (arr) arr.push(snapshot);
      else followerGroups.set(snapshot.username, [snapshot]);
    }
    for (const account of accounts) {
      const latest = latestUpTo(followerGroups.get(account.username) ?? [], asOf);
      if (latest) totalFollowers += latest.followers;
    }
  }

  const totalAccounts =
    asOf === undefined ? accounts.length : accounts.filter((a) => a.addedAt <= asOf).length;
  const newAccounts = accounts.filter(
    (a) => a.addedAt >= windowStart && a.addedAt <= windowEnd,
  ).length;
  const bannedAccounts = accounts.filter(
    (a) => a.banned && a.bannedAt && a.bannedAt >= windowStart && a.bannedAt <= windowEnd,
  ).length;
  const newReels = countNewReels(reelSnapshots, windowStart, windowEnd);

  return {
    totalFollowers,
    totalReelViews,
    totalAccounts,
    totalReels,
    newAccounts,
    bannedAccounts,
    newReels,
  };
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

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function buildMonthlyBars(rows: SeriesRow[], year?: number, month?: number): DayBar[] {
  const now = new Date();
  const y = year ?? now.getFullYear();
  const m = month ?? now.getMonth();

  const isCurrent = y === now.getFullYear() && m === now.getMonth();
  const isPast = y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth());
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = isCurrent ? now.getDate() : isPast ? daysInMonth : 0;

  const monthStart = new Date(y, m, 1).getTime();
  const monthEnd = new Date(y, m + 1, 1).getTime();

  const monthRows = rows.filter(
    (row) => row.capturedAt >= monthStart && row.capturedAt < monthEnd,
  );
  const points = buildCumulativeSeries(monthRows);

  const bars: DayBar[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const endOfDay = new Date(y, m, day, 23, 59, 59, 999).getTime();
    let value = 0;

    if (day <= today) {
      for (const point of points) {
        if (point.t <= endOfDay) value = point.value;
        else break;
      }
    }

    bars.push({ day, value, isFuture: day > today, isToday: isCurrent && day === today });
  }

  return bars;
}

export function monthlyReelViewBars(
  snapshots: ReelSnapshot[],
  year?: number,
  month?: number,
): DayBar[] {
  return buildMonthlyBars(
    snapshots.map((snapshot) => ({
      id: snapshot.id,
      capturedAt: snapshot.capturedAt,
      value: snapshot.views,
    })),
    year,
    month,
  );
}

export function monthlyFollowerBars(
  snapshots: FollowerSnapshot[],
  year?: number,
  month?: number,
): DayBar[] {
  return buildMonthlyBars(
    snapshots.map((snapshot) => ({
      id: snapshot.username,
      capturedAt: snapshot.capturedAt,
      value: snapshot.followers,
    })),
    year,
    month,
  );
}

export function monthlyViewBarsForReel(
  snapshots: { views: number; capturedAt: number }[],
  year?: number,
  month?: number,
): DayBar[] {
  return buildMonthlyBars(
    snapshots.map((snapshot) => ({
      id: 'reel',
      capturedAt: snapshot.capturedAt,
      value: snapshot.views,
    })),
    year,
    month,
  );
}

/** Per-day gain (delta vs the previous day's cumulative total). */
export function dailyGainBars(rows: SeriesRow[], year?: number, month?: number): DayBar[] {
  const now = new Date();
  const y = year ?? now.getFullYear();
  const m = month ?? now.getMonth();
  const isCurrent = y === now.getFullYear() && m === now.getMonth();
  const isPast = y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth());
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = isCurrent ? now.getDate() : isPast ? daysInMonth : 0;

  const byId = new Map<string, SeriesRow[]>();
  for (const row of rows) {
    const arr = byId.get(row.id);
    if (arr) arr.push(row);
    else byId.set(row.id, [row]);
  }
  const totalAsOf = (t: number) => {
    let total = 0;
    for (const snaps of byId.values()) {
      const latest = latestUpTo(snaps, t);
      if (latest) total += latest.value;
    }
    return total;
  };

  const bars: DayBar[] = [];
  let prevTotal = totalAsOf(new Date(y, m, 1).getTime() - 1);
  for (let day = 1; day <= daysInMonth; day += 1) {
    let value = 0;
    if (day <= today) {
      const endOfDay = new Date(y, m, day, 23, 59, 59, 999).getTime();
      const total = totalAsOf(endOfDay);
      value = total - prevTotal;
      prevTotal = total;
    }
    bars.push({ day, value, isFuture: day > today, isToday: isCurrent && day === today });
  }
  return bars;
}

export function dailyReelViewBars(
  snapshots: ReelSnapshot[],
  year?: number,
  month?: number,
): DayBar[] {
  return dailyGainBars(
    snapshots.map((s) => ({ id: s.id, capturedAt: s.capturedAt, value: s.views })),
    year,
    month,
  );
}

export function dailyFollowerBars(
  snapshots: FollowerSnapshot[],
  year?: number,
  month?: number,
): DayBar[] {
  return dailyGainBars(
    snapshots.map((s) => ({ id: s.username, capturedAt: s.capturedAt, value: s.followers })),
    year,
    month,
  );
}

/** Cumulative totals as of a timestamp. */
export function totalsAsOf(
  accounts: TrackedAccount[],
  reelSnapshots: ReelSnapshot[],
  followerSnapshots: FollowerSnapshot[],
  asOf: number,
): { views: number; followers: number; reels: number; accounts: number } {
  const reelGroups = new Map<string, ReelSnapshot[]>();
  for (const s of reelSnapshots) {
    const arr = reelGroups.get(s.id);
    if (arr) arr.push(s);
    else reelGroups.set(s.id, [s]);
  }
  let views = 0;
  let reels = 0;
  for (const snaps of reelGroups.values()) {
    const latest = latestUpTo(snaps, asOf);
    if (latest) {
      views += latest.views;
      reels += 1;
    }
  }

  const followerGroups = new Map<string, FollowerSnapshot[]>();
  for (const s of followerSnapshots) {
    const arr = followerGroups.get(s.username);
    if (arr) arr.push(s);
    else followerGroups.set(s.username, [s]);
  }
  let followers = 0;
  for (const account of accounts) {
    const latest = latestUpTo(followerGroups.get(account.username) ?? [], asOf);
    if (latest) followers += latest.followers;
  }

  const accountsCount = accounts.filter((a) => a.addedAt <= asOf).length;
  return { views, followers, reels, accounts: accountsCount };
}
