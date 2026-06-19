import { relayGraphRequest } from '../server/graph.js';

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { status, data } = await relayGraphRequest(req.body ?? {});
    res.status(status).json(data);
  } catch (err) {
    res.status(502).json({
      error: {
        message: err?.message || 'Graph proxy request failed',
        type: 'RelayError',
        code: 502,
      },
    });
  }
}
