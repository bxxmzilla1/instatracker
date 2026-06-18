import { processWarmupQueueUntilIdle } from '../../server/warmupWorker.js';

export const maxDuration = 300;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = await processWarmupQueueUntilIdle();
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Warm-up process failed' });
  }
}
