import { AtpAgent, RichText } from '@atproto/api';
import { BlobRef } from '@atproto/lexicon';

// Browser-side AT Protocol client. Bluesky's XRPC endpoints support CORS, so
// every job runs directly from the browser with its own AtpAgent + session,
// keeping accounts fully isolated and parallel (rate limits are per-account).
//
// When an account has a proxy assigned, requests are routed through a small
// server-side relay (/api/bsky-proxy) that tunnels the HTTPS call through the
// proxy — browsers can't apply per-request proxies to fetch directly.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Above this size, proxied uploads use the server path (avoids huge JSON to /api/bsky-proxy). */
const PROXY_SERVER_THRESHOLD_BYTES = 2.5 * 1024 * 1024;
const PROFILE_PUSH_MAX_ATTEMPTS = 3;

const PROXY_RELAY_MAX_ATTEMPTS = 3;

function isTransientPushError(message: string): boolean {
  return /timeout|timed out|econnreset|econnrefused|fetch failed|network|proxy relay failed|empty response|invalid json|unexpected end of json|502|503|504|socket/i.test(
    message,
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

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

    let body: string | null = null;
    let bodyEncoding: 'base64' | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (bytes.length > 0) {
        body = bytesToBase64(bytes);
        bodyEncoding = 'base64';
      }
    }

    const relayPayload = { url, method, headers, body, bodyEncoding, proxy };
    let lastError = 'Proxy relay failed.';

    for (let attempt = 1; attempt <= PROXY_RELAY_MAX_ATTEMPTS; attempt++) {
      try {
        const relay = await fetch('/api/bsky-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(relayPayload),
        });

        const raw = await relay.text();
        if (!relay.ok) {
          let errMsg = `Proxy relay failed (${relay.status})`;
          if (raw.trim()) {
            try {
              const e = JSON.parse(raw) as { error?: string };
              if (e.error) errMsg = e.error;
            } catch {
              errMsg = raw.slice(0, 200);
            }
          }
          lastError = errMsg;
          if (attempt < PROXY_RELAY_MAX_ATTEMPTS && isTransientPushError(errMsg)) {
            await sleep(1000 * attempt);
            continue;
          }
          throw new Error(errMsg);
        }

        if (!raw.trim()) {
          lastError = 'Proxy relay returned an empty response.';
          if (attempt < PROXY_RELAY_MAX_ATTEMPTS) {
            await sleep(1000 * attempt);
            continue;
          }
          throw new Error(lastError);
        }

        let data: {
          status: number;
          headers: Record<string, string>;
          body: string;
          bodyEncoding?: 'text' | 'base64';
        };
        try {
          data = JSON.parse(raw);
        } catch {
          lastError = 'Proxy relay returned invalid JSON.';
          if (attempt < PROXY_RELAY_MAX_ATTEMPTS) {
            await sleep(1000 * attempt);
            continue;
          }
          throw new Error(lastError);
        }

        const contentType = (
          data.headers?.['content-type'] ||
          data.headers?.['Content-Type'] ||
          ''
        ).toLowerCase();
        if (
          data.status >= 200 &&
          data.status < 300 &&
          contentType.includes('json') &&
          (data.body == null || data.body === '')
        ) {
          lastError = 'Bluesky returned an empty response through the proxy.';
          if (attempt < PROXY_RELAY_MAX_ATTEMPTS) {
            await sleep(1000 * attempt);
            continue;
          }
          throw new Error(lastError);
        }

        const responseBody =
          data.bodyEncoding === 'base64' ? base64ToBytes(data.body) : data.body ?? '';
        return new Response(responseBody, { status: data.status, headers: data.headers });
      } catch (err) {
        lastError = parseError(err);
        if (attempt < PROXY_RELAY_MAX_ATTEMPTS && isTransientPushError(lastError)) {
          await sleep(1000 * attempt);
          continue;
        }
        throw err instanceof Error ? err : new Error(lastError);
      }
    }

    throw new Error(lastError);
  };
}

export function parseError(err: unknown): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') {
    if (/unexpected end of json input/i.test(err)) {
      return 'Proxy or Bluesky returned an empty response — retry or switch proxy.';
    }
    return err;
  }
  const e = err as { error?: string; message?: string; cause?: unknown };
  if (e.cause) {
    const inner = parseError(e.cause);
    if (inner && inner !== 'Unknown error') return inner;
  }
  const msg = e.error && e.message ? `${e.error}: ${e.message}` : e.message || e.error || String(err);
  if (/unexpected end of json input/i.test(msg)) {
    return 'Proxy or Bluesky returned an empty response — retry or switch proxy.';
  }
  return msg;
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

/**
 * Attempts a real Bluesky login to confirm the handle + password are valid.
 * Throws a friendly error if authentication fails.
 */
export async function verifyBskyLogin(credentials: BskyCredentials): Promise<void> {
  try {
    await loginBskyAgent(credentials);
  } catch (err) {
    const msg = parseError(err);
    if (/invalid|unauthor|auth|password|identifier|token/i.test(msg)) {
      throw new Error('Invalid handle or password. Use an app password from Bluesky settings.');
    }
    throw new Error(msg || 'Could not verify the account credentials.');
  }
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

type ProfileImagePayload =
  | { imageUrl: string }
  | { bytes: Uint8Array; mimeType: string };

async function pushProfileImageViaServer(
  credentials: BskyCredentials,
  payload: ProfileImagePayload,
  field: 'avatar' | 'banner',
): Promise<void> {
  const body: Record<string, unknown> = {
    identifier: credentials.identifier,
    password: credentials.password,
    service: credentials.service,
    proxy: credentials.proxy,
    field,
  };
  if ('imageUrl' in payload) {
    body.imageUrl = payload.imageUrl;
  } else {
    body.imageBase64 = bytesToBase64(payload.bytes);
    body.mimeType = payload.mimeType;
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < PROFILE_PUSH_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(1000 * attempt);
    try {
      const res = await fetch('/api/bsky-profile-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error || `Server push failed (${res.status})`);
      }
      return;
    } catch (err) {
      lastErr = err;
      const msg = parseError(err);
      if (!isTransientPushError(msg) || attempt === PROFILE_PUSH_MAX_ATTEMPTS - 1) break;
    }
  }
  throw new Error(parseError(lastErr));
}

async function pushProfileImageBytes(
  credentials: BskyCredentials,
  bytes: Uint8Array,
  mimeType: string,
  field: 'avatar' | 'banner',
): Promise<void> {
  if (credentials.proxy && bytes.length > PROXY_SERVER_THRESHOLD_BYTES) {
    await pushProfileImageViaServer(credentials, { bytes, mimeType }, field);
    return;
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < PROFILE_PUSH_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(1000 * attempt);
    try {
      const agent = await loginBskyAgent(credentials);
      const { data } = await agent.uploadBlob(bytes, { encoding: mimeType });
      await agent.upsertProfile((existing) => {
        const profile = { ...(existing ?? {}) };
        profile[field] = data.blob;
        return profile;
      });
      return;
    } catch (err) {
      lastErr = err;
      const msg = parseError(err);
      if (!isTransientPushError(msg) || attempt === PROFILE_PUSH_MAX_ATTEMPTS - 1) break;
    }
  }
  throw new Error(parseError(lastErr));
}

export async function pushProfileImageFromUrl(
  credentials: BskyCredentials,
  imageUrl: string,
  field: 'avatar' | 'banner',
): Promise<void> {
  const { bytes, mimeType } = await urlToImageBytes(imageUrl);
  if (credentials.proxy && bytes.length > PROXY_SERVER_THRESHOLD_BYTES) {
    await pushProfileImageViaServer(credentials, { imageUrl }, field);
    return;
  }
  await pushProfileImageBytes(credentials, bytes, mimeType, field);
}

export async function pushProfileImageFromFile(
  credentials: BskyCredentials,
  file: Blob,
  field: 'avatar' | 'banner',
): Promise<void> {
  const { bytes, mimeType } = await blobToImageBytes(file);
  await pushProfileImageBytes(credentials, bytes, mimeType, field);
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

const BSKY_IMAGE_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
const BSKY_IMAGE_SOURCE_MAX_BYTES = 50 * 1024 * 1024;
const BSKY_IMAGE_MAX_DIMENSION = 2000;
const BSKY_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const BSKY_VIDEO_POLL_MS = 1000;
const BSKY_VIDEO_MAX_POLL_ATTEMPTS = 600;

export interface BskyPublishedPost {
  uri: string;
  cid: string;
}

export interface BskyPostEngagement {
  likeCount: number;
  replyCount: number;
  repostCount: number;
}

export type BskyPublishProgressCallback = (message: string) => void;

async function mediaAspectRatio(
  file: Blob,
  mediaType: 'image' | 'video',
): Promise<{ width: number; height: number } | undefined> {
  if (mediaType === 'image') {
    try {
      if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(file);
        const ratio = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return ratio;
      }
      return await new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(undefined);
        };
        img.src = url;
      });
    } catch {
      return undefined;
    }
  }
  try {
    const url = URL.createObjectURL(file);
    const ratio = await new Promise<{ width: number; height: number } | undefined>((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          resolve({ width: video.videoWidth, height: video.videoHeight });
        } else {
          resolve(undefined);
        }
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(undefined);
      };
      video.src = url;
    });
    return ratio;
  } catch {
    return undefined;
  }
}

function mediaTypeFromFile(file: Blob): 'image' | 'video' {
  const mime = file.type?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime.startsWith('video/')) return 'video';
  return 'image';
}

async function prepareImageForBskyUpload(file: Blob): Promise<{
  bytes: Uint8Array;
  mimeType: string;
  aspectRatio: { width: number; height: number };
}> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Not an image file.');
  }
  if (file.size > BSKY_IMAGE_SOURCE_MAX_BYTES) {
    throw new Error('Images must be 50MB or smaller.');
  }

  const bitmap = await createImageBitmap(file);
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  let scale = Math.min(1, BSKY_IMAGE_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));

  const encode = (width: number, height: number, quality: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process image.');
    ctx.drawImage(bitmap, 0, 0, width, height);
    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    });
  };

  try {
    while (scale >= 0.25) {
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      for (let quality = 0.92; quality >= 0.45; quality -= 0.07) {
        const blob = await encode(width, height, quality);
        if (blob && blob.size <= BSKY_IMAGE_UPLOAD_MAX_BYTES) {
          return {
            bytes: new Uint8Array(await blob.arrayBuffer()),
            mimeType: 'image/jpeg',
            aspectRatio: { width, height },
          };
        }
      }
      scale *= 0.75;
    }
  } finally {
    bitmap.close();
  }

  throw new Error('Could not compress image under 2MB. Try a smaller image.');
}

function ensureBlobRef(blob: unknown): BlobRef {
  if (blob instanceof BlobRef) return blob;
  const ref = BlobRef.asBlobRef(blob);
  if (!ref) throw new Error('Invalid video blob reference from Bluesky.');
  return ref;
}

/** Append a unique MP4 free box so Bluesky treats reposts as new uploads. */
function uniquifyMp4Bytes(bytes: Uint8Array): Uint8Array {
  const stamp = new TextEncoder().encode(`drbossing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const boxSize = 8 + stamp.length;
  const freeBox = new Uint8Array(boxSize);
  const view = new DataView(freeBox.buffer);
  view.setUint32(0, boxSize);
  freeBox[4] = 0x66;
  freeBox[5] = 0x72;
  freeBox[6] = 0x65;
  freeBox[7] = 0x65;
  freeBox.set(stamp, 8);
  const out = new Uint8Array(bytes.length + boxSize);
  out.set(bytes);
  out.set(freeBox, bytes.length);
  return out;
}

function blobFromXrpcError(err: unknown): BlobRef | undefined {
  const e = err as {
    body?: { jobStatus?: { blob?: unknown } };
    data?: { jobStatus?: { blob?: unknown } };
  };
  const ref = e.body?.jobStatus?.blob ?? e.data?.jobStatus?.blob;
  return ref ? ensureBlobRef(ref) : undefined;
}

function isDuplicateVideoUpload(
  status: number,
  job?: { error?: string; message?: string },
): boolean {
  return (
    status === 409 ||
    job?.error === 'already_exists' ||
    /already_exists/i.test(job?.error ?? '') ||
    /already processed/i.test(job?.message ?? '')
  );
}

interface VideoUploadJobStatus {
  jobId?: string;
  blob?: unknown;
  state?: string;
  progress?: number;
  message?: string;
  error?: string;
}

/** Bluesky returns JobStatus at the root; some payloads nest it under jobStatus. */
function normalizeVideoUploadResponse(body: unknown): {
  job: VideoUploadJobStatus;
  message?: string;
  error?: string;
} {
  if (!body || typeof body !== 'object') return { job: {} };
  const raw = body as Record<string, unknown>;
  const nested =
    raw.jobStatus && typeof raw.jobStatus === 'object'
      ? (raw.jobStatus as Record<string, unknown>)
      : null;
  const jobSource = nested ?? raw;
  const job: VideoUploadJobStatus = {
    jobId: typeof jobSource.jobId === 'string' ? jobSource.jobId : undefined,
    blob: jobSource.blob,
    state: typeof jobSource.state === 'string' ? jobSource.state : undefined,
    progress: typeof jobSource.progress === 'number' ? jobSource.progress : undefined,
    message: typeof jobSource.message === 'string' ? jobSource.message : undefined,
    error: typeof jobSource.error === 'string' ? jobSource.error : undefined,
  };
  return {
    job,
    message: typeof raw.message === 'string' ? raw.message : undefined,
    error: typeof raw.error === 'string' ? raw.error : undefined,
  };
}

async function uploadVideoViaBskyService(
  agent: AtpAgent,
  bytes: Uint8Array,
  fileName: string,
  onProgress?: BskyPublishProgressCallback,
  repostAttempt = false,
  proxy?: ProxyConfig,
): Promise<BlobRef> {
  const dispatchHost = agent.dispatchUrl?.host ?? new URL(agent.pdsUrl ?? agent.serviceUrl).host;
  const { data: serviceAuth } = await agent.com.atproto.server.getServiceAuth({
    aud: `did:web:${dispatchHost}`,
    lxm: 'com.atproto.repo.uploadBlob',
    exp: Math.floor(Date.now() / 1000) + 60 * 30,
  });

  const did = agent.session?.did;
  if (!did) throw new Error('Not logged in to Bluesky.');

  const uploadUrl = new URL('https://video.bsky.app/xrpc/app.bsky.video.uploadVideo');
  uploadUrl.searchParams.set('did', did);
  // Unique name per attempt so the service doesn't 409 on a name collision.
  const baseName = /\.mp4$/i.test(fileName) ? fileName.replace(/\.mp4$/i, '') : 'video';
  uploadUrl.searchParams.set('name', `${baseName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`);

  onProgress?.('Uploading video…');

  // Video bytes are too large for the JSON proxy relay; upload goes direct to video.bsky.app.
  const uploadResponse = await fetch(uploadUrl.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceAuth.token}`,
      'Content-Type': 'video/mp4',
      'Content-Length': String(bytes.length),
    },
    body: bytes,
  });

  const rawText = await uploadResponse.text();
  let uploadBody: unknown = {};
  if (rawText.trim()) {
    try {
      uploadBody = JSON.parse(rawText);
    } catch {
      throw new Error(
        `Video upload returned invalid JSON (${uploadResponse.status}). Try again or switch proxy.`,
      );
    }
  }

  const { job: uploadJob, message: bodyMessage, error: bodyError } =
    normalizeVideoUploadResponse(uploadBody);
  const duplicate = isDuplicateVideoUpload(uploadResponse.status, uploadJob);

  const blob = uploadJob.blob;
  const jobId = uploadJob.jobId;

  // On "already_exists" (409) the video API returns the existing video's BlobRef
  // (or a jobId we can poll) for reuse — prefer that over forcing a new upload.
  if (blob) return ensureBlobRef(blob);

  // Only re-upload a uniquified copy as a last resort: the service flagged a
  // duplicate but gave us nothing usable (no blob, no jobId) to work with.
  if (duplicate && !jobId && !repostAttempt) {
    onProgress?.('Preparing video for repost…');
    const uniqueBytes = uniquifyMp4Bytes(bytes);
    if (uniqueBytes.length > BSKY_VIDEO_MAX_BYTES) {
      throw new Error('Videos must be 100MB or smaller.');
    }
    return uploadVideoViaBskyService(agent, uniqueBytes, fileName, onProgress, true, proxy);
  }

  if (!jobId) {
    throw new Error(
      bodyMessage ||
        bodyError ||
        uploadJob.message ||
        uploadJob.error ||
        (uploadResponse.ok
          ? `Video upload did not return a job ID (${uploadResponse.status}).`
          : `Video upload failed (${uploadResponse.status}).`),
    );
  }

  const videoAgent = new AtpAgent({
    service: 'https://video.bsky.app',
    ...(proxy ? { fetch: makeProxyFetch(proxy) } : {}),
  });
  for (let attempt = 0; attempt < BSKY_VIDEO_MAX_POLL_ATTEMPTS; attempt++) {
    try {
      const { data: status } = await videoAgent.app.bsky.video.getJobStatus({ jobId });
      const job = status.jobStatus;
      if (job.blob) return ensureBlobRef(job.blob);
      if (
        job.state === 'JOB_STATE_FAILED' &&
        !job.blob &&
        !isDuplicateVideoUpload(409, job)
      ) {
        throw new Error(job.message || job.error || 'Video processing failed.');
      }
      const progress =
        job.progress != null ? `${job.progress}%` : job.state?.replace('JOB_STATE_', '').toLowerCase() ?? '';
      onProgress?.(`Processing video… ${progress}`.trim());
    } catch (err) {
      const blobFromErr = blobFromXrpcError(err);
      if (blobFromErr) return blobFromErr;

      const msg = parseError(err);
      if (/already_exists|already processed/i.test(msg)) {
        try {
          const { data: status } = await videoAgent.app.bsky.video.getJobStatus({ jobId });
          if (status.jobStatus.blob) return ensureBlobRef(status.jobStatus.blob);
        } catch (inner) {
          const innerBlob = blobFromXrpcError(inner);
          if (innerBlob) return innerBlob;
        }
      } else if (!/fetch|network|timeout/i.test(msg)) {
        throw err;
      }
    }
    await sleep(BSKY_VIDEO_POLL_MS);
  }

  throw new Error('Video processing timed out. Try a shorter video.');
}

export async function publishBskyTextPost(
  credentials: BskyCredentials,
  options: {
    text: string;
    onProgress?: BskyPublishProgressCallback;
  },
): Promise<BskyPublishedPost> {
  const text = options.text.trim();
  if (!text) throw new Error('Post text cannot be empty.');
  options.onProgress?.('Publishing post…');
  const agent = await loginBskyAgent(credentials);
  const rt = new RichText({ text });
  await rt.detectFacets(agent);
  const facets = rt.facets;
  const result = await agent.post({
    text: rt.text,
    ...(facets && facets.length ? { facets } : {}),
    createdAt: new Date().toISOString(),
  });
  return { uri: result.uri, cid: result.cid };
}

export async function publishBskyMediaPost(
  credentials: BskyCredentials,
  options: {
    text: string;
    file: Blob;
    mediaType?: 'image' | 'video';
    fileName?: string;
    onProgress?: BskyPublishProgressCallback;
  },
): Promise<BskyPublishedPost> {
  const mediaType = options.mediaType ?? mediaTypeFromFile(options.file);
  const text = options.text.trim();
  const agent = await loginBskyAgent(credentials);

  // Build rich-text facets so hashtags (and links/mentions) render blue and are
  // clickable / appear in their hashtag feed on Bluesky.
  const rt = new RichText({ text });
  await rt.detectFacets(agent);
  const facets = rt.facets;

  if (mediaType === 'image') {
    options.onProgress?.('Compressing image…');
    const prepared = await prepareImageForBskyUpload(options.file);
    options.onProgress?.('Uploading image…');
    const { data } = await agent.uploadBlob(prepared.bytes, { encoding: prepared.mimeType });
    const result = await agent.post({
      text: rt.text,
      ...(facets && facets.length ? { facets } : {}),
      embed: {
        $type: 'app.bsky.embed.images',
        images: [
          {
            alt: text || 'Image',
            image: data.blob,
            aspectRatio: prepared.aspectRatio,
          },
        ],
      },
      createdAt: new Date().toISOString(),
    });
    return { uri: result.uri, cid: result.cid };
  }

  const mimeType = options.file.type?.split(';')[0]?.trim() || 'video/mp4';
  if (!mimeType.includes('mp4')) {
    throw new Error('Videos must be MP4 format.');
  }
  const bytes = new Uint8Array(await options.file.arrayBuffer());
  if (bytes.length > BSKY_VIDEO_MAX_BYTES) {
    throw new Error('Videos must be 100MB or smaller.');
  }

  const fileName =
    options.fileName ||
    (options.file instanceof File && options.file.name ? options.file.name : 'video.mp4');
  const videoBlob = await uploadVideoViaBskyService(
    agent,
    bytes,
    fileName,
    options.onProgress,
    false,
    credentials.proxy,
  );
  const aspectRatio = await mediaAspectRatio(options.file, 'video');

  options.onProgress?.('Publishing post…');
  const result = await agent.post({
    text: rt.text,
    ...(facets && facets.length ? { facets } : {}),
    embed: {
      $type: 'app.bsky.embed.video',
      video: videoBlob,
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(text ? { alt: text } : {}),
    },
    createdAt: new Date().toISOString(),
  });
  return { uri: result.uri, cid: result.cid };
}

export async function getBskyPostEngagement(
  credentials: BskyCredentials,
  uri: string,
): Promise<BskyPostEngagement> {
  const agent = await loginBskyAgent(credentials);
  const res = await agent.app.bsky.feed.getPosts({ uris: [uri] });
  const post = res.data.posts[0];
  if (!post) throw new Error('Post not found on Bluesky.');
  return {
    likeCount: post.likeCount ?? 0,
    replyCount: post.replyCount ?? 0,
    repostCount: post.repostCount ?? 0,
  };
}

/** Deletes a single published post from a Bluesky profile by its AT URI. */
export async function deleteBskyPost(
  credentials: BskyCredentials,
  uri: string,
): Promise<void> {
  const agent = await loginBskyAgent(credentials);
  await agent.deletePost(uri);
}

/** Likes a post and returns the AT URI of the created like record (used to unlike). */
export async function likeBskyPost(
  credentials: BskyCredentials,
  uri: string,
  cid: string,
): Promise<string> {
  const agent = await loginBskyAgent(credentials);
  const { uri: likeUri } = await agent.like(uri, cid);
  return likeUri;
}

/** Removes a like using the like record's AT URI. */
export async function unlikeBskyPost(
  credentials: BskyCredentials,
  likeUri: string,
): Promise<void> {
  const agent = await loginBskyAgent(credentials);
  await agent.deleteLike(likeUri);
}

/** Reposts a post and returns the AT URI of the created repost record (used to un-repost). */
export async function repostBskyPost(
  credentials: BskyCredentials,
  uri: string,
  cid: string,
): Promise<string> {
  const agent = await loginBskyAgent(credentials);
  const { uri: repostUri } = await agent.repost(uri, cid);
  return repostUri;
}

/** Removes a repost using the repost record's AT URI. */
export async function unrepostBskyPost(
  credentials: BskyCredentials,
  repostUri: string,
): Promise<void> {
  const agent = await loginBskyAgent(credentials);
  await agent.deleteRepost(repostUri);
}
