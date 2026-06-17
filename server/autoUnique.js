// "Auto Unique" proxy selection.
//
// Rotates each saved proxy's rotating link one-by-one, checks the refreshed
// exit IP via IPinfo, and returns the first proxy whose IP has never been used
// for a post before. The set of "used" IPs is gathered from a dedicated
// posted_ips registry plus any publishedIp recorded in content history.

import { createClient } from '@supabase/supabase-js';
import { lookupExitIp } from './ipinfo.js';

export const AUTO_UNIQUE_PROXY_ID = '__auto_unique__';

const ROTATE_REQUEST_TIMEOUT_MS = 15000;
const ROTATE_SETTLE_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function rowToRelay(row) {
  const host = row?.host;
  const port = row?.port;
  if (!host || !port) return undefined;
  return {
    type: row.type || 'http',
    host: String(host),
    port: String(port),
    user: row.username || row.user || undefined,
    pass: row.password || row.pass || undefined,
  };
}

// Triggers the proxy's rotating link so it issues a fresh exit IP.
async function hitRotatingLink(url) {
  if (!url) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ROTATE_REQUEST_TIMEOUT_MS);
  try {
    await fetch(url, { method: 'GET', signal: controller.signal });
  } catch {
    // Rotation triggers are best-effort; some return non-200 or hang.
  } finally {
    clearTimeout(timer);
  }
}

/** All IP addresses already used for a post (registry + content history). */
export async function collectUsedIps(db) {
  const used = new Set();
  if (!db) return used;

  try {
    const { data } = await db.from('posted_ips').select('ip');
    for (const row of data ?? []) {
      if (row?.ip) used.add(row.ip);
    }
  } catch {
    // posted_ips table may not exist yet
  }

  try {
    const { data } = await db.from('content').select('post_history, scheduled_posts');
    for (const row of data ?? []) {
      const history = Array.isArray(row.post_history) ? row.post_history : [];
      for (const entry of history) if (entry?.publishedIp) used.add(entry.publishedIp);
      const scheduled = Array.isArray(row.scheduled_posts) ? row.scheduled_posts : [];
      for (const entry of scheduled) if (entry?.publishedIp) used.add(entry.publishedIp);
    }
  } catch {
    // ignore — registry above is the primary source
  }

  return used;
}

/** Records an IP as used so it is never selected again. */
export async function registerUsedIp(db, ip, account) {
  if (!db || !ip) return;
  try {
    await db
      .from('posted_ips')
      .upsert({ ip, last_account: account ?? null, used_at: Date.now() }, { onConflict: 'ip' });
  } catch {
    // non-fatal — history still records the IP
  }
}

/**
 * Rotates each proxy one-by-one and returns the first that yields a brand-new
 * exit IP. Returns null if none of the proxies produced an unused IP this pass.
 */
export async function findUniqueProxy(proxyRows, usedIps) {
  const checked = [];
  for (const row of proxyRows ?? []) {
    const relay = rowToRelay(row);
    if (!relay) continue;

    const rotatingLink = row.rotating_link || row.rotatingLink;
    if (rotatingLink) {
      await hitRotatingLink(rotatingLink);
      await sleep(ROTATE_SETTLE_MS);
    }

    let info;
    try {
      info = await lookupExitIp(relay);
    } catch {
      continue;
    }
    if (!info?.ip) continue;
    checked.push(info.ip);

    if (!usedIps.has(info.ip)) {
      return { relay, ip: info.ip, ipInfo: info, proxyId: row.id, checked };
    }
  }
  return { relay: null, checked };
}
