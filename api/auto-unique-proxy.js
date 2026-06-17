import { getSupabaseAdmin, collectUsedIps, findUniqueProxy } from '../server/autoUnique.js';

export const maxDuration = 60;

// Performs ONE pass over the saved proxies: rotates each, checks its refreshed
// exit IP, and returns the first proxy with an IP that has never been used.
// The browser repeats the call (waiting between attempts) until one is found.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { proxies: bodyProxies, usedIps: bodyUsedIps } = req.body ?? {};
    const db = getSupabaseAdmin();

    let proxyRows = Array.isArray(bodyProxies) ? bodyProxies : [];
    if (proxyRows.length === 0 && db) {
      const { data } = await db.from('proxies').select('*').order('created_at', { ascending: true });
      proxyRows = data ?? [];
    }

    const used = new Set(Array.isArray(bodyUsedIps) ? bodyUsedIps : []);
    for (const ip of await collectUsedIps(db)) used.add(ip);

    const result = await findUniqueProxy(proxyRows, used);
    if (!result.relay) {
      return res.status(200).json({ proxy: null, checked: result.checked ?? [] });
    }
    res.status(200).json({
      proxy: result.relay,
      ip: result.ip,
      ipInfo: result.ipInfo,
      proxyId: result.proxyId,
      checked: result.checked ?? [],
    });
  } catch (err) {
    res.status(502).json({ error: err?.message || 'Auto Unique lookup failed' });
  }
}
