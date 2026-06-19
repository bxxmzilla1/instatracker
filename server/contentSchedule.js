/** Helpers for multi-account scheduled posts (mirrors src/lib/contentSchedule.ts). */

function trimCaption(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Copy a shared caption onto pending scheduled posts that are missing one. */
export function backfillScheduledPostCaptions(posts, caption) {
  const fallback = trimCaption(caption);
  if (!fallback) return posts;
  return posts.map((post) => {
    if (post.postedAt || trimCaption(post.caption)) return post;
    return { ...post, caption: fallback };
  });
}

export function resolvePublishCaption(post, row) {
  if (row?.media_type === 'story') return '';
  const fromPost = trimCaption(post?.caption);
  if (fromPost) return fromPost;
  return trimCaption(row?.caption);
}

export function normalizeScheduledPosts(row) {
  const stored = Array.isArray(row.scheduled_posts) ? row.scheduled_posts : [];
  const rowCaption = trimCaption(row?.caption);

  if (stored.length > 0) {
    return stored.map((post) => {
      if (trimCaption(post?.caption) || !rowCaption) return post;
      return { ...post, caption: rowCaption };
    });
  }
  if (row.scheduled_at && row.target_account && !row.posted_at) {
    return [
      {
        id: `${row.id}-legacy`,
        account: row.target_account,
        scheduledAt: row.scheduled_at,
        caption: rowCaption || undefined,
        proxyId: row.proxy_id || undefined,
      },
    ];
  }
  return [];
}

export function rowHasActiveScheduledPublish(row) {
  if (row.publishing_at && !row.posted_at) return true;
  return normalizeScheduledPosts(row).some((post) => post.publishingAt && !post.postedAt);
}

/** True when any content row currently has a scheduled publish in flight. */
export function anyActiveScheduledPublish(rows) {
  return rows.some(rowHasActiveScheduledPublish);
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

export { trimCaption };
