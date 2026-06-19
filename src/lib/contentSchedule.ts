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
  | 'mediaType'
>;

function trimCaption(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Copy a shared caption onto pending scheduled posts that are missing one. */
export function backfillScheduledPostCaptions(
  posts: ScheduledPost[],
  caption: string,
): ScheduledPost[] {
  const fallback = trimCaption(caption);
  if (!fallback) return posts;
  return posts.map((post) => {
    if (post.postedAt || trimCaption(post.caption)) return post;
    return { ...post, caption: fallback };
  });
}

/** Caption for a scheduled publish: per-post caption, then reel-level fallback. */
export function resolvePublishCaption(
  post: Pick<ScheduledPost, 'caption'> | undefined,
  source: Pick<ScheduleSource, 'caption' | 'mediaType'>,
): string {
  if (source.mediaType === 'story') return '';
  const fromPost = trimCaption(post?.caption);
  if (fromPost) return fromPost;
  return trimCaption(source.caption);
}

/** Merge legacy single-schedule fields into a scheduled-post queue. */
export function normalizeScheduledPosts(source: ScheduleSource): ScheduledPost[] {
  const stored = source.scheduledPosts ?? [];
  const rowCaption = trimCaption(source.caption);

  if (stored.length > 0) {
    return stored.map((post) => {
      if (trimCaption(post.caption) || !rowCaption) return post;
      return { ...post, caption: rowCaption };
    });
  }
  if (source.scheduledAt && source.targetAccount && !source.postedAt) {
    return [
      {
        id: `${source.id}-legacy`,
        account: source.targetAccount,
        scheduledAt: source.scheduledAt,
        caption: rowCaption || undefined,
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
      !post.publishingAt &&
      !post.skippedAt,
  );
}

export function rowHasActiveScheduledPublish(
  reel: Pick<
    ContentReel,
    'scheduledPosts' | 'scheduledAt' | 'targetAccount' | 'postedAt' | 'id' | 'publishingAt'
  >,
): boolean {
  if (reel.publishingAt && !reel.postedAt) return true;
  return normalizeScheduledPosts(reel).some((post) => post.publishingAt && !post.postedAt);
}

/** True when any content row currently has a scheduled publish in flight. */
export function anyActiveScheduledPublish(reels: ContentReel[]): boolean {
  return reels.some(rowHasActiveScheduledPublish);
}
