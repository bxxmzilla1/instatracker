// Publishes due scheduled content via Supabase + Instagram Graph API.
// Intended to run from a Vercel cron job (works even when no browser is open).

import { createClient } from '@supabase/supabase-js';
import { publishContent } from './publish.js';

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
}

async function claimItem(db, id) {
  const { data, error } = await db
    .from('content')
    .update({ publishing_at: Date.now(), publish_stage: 'creating', post_error: null })
    .eq('id', id)
    .is('publishing_at', null)
    .is('posted_at', null)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function setPublishStage(db, id, stage) {
  await db.from('content').update({ publish_stage: stage }).eq('id', id);
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

async function markPosted(db, row, result) {
  const postedAt = Date.now();
  const history = Array.isArray(row.post_history) ? row.post_history : [];
  const { error } = await db
    .from('content')
    .update({
      posted_at: postedAt,
      permalink: result.permalink ?? null,
      post_error: null,
      publishing_at: null,
      publish_stage: null,
      post_history: [
        ...history,
        {
          account: row.target_account,
          postedAt,
          permalink: result.permalink,
        },
      ],
    })
    .eq('id', row.id);
  if (error) throw new Error(error.message);
}

async function markFailed(db, id, message) {
  await db
    .from('content')
    .update({
      post_error: message,
      publishing_at: null,
      publish_stage: null,
    })
    .eq('id', id);
}

export async function runScheduledPublisher({ limit = 3 } = {}) {
  const db = getSupabaseAdmin();
  if (!db) {
    return { ok: false, error: 'Supabase service role not configured', processed: 0 };
  }

  await clearStaleLocks(db);

  const now = Date.now();
  const { data: due, error } = await db
    .from('content')
    .select('*')
    .not('scheduled_at', 'is', null)
    .lte('scheduled_at', now)
    .is('posted_at', null)
    .is('publishing_at', null)
    .not('target_account', 'is', null)
    .not('video_url', 'is', null)
    .order('scheduled_at', { ascending: true })
    .limit(limit);

  if (error) {
    return { ok: false, error: error.message, processed: 0 };
  }

  let processed = 0;
  const results = [];

  for (const row of due ?? []) {
    const claimed = await claimItem(db, row.id);
    if (!claimed) continue;

    try {
      const { igUserId, igAccessToken } = await getAccountCredentials(db, row.target_account);
      const result = await publishContent(
        igUserId,
        igAccessToken,
        {
          mediaType: row.media_type === 'image' ? 'image' : 'reel',
          mediaUrls: [row.video_url],
          caption: row.caption ?? '',
        },
        async (progress) => {
          if (progress.stage && progress.stage !== 'done') {
            await setPublishStage(db, row.id, progress.stage);
          }
        },
      );
      await markPosted(db, row, result);
      processed += 1;
      results.push({ id: row.id, ok: true, permalink: result.permalink });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Publish failed';
      await markFailed(db, row.id, message);
      results.push({ id: row.id, ok: false, error: message });
    }
  }

  return { ok: true, processed, results };
}
