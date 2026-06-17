import type { ContentReel, ScheduledPost } from '../types';
import { toDateKey } from './timezone';

export type ScheduleListItem = {
  reel: ContentReel;
  scheduledPost: ScheduledPost;
};

type ScheduleSource = Pick<
  ContentReel,
  | 'id'
  | 'scheduledPosts'
  | 'scheduledAt'
  | 'targetAccount'
  | 'proxyId'
  | 'caption'
  | 'postedAt'
>;

/** Merge legacy single-schedule fields into a scheduled-post queue. */
export function normalizeScheduledPosts(source: ScheduleSource): ScheduledPost[] {
  const stored = source.scheduledPosts ?? [];
  if (stored.length > 0) return stored;
  if (source.scheduledAt && source.targetAccount && !source.postedAt) {
    return [
      {
        id: `${source.id}-legacy`,
        account: source.targetAccount,
        scheduledAt: source.scheduledAt,
        caption: source.caption || undefined,
        proxyId: source.proxyId,
      },
    ];
  }
  return [];
}

export function pendingScheduledPosts(reel: ContentReel): ScheduledPost[] {
  return normalizeScheduledPosts(reel).filter((post) => !post.postedAt);
}

export function getScheduledPostsForDate(
  reels: ContentReel[],
  dateKey: string,
): ScheduleListItem[] {
  const items: ScheduleListItem[] = [];
  for (const reel of reels) {
    for (const scheduledPost of normalizeScheduledPosts(reel)) {
      if (toDateKey(scheduledPost.scheduledAt) === dateKey) {
        items.push({ reel, scheduledPost });
      }
    }
  }
  return items.sort((a, b) => a.scheduledPost.scheduledAt - b.scheduledPost.scheduledAt);
}

export function getDueScheduledPosts(reel: ContentReel, now: number): ScheduledPost[] {
  if (rowHasActiveScheduledPublish(reel)) return [];
  return normalizeScheduledPosts(reel).filter(
    (post) =>
      post.scheduledAt <= now &&
      !post.postedAt &&
      !post.publishingAt,
  );
}

export function rowHasActiveScheduledPublish(
  reel: Pick<ContentReel, 'scheduledPosts' | 'scheduledAt' | 'targetAccount' | 'postedAt' | 'id'>,
): boolean {
  return normalizeScheduledPosts(reel).some((post) => post.publishingAt && !post.postedAt);
}
