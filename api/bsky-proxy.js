import { relayThroughProxy } from '../server/bskyProxy.js';

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const data = await relayThroughProxy(req.body ?? {});
    res.status(200).json(data);
  } catch (err) {
    const message = err?.message || 'Proxy relay failed';
    res.status(502).json({ error: message });
  }
}
