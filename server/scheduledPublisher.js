// Publishes due scheduled content via Supabase + Instagram Graph API.
// Intended to run from a Vercel cron job (works even when no browser is open).

import { createClient } from '@supabase/supabase-js';
import { collectDueScheduledItems, normalizeScheduledPosts } from './contentSchedule.js';
import { publishContent, proxyRowToRelay } from './publish.js';

const STALE_PUBLISH_MS = 15 * 60 * 1000;
const LOCK_KEY = 'scheduled-publisher';
const LOCK_TTL_MS = 5 * 60 * 1000;
const PUBLISH_GAP_MS = 4000;
const DEFAULT_BATCH_LIMIT = 25;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function clearStaleLocks(db) {
  const staleBefore = Date.now() - STALE_PUBLISH_MS;

  await db
    .from('content')
    .update({ publishing_at: null, publish_stage: null })
    .lt('publishing_at', staleBefore)
    .is('posted_at', null);

  const { data: rows, error } = await db
    .from('content')
    .select('*')
    .not('scheduled_posts', 'eq', '[]');
  if (error) throw new Error(error.message);

  for (const row of rows ?? []) {
    const posts = normalizeScheduledPosts(row);
    let changed = false;
    const updated = posts.map((post) => {
      if (post.publishingAt && post.publishingAt < staleBefore && !post.postedAt) {
        changed = true;
        return { ...post, publishingAt: undefined, publishStage: undefined };
      }
      return post;
    });
    if (changed) {
      await db.from('content').update({ scheduled_posts: updated }).eq('id', row.id);
    }
  }
}

async function acquirePublisherLock(db) {
  const now = Date.now();
  const holder = `${now}-${Math.random().toString(36).slice(2)}`;
  const expiresAt = now + LOCK_TTL_MS;

  try {
    await db.from('app_locks').delete().eq('key', LOCK_KEY).lt('expires_at', now);

    const { error } = await db.from('app_locks').insert({
      key: LOCK_KEY,
      holder,
      expires_at: expiresAt,
    });

    if (error) {
      if (error.code === '23505') return null;
      throw new Error(error.message);
    }

    return holder;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/app_locks/i.test(message)) return 'no-lock-table';
    throw err;
  }
}

async function extendPublisherLock(db, holder) {
  if (holder === 'no-lock-table') return;
  await db
    .from('app_locks')
    .update({ expires_at: Date.now() + LOCK_TTL_MS })
    .eq('key', LOCK_KEY)
    .eq('holder', holder);
}

async function releasePublisherLock(db, holder) {
  if (holder === 'no-lock-table') return;
  await db.from('app_locks').delete().eq('key', LOCK_KEY).eq('holder', holder);
}

async function claimScheduledPost(db, rowId, postId) {
  const { data: row, error } = await db.from('content').select('*').eq('id', rowId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;

  const posts = normalizeScheduledPosts(row);
  const idx = posts.findIndex((post) => post.id === postId);
  if (idx < 0) return null;

  const current = posts[idx];
  if (current.publishingAt || current.postedAt) return null;
  if (posts.some((post) => post.id !== postId && post.publishingAt && !post.postedAt)) return null;

  const updated = posts.map((post, i) =>
    i === idx
      ? { ...post, publishingAt: Date.now(), publishStage: 'creating', postError: undefined }
      : post,
  );

  const { data, error: updateError } = await db
    .from('content')
    .update({
      scheduled_posts: updated,
      scheduled_at: null,
      target_account: null,
      post_error: null,
    })
    .eq('id', rowId)
    .select('*')
    .maybeSingle();
  if (updateError) throw new Error(updateError.message);
  if (!data) return null;

  const claimed = normalizeScheduledPosts(data).find((post) => post.id === postId);
  if (!claimed?.publishingAt || claimed.postedAt) return null;

  return { row: data, post: claimed };
}

async function setScheduledPostStage(db, rowId, postId, stage) {
  const { data: row, error } = await db.from('content').select('*').eq('id', rowId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return;

  const posts = normalizeScheduledPosts(row);
  const updated = posts.map((post) =>
    post.id === postId ? { ...post, publishStage: stage } : post,
  );
  await db.from('content').update({ scheduled_posts: updated }).eq('id', rowId);
}

async function getAccountCredentials(db, username) {
  const { data, error } = await db
    .from('accounts')
    .select('username, ig_user_id, ig_access_token')
    .eq('username', username)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.ig_user_id || !data?.ig_access_token) {
    throw new Error(`Account @${username} has no saved API token / User ID`);
  }
  return { igUserId: data.ig_user_id, igAccessToken: data.ig_access_token };
}

async function markScheduledPosted(db, rowId, postId, result) {
  const { data: row, error } = await db.from('content').select('*').eq('id', rowId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return;

  const posts = normalizeScheduledPosts(row);
  const post = posts.find((entry) => entry.id === postId);
  if (!post) return;

  const remaining = posts.filter((entry) => entry.id !== postId);
  const hasPending = remaining.some((entry) => !entry.postedAt);
  const postedAt = Date.now();
  const history = Array.isArray(row.post_history) ? row.post_history : [];
  const payload = {
    scheduled_posts: remaining,
    scheduled_at: null,
    target_account: null,
    post_error: null,
    publishing_at: null,
    publish_stage: null,
    post_history: [
      ...history,
      {
        account: post.account,
        postedAt,
        permalink: result.permalink,
      },
    ],
  };

  if (!hasPending) {
    payload.posted_at = postedAt;
    payload.permalink = result.permalink ?? null;
  }

  const { error: updateError } = await db.from('content').update(payload).eq('id', rowId);
  if (updateError) throw new Error(updateError.message);
}

async function markScheduledFailed(db, rowId, postId, message) {
  const { data: row, error } = await db.from('content').select('*').eq('id', rowId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return;

  const posts = normalizeScheduledPosts(row);
  const updated = posts.map((post) =>
    post.id === postId
      ? { ...post, postError: message, publishingAt: undefined, publishStage: undefined }
      : post,
  );
  await db.from('content').update({ scheduled_posts: updated, post_error: message }).eq('id', rowId);
}

async function getProxyRelay(db, proxyId) {
  if (!proxyId) return undefined;
  const { data, error } = await db.from('proxies').select('*').eq('id', proxyId).maybeSingle();
  if (error) throw new Error(error.message);
  return proxyRowToRelay(data);
}

async function loadRowsWithSchedules(db) {
  const [legacyRes, queueRes] = await Promise.all([
    db.from('content').select('*').not('scheduled_at', 'is', null),
    db.from('content').select('*').not('scheduled_posts', 'eq', '[]'),
  ]);
  if (legacyRes.error) throw new Error(legacyRes.error.message);
  if (queueRes.error) throw new Error(queueRes.error.message);

  const byId = new Map();
  for (const row of [...(legacyRes.data ?? []), ...(queueRes.data ?? [])]) {
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

export async function runScheduledPublisher({ limit = DEFAULT_BATCH_LIMIT } = {}) {
  const db = getSupabaseAdmin();
  if (!db) {
    return { ok: false, error: 'Supabase service role not configured', processed: 0 };
  }

  const lockHolder = await acquirePublisherLock(db);
  if (!lockHolder) {
    return { ok: true, processed: 0, skipped: 'publisher_busy' };
  }

  try {
    await clearStaleLocks(db);

    const now = Date.now();
    let rows;
    try {
      rows = await loadRowsWithSchedules(db);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load scheduled content';
      return { ok: false, error: message, processed: 0 };
    }

    const dueItems = collectDueScheduledItems(rows, now);

    let processed = 0;
    const results = [];

    const batch = dueItems.slice(0, limit);

    for (let i = 0; i < batch.length; i++) {
      const { row, post } = batch[i];
      await extendPublisherLock(db, lockHolder);

      const claimed = await claimScheduledPost(db, row.id, post.id);
      if (!claimed) continue;

      const { row: claimedRow, post: claimedPost } = claimed;

      try {
        const { igUserId, igAccessToken } = await getAccountCredentials(db, claimedPost.account);
        const mediaUrls =
          Array.isArray(claimedRow.media_urls) && claimedRow.media_urls.length > 0
            ? claimedRow.media_urls
            : [claimedRow.video_url];
        const proxy = await getProxyRelay(db, claimedPost.proxyId ?? claimedRow.proxy_id);
        const result = await publishContent(
          igUserId,
          igAccessToken,
          {
            mediaType: claimedRow.media_type ?? 'reel',
            mediaUrls,
            caption:
              claimedPost.caption ??
              (claimedRow.media_type === 'story' ? '' : (claimedRow.caption ?? '')),
            proxy,
          },
          async (progress) => {
            if (progress.stage && progress.stage !== 'done') {
              await setScheduledPostStage(db, claimedRow.id, claimedPost.id, progress.stage);
            }
          },
        );
        await markScheduledPosted(db, claimedRow.id, claimedPost.id, result);
        processed += 1;
        results.push({
          id: claimedRow.id,
          scheduledPostId: claimedPost.id,
          ok: true,
          permalink: result.permalink,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Publish failed';
        await markScheduledFailed(db, claimedRow.id, claimedPost.id, message);
        results.push({
          id: claimedRow.id,
          scheduledPostId: claimedPost.id,
          ok: false,
          error: message,
        });
      }

      if (i < batch.length - 1) {
        await sleep(PUBLISH_GAP_MS);
      }
    }

    return { ok: true, processed, results };
  } finally {
    await releasePublisherLock(db, lockHolder);
  }
}
