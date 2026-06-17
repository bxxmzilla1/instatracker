import { AtpAgent } from '@atproto/api';

// Browser-side AT Protocol client. Bluesky's XRPC endpoints support CORS, so
// every job runs directly from the browser with its own AtpAgent + session,
// keeping accounts fully isolated and parallel (rate limits are per-account).
//
// When an account has a proxy assigned, requests are routed through a small
// server-side relay (/api/bsky-proxy) that tunnels the HTTPS call through the
// proxy — browsers can't apply per-request proxies to fetch directly.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ProxyConfig {
  type: string;
  host: string;
  port: string;
  user?: string;
  pass?: string;
}

// Returns a WHATWG fetch that relays every request through the given proxy.
// The AT Protocol client invokes fetch with a `Request` object (carrying the
// `authorization` header) and no separate init, so we normalize through a
// Request to capture the method, headers, and body regardless of call shape.
function makeProxyFetch(proxy: ProxyConfig): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input as RequestInfo, init);
    const url = req.url;
    const method = req.method || 'GET';
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const body = method === 'GET' || method === 'HEAD' ? null : await req.text();

    const relay = await fetch('/api/bsky-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, method, headers, body: body || null, proxy }),
    });
    if (!relay.ok) {
      const e = (await relay.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error || `Proxy relay failed (${relay.status})`);
    }
    const data = (await relay.json()) as { status: number; headers: Record<string, string>; body: string };
    return new Response(data.body, { status: data.status, headers: data.headers });
  };
}

export function parseError(err: unknown): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  const e = err as { error?: string; message?: string };
  if (e.error && e.message) return `${e.error}: ${e.message}`;
  return e.message || String(err);
}

interface UserView {
  did: string;
  handle: string;
  displayName: string;
  viewerFollowing: boolean;
}

function userView(p: {
  did: string;
  handle: string;
  displayName?: string;
  viewer?: { following?: string };
}): UserView {
  return {
    did: p.did,
    handle: p.handle,
    displayName: p.displayName || '',
    viewerFollowing: Boolean(p.viewer && p.viewer.following),
  };
}

function cleanTarget(actor: string): string {
  let a = String(actor || '').trim().replace(/^@/, '');
  const m = a.match(/bsky\.app\/profile\/([^/?#]+)/i);
  if (m) a = m[1];
  return a;
}

async function fetchConnections(
  agent: AtpAgent,
  actor: string,
  type: 'followers' | 'following',
  max: number,
): Promise<UserView[]> {
  const limitMax = Math.min(Math.max(Number(max) || 1000, 1), 25000);
  const isFollowers = type === 'followers';
  const key = isFollowers ? 'followers' : 'follows';
  const out: UserView[] = [];
  let cursor: string | undefined;
  do {
    const res = isFollowers
      ? await agent.app.bsky.graph.getFollowers({ actor: cleanTarget(actor), limit: 100, cursor })
      : await agent.app.bsky.graph.getFollows({ actor: cleanTarget(actor), limit: 100, cursor });
    const list = (res.data as Record<string, unknown>)[key] as Parameters<typeof userView>[0][];
    for (const p of list) {
      out.push(userView(p));
      if (out.length >= limitMax) break;
    }
    cursor = res.data.cursor;
  } while (cursor && out.length < limitMax);
  return out;
}

export interface JobConfig {
  identifier: string;
  password: string;
  service?: string;
  target: string;
  type?: 'followers' | 'following';
  proxy?: ProxyConfig;
  maxFollowers?: number;
  delayMode?: 'fixed' | 'random';
  delayMs?: number;
  delayMin?: number;
  delayMax?: number;
  skipExisting?: boolean;
}

export interface JobResult {
  success: number;
  skipped: number;
  failed: number;
  total: number;
  cancelled: boolean;
}

export interface JobProgress extends JobResult {
  done: number;
  status: 'followed' | 'skipped' | 'error';
  label: string;
  message?: string;
}

export interface JobHooks {
  onStatus?: (state: string, text: string) => void;
  onProgress?: (detail: JobProgress) => void;
  shouldCancel?: () => boolean;
}

export interface BskyCredentials {
  identifier: string;
  password: string;
  service?: string;
  proxy?: ProxyConfig;
}

export async function loginBskyAgent(credentials: BskyCredentials): Promise<AtpAgent> {
  const { identifier, password, service, proxy } = credentials;
  if (!identifier?.trim() || !password?.trim()) {
    throw new Error('Missing handle/email or app password.');
  }
  const agent = new AtpAgent({
    service: (service && service.trim()) || 'https://bsky.social',
    ...(proxy ? { fetch: makeProxyFetch(proxy) } : {}),
  });
  await agent.login({ identifier: identifier.trim(), password: password.trim() });
  return agent;
}

async function urlToImageBytes(url: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not fetch image.');
  const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
  return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType };
}

async function blobToImageBytes(file: Blob): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const mimeType = file.type?.split(';')[0]?.trim() || 'image/jpeg';
  return { bytes: new Uint8Array(await file.arrayBuffer()), mimeType };
}

export async function pushProfileBio(
  credentials: BskyCredentials,
  description: string,
): Promise<void> {
  const agent = await loginBskyAgent(credentials);
  await agent.upsertProfile((existing) => {
    const profile = { ...(existing ?? {}) };
    profile.description = description;
    return profile;
  });
}

export async function pushProfileImageFromUrl(
  credentials: BskyCredentials,
  imageUrl: string,
  field: 'avatar' | 'banner',
): Promise<void> {
  const agent = await loginBskyAgent(credentials);
  const { bytes, mimeType } = await urlToImageBytes(imageUrl);
  const { data } = await agent.uploadBlob(bytes, { encoding: mimeType });
  await agent.upsertProfile((existing) => {
    const profile = { ...(existing ?? {}) };
    profile[field] = data.blob;
    return profile;
  });
}

export async function pushProfileImageFromFile(
  credentials: BskyCredentials,
  file: Blob,
  field: 'avatar' | 'banner',
): Promise<void> {
  const agent = await loginBskyAgent(credentials);
  const { bytes, mimeType } = await blobToImageBytes(file);
  const { data } = await agent.uploadBlob(bytes, { encoding: mimeType });
  await agent.upsertProfile((existing) => {
    const profile = { ...(existing ?? {}) };
    profile[field] = data.blob;
    return profile;
  });
}

export async function runAccountJob(
  cfg: JobConfig,
  hooks: JobHooks = {},
): Promise<{ ok: boolean; error?: string; result: JobResult }> {
  const {
    identifier,
    password,
    service,
    target,
    type = 'followers',
    proxy,
    maxFollowers,
    delayMode = 'fixed',
    delayMs,
    delayMin,
    delayMax,
    skipExisting = true,
  } = cfg;
  const onStatus = hooks.onStatus || (() => {});
  const onProgress = hooks.onProgress || (() => {});
  const shouldCancel = hooks.shouldCancel || (() => false);

  const result: JobResult = { success: 0, skipped: 0, failed: 0, total: 0, cancelled: false };

  try {
    if (!identifier || !password) throw new Error('Missing handle/email or app password.');
    if (!target) throw new Error('Missing target profile.');

    onStatus('auth', proxy ? 'Signing in (via proxy)…' : 'Signing in…');
    const agent = await loginBskyAgent({
      identifier,
      password,
      service,
      proxy,
    });

    if (shouldCancel()) {
      result.cancelled = true;
      return { ok: true, result };
    }

    const tgt = cleanTarget(target);
    onStatus('fetch', `Fetching ${type} of @${tgt}…`);
    const users = await fetchConnections(agent, tgt, type, maxFollowers ?? 1000);
    result.total = users.length;

    if (!users.length) {
      onStatus('done', `No ${type} found for @${tgt}.`);
      return { ok: true, result };
    }

    const clamp = (v: number | undefined, d: number) => Math.min(Math.max(Number(v) || d, 0), 60000);
    let lo = clamp(delayMin, 800);
    let hi = clamp(delayMax, 2500);
    if (lo > hi) [lo, hi] = [hi, lo];
    const fixed = clamp(delayMs, 1000);
    const nextDelay = () =>
      delayMode === 'random' ? lo + Math.floor(Math.random() * (hi - lo + 1)) : fixed;

    onStatus(
      'run',
      `Following ${users.length} ${type} (${delayMode === 'random' ? `${lo}-${hi}ms` : `${fixed}ms`})…`,
    );

    for (let i = 0; i < users.length; i++) {
      if (shouldCancel()) {
        result.cancelled = true;
        break;
      }
      const u = users[i];
      const label = u.handle || u.did;

      if (skipExisting && u.viewerFollowing) {
        result.skipped++;
        onProgress({ done: i + 1, status: 'skipped', label, ...result });
        continue;
      }

      try {
        await agent.follow(u.did);
        result.success++;
        onProgress({ done: i + 1, status: 'followed', label, ...result });
      } catch (err) {
        result.failed++;
        const msg = parseError(err);
        onProgress({ done: i + 1, status: 'error', label, message: msg, ...result });
        if (/rate ?limit/i.test(msg)) await sleep(Math.max(nextDelay(), 5000));
      }

      if (i < users.length - 1 && !shouldCancel()) {
        const d = nextDelay();
        if (d > 0) await sleep(d);
      }
    }

    onStatus('done', result.cancelled ? 'Stopped' : 'Done');
    return { ok: true, result };
  } catch (err) {
    const msg = parseError(err);
    onStatus('error', msg);
    return { ok: false, error: msg, result };
  }
}
