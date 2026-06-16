// Publishes due scheduled content via Supabase + Instagram Graph API.
// Intended to run from a Vercel cron job (works even when no browser is open).

import { createClient } from '@supabase/supabase-js';
import { getDueScheduledPosts, normalizeScheduledPosts } from './contentSchedule.js';
import { publishContent, proxyRowToRelay } from './publish.js';

const STALE_PUBLISH_MS = 15 * 60 * 1000;

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

async function claimScheduledPost(db, row, postId) {
  const posts = normalizeScheduledPosts(row);
  const idx = posts.findIndex((post) => post.id === postId);
  if (idx < 0) return null;

  const current = posts[idx];
  if (current.publishingAt || current.postedAt) return null;

  const updated = posts.map((post, i) =>
    i === idx
      ? { ...post, publishingAt: Date.now(), publishStage: 'creating', postError: undefined }
      : post,
  );

  const { data, error } = await db
    .from('content')
    .update({
      scheduled_posts: updated,
      scheduled_at: null,
      target_account: null,
      post_error: null,
    })
    .eq('id', row.id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const claimed = normalizeScheduledPosts(data).find((post) => post.id === postId);
  return claimed ? { row: data, post: claimed } : null;
}

async function setScheduledPostStage(db, row, postId, stage) {
  const posts = normalizeScheduledPosts(row);
  const updated = posts.map((post) =>
    post.id === postId ? { ...post, publishStage: stage } : post,
  );
  await db.from('content').update({ scheduled_posts: updated }).eq('id', row.id);
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

async function markScheduledPosted(db, row, postId, result) {
  const posts = normalizeScheduledPosts(row);
  const post = posts.find((entry) => entry.id === postId);
  if (!post) return;

  const remaining = posts.filter((entry) => entry.id !== postId);
  const postedAt = Date.now();
  const history = Array.isArray(row.post_history) ? row.post_history : [];
  const { error } = await db
    .from('content')
    .update({
      scheduled_posts: remaining,
      scheduled_at: null,
      target_account: null,
      posted_at: postedAt,
      permalink: result.permalink ?? null,
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
    })
    .eq('id', row.id);
  if (error) throw new Error(error.message);
}

async function markScheduledFailed(db, row, postId, message) {
  const posts = normalizeScheduledPosts(row);
  const updated = posts.map((post) =>
    post.id === postId
      ? { ...post, postError: message, publishingAt: undefined, publishStage: undefined }
      : post,
  );
  await db.from('content').update({ scheduled_posts: updated, post_error: message }).eq('id', row.id);
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

export async function runScheduledPublisher({ limit = 3 } = {}) {
  const db = getSupabaseAdmin();
  if (!db) {
    return { ok: false, error: 'Supabase service role not configured', processed: 0 };
  }

  await clearStaleLocks(db);

  const now = Date.now();
  let rows;
  try {
    rows = await loadRowsWithSchedules(db);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not load scheduled content';
    return { ok: false, error: message, processed: 0 };
  }

  const dueItems = [];
  for (const row of rows) {
    if (!row.video_url && !(Array.isArray(row.media_urls) && row.media_urls.length > 0)) continue;
    for (const post of getDueScheduledPosts(row, now)) {
      dueItems.push({ row, post });
    }
  }
  dueItems.sort((a, b) => a.post.scheduledAt - b.post.scheduledAt);

  let processed = 0;
  const results = [];

  for (const { row, post } of dueItems.slice(0, limit)) {
    const claimed = await claimScheduledPost(db, row, post.id);
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
            await setScheduledPostStage(db, claimedRow, claimedPost.id, progress.stage);
          }
        },
      );
      await markScheduledPosted(db, claimedRow, claimedPost.id, result);
      processed += 1;
      results.push({ id: claimedRow.id, scheduledPostId: claimedPost.id, ok: true, permalink: result.permalink });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Publish failed';
      await markScheduledFailed(db, claimedRow, claimedPost.id, message);
      results.push({ id: claimedRow.id, scheduledPostId: claimedPost.id, ok: false, error: message });
    }
  }

  return { ok: true, processed, results };
}
