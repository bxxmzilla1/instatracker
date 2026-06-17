import { AtpAgent } from '@atproto/api';
import { makeRelayFetch } from './bskyRelayFetch.js';

async function loadImageBytes({ imageUrl, imageBase64, mimeType }) {
  if (imageUrl) {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error('Could not fetch image.');
    const type = res.headers.get('content-type')?.split(';')[0]?.trim() || mimeType || 'image/jpeg';
    return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: type };
  }
  if (imageBase64) {
    const bytes = new Uint8Array(Buffer.from(imageBase64, 'base64'));
    if (!bytes.length) throw new Error('Image data is empty.');
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

  await agent.login({ identifier: identifier.trim(), password: password.trim() });
  const { data } = await agent.uploadBlob(bytes, { encoding: type });
  await agent.upsertProfile((existing) => {
    const profile = { ...(existing ?? {}) };
    profile[field] = data.blob;
    return profile;
  });
}
