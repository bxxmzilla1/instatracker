import { fetchInstagramStories } from '../server/instagram.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { username } = req.body ?? {};

    if (!username?.trim()) {
      return res.status(400).json({ error: 'username is required' });
    }

    const data = await fetchInstagramStories(username);
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
