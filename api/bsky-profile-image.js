import { pushProfileImageToBsky } from '../server/bskyProfilePush.js';

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({
      error: 'Invalid request body. For large images, pass imageUrl instead of imageBase64.',
    });
  }

  try {
    const {
      identifier,
      password,
      service,
      proxy,
      imageUrl,
      imageBase64,
      mimeType,
      field,
    } = body;

    await pushProfileImageToBsky({
      identifier,
      password,
      service,
      proxy,
      imageUrl,
      imageBase64,
      mimeType,
      field,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    const message = err?.message || 'Bluesky profile push failed';
    const status = /too large/i.test(message) ? 413 : 502;
    res.status(status).json({ error: message });
  }
}
