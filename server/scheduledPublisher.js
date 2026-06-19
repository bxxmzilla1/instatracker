// Publishes due scheduled content via Supabase + Instagram Graph API.
// Intended to run from a Vercel cron job (works even when no browser is open).

import { createClient } from '@supabase/supabase-js';
import {
  anyActiveScheduledPublish,
  backfillScheduledPostCaptions,
  collectDueScheduledItems,
  normalizeScheduledPosts,
  resolvePublishCaption,
  trimCaption,
} from './contentSchedule.js';
import { publishContent, proxyRowToRelay } from './publish.js';
import { lookupExitIp } from './ipinfo.js';
import { isAccessTokenError } from './instagramErrors.js';
import { skipScheduledPost, upsertTokenUpdateNote } from './accountNotes.js';

const STALE_PUBLISH_MS = 15 * 60 * 1000;
const LOCK_KEY = 'scheduled-publisher';
const LOCK_TTL_MS = 10 * 60 * 1000;
const PUBLISH_GAP_MS = 4000;
const RUN_BUDGET_MS = 280_000;
const WAIT_FOR_PUBLISH_MS = 3000;

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
  const allRows = await loadRowsWithSchedules(db);
  for (const row of allRows) {
    if (row.publishing_at && !row.posted_at && row.id !== rowId) return null;
    for (const post of normalizeScheduledPosts(row)) {
      if (post.publishingAt && !post.postedAt && !(row.id === rowId && post.id === postId)) {
        return null;
      }
    }
  }

  const { data: row, error } = await db.from('content').select('*').eq('id', rowId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;

  const posts = normalizeScheduledPosts(row);
  const idx = posts.findIndex((post) => post.id === postId);
  if (idx < 0) return null;

  const current = posts[idx];
  if (current.publishingAt || current.postedAt) return null;
  if (posts.some((post) => post.id !== postId && post.publishingAt && !post.postedAt)) return null;

  const resolvedCaption = resolvePublishCaption(current, row);
  const postsWithCaption = backfillScheduledPostCaptions(posts, resolvedCaption || row.caption || '');

  const updated = postsWithCaption.map((post, i) =>
    i === idx
      ? {
          ...post,
          caption: resolvedCaption || trimCaption(post.caption) || undefined,
          publishingAt: Date.now(),
          publishStage: 'creating',
          postError: undefined,
        }
      : post,
  );

  const { data, error: updateError } = await db
    .from('content')
    .update({
      scheduled_posts: updated,
      scheduled_at: null,
      target_account: null,
      post_error: null,
      publishing_at: Date.now(),
      publish_stage: 'creating',
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

async function markScheduledPosted(db, rowId, postId, result, ipInfo, publishedCaption) {
  const { data: row, error } = await db.from('content').select('*').eq('id', rowId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return;

  const posts = normalizeScheduledPosts(row);
  const post = posts.find((entry) => entry.id === postId);
  if (!post) return;

  const publishedIp = ipInfo?.ip || undefined;
  const publishedIpCountry = ipInfo ? ipInfo.countryName || ipInfo.country || undefined : undefined;

  const postedAt = Date.now();
  const updated = posts.map((entry) =>
    entry.id === postId
      ? {
          ...entry,
          postedAt,
          permalink: result.permalink,
          publishedIp,
          publishedIpCountry,
          publishedCaption: publishedCaption || undefined,
          publishingAt: undefined,
          publishStage: undefined,
          postError: undefined,
        }
      : entry,
  );
  const hasPending = updated.some((entry) => !entry.postedAt);
  const history = Array.isArray(row.post_history) ? row.post_history : [];
  const payload = {
    scheduled_posts: updated,
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
        publishedIp,
        publishedIpCountry,
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
  const stillPublishing = updated.some((post) => post.publishingAt && !post.postedAt);
  await db
    .from('content')
    .update({
      scheduled_posts: updated,
      post_error: message,
      publishing_at: stillPublishing ? row.publishing_at : null,
      publish_stage: stillPublishing ? row.publish_stage : null,
    })
    .eq('id', rowId);
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

export async function runScheduledPublisher() {
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

    let processed = 0;
    const results = [];
    const deadline = Date.now() + RUN_BUDGET_MS;
    let staleClaims = 0;

    while (Date.now() < deadline) {
      await extendPublisherLock(db, lockHolder);

      let rows;
      try {
        rows = await loadRowsWithSchedules(db);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not load scheduled content';
        return { ok: false, error: message, processed };
      }

      const dueItems = collectDueScheduledItems(rows, Date.now());
      if (dueItems.length === 0) {
        if (anyActiveScheduledPublish(rows)) {
          await sleep(WAIT_FOR_PUBLISH_MS);
          continue;
        }
        break;
      }

      if (anyActiveScheduledPublish(rows)) {
        await sleep(WAIT_FOR_PUBLISH_MS);
        continue;
      }

      let claimed = null;
      for (const item of dueItems) {
        claimed = await claimScheduledPost(db, item.row.id, item.post.id);
        if (claimed) break;
      }

      if (!claimed) {
        if (anyActiveScheduledPublish(rows)) {
          await sleep(WAIT_FOR_PUBLISH_MS);
          continue;
        }
        staleClaims += 1;
        if (staleClaims >= 5) break;
        await sleep(500);
        continue;
      }
      staleClaims = 0;

      const { row: claimedRow, post: claimedPost } = claimed;

      try {
        const { igUserId, igAccessToken } = await getAccountCredentials(db, claimedPost.account);
        const mediaUrls =
          Array.isArray(claimedRow.media_urls) && claimedRow.media_urls.length > 0
            ? claimedRow.media_urls
            : [claimedRow.video_url];
        const proxyId = claimedPost.proxyId ?? claimedRow.proxy_id;
        const proxy = await getProxyRelay(db, proxyId);
        // Capture the exit IP this post is published through (best-effort).
        let ipInfo;
        try {
          ipInfo = await lookupExitIp(proxy);
        } catch {
          ipInfo = undefined;
        }
        const caption = trimCaption(claimedPost.caption) || resolvePublishCaption(claimedPost, claimedRow);
        console.log(
          `[publisher] publishing ${claimedRow.id}/${claimedPost.id} to @${claimedPost.account} ` +
            `proxy=${proxyId || 'none'} captionLen=${caption.length} caption="${caption.slice(0, 60)}"`,
        );

        const result = await publishContent(
          igUserId,
          igAccessToken,
          {
            mediaType: claimedRow.media_type ?? 'reel',
            mediaUrls,
            caption,
            proxy,
          },
          async (progress) => {
            if (progress.stage && progress.stage !== 'done') {
              await setScheduledPostStage(db, claimedRow.id, claimedPost.id, progress.stage);
            }
          },
        );
        await markScheduledPosted(db, claimedRow.id, claimedPost.id, result, ipInfo, caption);
        processed += 1;
        results.push({
          id: claimedRow.id,
          scheduledPostId: claimedPost.id,
          ok: true,
          permalink: result.permalink,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Publish failed';
        if (isAccessTokenError(message)) {
          const account = await skipScheduledPost(db, claimedRow.id, claimedPost.id);
          if (account) await upsertTokenUpdateNote(db, account);
        } else {
          await markScheduledFailed(db, claimedRow.id, claimedPost.id, message);
        }
        results.push({
          id: claimedRow.id,
          scheduledPostId: claimedPost.id,
          ok: false,
          error: message,
        });
      }

      if (Date.now() < deadline) {
        await sleep(PUBLISH_GAP_MS);
      }
    }

    return { ok: true, processed, results };
  } finally {
    await releasePublisherLock(db, lockHolder);
  }
}
