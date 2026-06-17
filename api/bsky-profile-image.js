import { pushProfileImageToBsky } from '../../server/bskyProfilePush.js';

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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
    } = req.body ?? {};

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
    res.status(502).json({ error: err?.message || 'Bluesky profile push failed' });
  }
}
