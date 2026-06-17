import { AtpAgent } from '@atproto/api';
import { makeRelayFetch } from './bskyRelayFetch.js';

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function parseError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  const e = err;
  if (e.cause) {
    const inner = parseError(e.cause);
    if (inner && inner !== 'Unknown error') return inner;
  }
  if (e.error && e.message) return `${e.error}: ${e.message}`;
  return e.message || String(err);
}

async function loadImageBytes({ imageUrl, imageBase64, mimeType }) {
  if (imageUrl) {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error('Could not fetch image.');
    const type = res.headers.get('content-type')?.split(';')[0]?.trim() || mimeType || 'image/jpeg';
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) throw new Error('Image data is empty.');
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new Error('Image is too large. Use a file under 3 MB.');
    }
    return { bytes, mimeType: type };
  }
  if (imageBase64) {
    const bytes = new Uint8Array(Buffer.from(imageBase64, 'base64'));
    if (!bytes.length) throw new Error('Image data is empty.');
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new Error('Image is too large. Use a file under 3 MB.');
    }
    return { bytes, mimeType: mimeType || 'image/jpeg' };
  }
  throw new Error('Missing imageUrl or imageBase64.');
}

export async function pushProfileImageToBsky({
  identifier,
  password,
  service,
  proxy,
  imageUrl,
  imageBase64,
  mimeType,
  field,
}) {
  if (!identifier?.trim() || !password?.trim()) {
    throw new Error('Missing handle/email or app password.');
  }
  if (field !== 'avatar' && field !== 'banner') {
    throw new Error('Invalid profile image field.');
  }

  const { bytes, mimeType: type } = await loadImageBytes({ imageUrl, imageBase64, mimeType });

  const agent = new AtpAgent({
    service: (service && service.trim()) || 'https://bsky.social',
    ...(proxy ? { fetch: makeRelayFetch(proxy) } : {}),
  });

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
    try {
      await agent.login({ identifier: identifier.trim(), password: password.trim() });
      const { data } = await agent.uploadBlob(bytes, { encoding: type });
      await agent.upsertProfile((existing) => {
        const profile = { ...(existing ?? {}) };
        profile[field] = data.blob;
        return profile;
      });
      return;
    } catch (err) {
      lastErr = err;
      const msg = parseError(err);
      if (!/timeout|timed out|econnreset|fetch failed|502|503|504|socket/i.test(msg) || attempt === 2) {
        break;
      }
    }
  }
  throw new Error(parseError(lastErr));
}
