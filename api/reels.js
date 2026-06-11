import { callInstagram, normalizeUsername } from '../server/instagram.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { username, maxId } = req.body ?? {};

    if (!username?.trim()) {
      return res.status(400).json({ error: 'username is required' });
    }

    const body = { username: normalizeUsername(username) };
    if (maxId) body.maxId = maxId;

    const data = await callInstagram('/api/instagram/reels', body);
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
