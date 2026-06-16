import https from 'https';
import { buildProxyAgent } from './proxyAgent.js';

// Builds a node http(s) agent that tunnels requests through the given proxy.
// Supports HTTP/HTTPS CONNECT proxies and SOCKS4/SOCKS5 proxies.
function buildAgent(proxy) {
  return buildProxyAgent(proxy);
}

const HOP_BY_HOP = new Set(['host', 'content-length', 'accept-encoding', 'connection', 'transfer-encoding']);

/**
 * Relays a single HTTPS request to a Bluesky/AT Protocol endpoint through a proxy.
 * Returns a plain object the browser can rebuild into a Response.
 */
export async function relayThroughProxy({ url, method = 'GET', headers = {}, body = null, proxy }) {
  if (!url || !/^https:\/\//i.test(url)) throw new Error('Only https targets are allowed.');
  if (!proxy) throw new Error('Missing proxy configuration.');

  const agent = buildAgent(proxy);
  const target = new URL(url);

  const outHeaders = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    outHeaders[k] = v;
  }
  // Force an uncompressed response so we can hand the body back as text.
  outHeaders['accept-encoding'] = 'identity';

  return await new Promise((resolve, reject) => {
    const req = https.request(
      target,
      { method, headers: outHeaders, agent, timeout: 45000 },
      (resp) => {
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          resolve({
            status: resp.statusCode || 502,
            headers: { 'content-type': resp.headers['content-type'] || 'application/json' },
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Proxy request timed out.')));
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : Buffer.from(body));
    req.end();
  });
}
