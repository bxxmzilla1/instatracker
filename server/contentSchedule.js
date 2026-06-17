/** Helpers for multi-account scheduled posts (mirrors src/lib/contentSchedule.ts). */

export function normalizeScheduledPosts(row) {
  const stored = Array.isArray(row.scheduled_posts) ? row.scheduled_posts : [];
  if (stored.length > 0) return stored;
  if (row.scheduled_at && row.target_account && !row.posted_at) {
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

export function rowHasActiveScheduledPublish(row) {
  return normalizeScheduledPosts(row).some((post) => post.publishingAt && !post.postedAt);
}

export function getDueScheduledPosts(row, now) {
  if (rowHasActiveScheduledPublish(row)) return [];
  return normalizeScheduledPosts(row).filter(
    (post) => post.scheduledAt <= now && !post.postedAt && !post.publishingAt,
  );
}

/** Earliest due post per content row — avoids concurrent claims on the same row. */
export function collectDueScheduledItems(rows, now) {
  const dueItems = [];
  for (const row of rows) {
    if (!row.video_url && !(Array.isArray(row.media_urls) && row.media_urls.length > 0)) continue;
    const due = getDueScheduledPosts(row, now);
    if (due.length > 0) {
      dueItems.push({ row, post: due[0] });
    }
  }
  return dueItems.sort((a, b) => a.post.scheduledAt - b.post.scheduledAt);
}
