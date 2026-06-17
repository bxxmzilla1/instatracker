import { lookupExitIp, lookupIp } from '../server/ipinfo.js';

export const maxDuration = 30;

// Returns the current exit IP (and geo) for a given proxy, or geo for a known
// IP. The IPinfo token is read server-side from IPINFO_TOKEN.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { proxy, ip } = req.body ?? {};
    const info = ip ? await lookupIp(ip) : await lookupExitIp(proxy);
    res.status(200).json({ ...info, checkedAt: Date.now() });
  } catch (err) {
    res.status(502).json({ error: err?.message || 'IP lookup failed' });
  }
}
