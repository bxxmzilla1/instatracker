import { relayThroughProxy } from '../server/bskyProxy.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const data = await relayThroughProxy(req.body ?? {});
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
