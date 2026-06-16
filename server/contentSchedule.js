/** Helpers for multi-account scheduled posts (mirrors src/lib/contentSchedule.ts). */

export function normalizeScheduledPosts(row) {
  const stored = Array.isArray(row.scheduled_posts) ? row.scheduled_posts : [];
  if (stored.length > 0) return stored;
  if (row.scheduled_at && row.target_account) {
    return [
      {
        id: `${row.id}-legacy`,
        account: row.target_account,
        scheduledAt: row.scheduled_at,
        caption: row.caption || undefined,
        proxyId: row.proxy_id || undefined,
      },
    ];
  }
  return [];
}

export function getDueScheduledPosts(row, now) {
  return normalizeScheduledPosts(row).filter(
    (post) => post.scheduledAt <= now && !post.postedAt && !post.publishingAt,
  );
}
