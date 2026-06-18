import { processWarmupQueue } from '../../server/warmupWorker.js';

export const maxDuration = 300;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const result = await processWarmupQueue();
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Warm-up cron failed' });
  }
}
