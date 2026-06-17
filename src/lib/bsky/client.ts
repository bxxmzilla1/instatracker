import { AtpAgent } from '@atproto/api';
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

function isTransientPushError(message: string): boolean {
  return /timeout|timed out|econnreset|econnrefused|fetch failed|network|proxy relay failed|502|503|504|socket/i.test(
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

    const relay = await fetch('/api/bsky-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, method, headers, body, bodyEncoding, proxy }),
    });
    if (!relay.ok) {
      const e = (await relay.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error || `Proxy relay failed (${relay.status})`);
    }
    const data = (await relay.json()) as {
      status: number;
      headers: Record<string, string>;
      body: string;
      bodyEncoding?: 'text' | 'base64';
    };
    const responseBody =
      data.bodyEncoding === 'base64' ? base64ToBytes(data.body) : data.body ?? '';
    return new Response(responseBody, { status: data.status, headers: data.headers });
  };
}

export function parseError(err: unknown): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  const e = err as { error?: string; message?: string; cause?: unknown };
  if (e.cause) {
    const inner = parseError(e.cause);
    if (inner && inner !== 'Unknown error') return inner;
  }
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

async function uploadVideoViaBskyService(
  agent: AtpAgent,
  bytes: Uint8Array,
  fileName: string,
  onProgress?: BskyPublishProgressCallback,
  repostAttempt = false,
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
  uploadUrl.searchParams.set('name', fileName);

  onProgress?.('Uploading video…');

  const uploadResponse = await fetch(uploadUrl.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceAuth.token}`,
      'Content-Type': 'video/mp4',
      'Content-Length': String(bytes.length),
    },
    body: bytes,
  });

  const uploadBody = (await uploadResponse.json().catch(() => ({}))) as {
    jobStatus?: {
      jobId?: string;
      blob?: unknown;
      state?: string;
      progress?: number;
      message?: string;
      error?: string;
    };
    message?: string;
    error?: string;
  };

  const uploadJob = uploadBody.jobStatus;
  const duplicate = isDuplicateVideoUpload(uploadResponse.status, uploadJob);

  if (duplicate && !repostAttempt) {
    onProgress?.('Preparing video for repost…');
    const uniqueBytes = uniquifyMp4Bytes(bytes);
    if (uniqueBytes.length > BSKY_VIDEO_MAX_BYTES) {
      throw new Error('Videos must be 100MB or smaller.');
    }
    return uploadVideoViaBskyService(agent, uniqueBytes, fileName, onProgress, true);
  }

  let blob = uploadJob?.blob;
  const jobId = uploadJob?.jobId;

  if (!uploadResponse.ok && !blob && !jobId) {
    throw new Error(
      uploadBody.message ||
        uploadBody.error ||
        uploadJob?.message ||
        `Video upload failed (${uploadResponse.status})`,
    );
  }

  if (blob) return ensureBlobRef(blob);
  if (!jobId) throw new Error('Video upload did not return a job ID.');

  const videoAgent = new AtpAgent({ service: 'https://video.bsky.app' });
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

  if (mediaType === 'image') {
    options.onProgress?.('Compressing image…');
    const prepared = await prepareImageForBskyUpload(options.file);
    options.onProgress?.('Uploading image…');
    const { data } = await agent.uploadBlob(prepared.bytes, { encoding: prepared.mimeType });
    const result = await agent.post({
      text,
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
  const videoBlob = await uploadVideoViaBskyService(agent, bytes, fileName, options.onProgress);
  const aspectRatio = await mediaAspectRatio(options.file, 'video');

  options.onProgress?.('Publishing post…');
  const result = await agent.post({
    text,
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
