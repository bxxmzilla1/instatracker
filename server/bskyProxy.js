import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

// Builds a node http(s) agent that tunnels requests through the given proxy.
// Supports HTTP/HTTPS CONNECT proxies and SOCKS4/SOCKS5 proxies.
function buildAgent(proxy) {
  const type = String(proxy.type || 'http').toLowerCase();
  const host = String(proxy.host || '').trim();
  const port = String(proxy.port || '').trim();
  if (!host || !port) throw new Error('Proxy host/port is missing.');
  const user = proxy.user ? encodeURIComponent(proxy.user) : '';
  const pass = proxy.pass ? encodeURIComponent(proxy.pass) : '';
  const auth = user ? `${user}:${pass}@` : '';
  if (type.startsWith('socks')) {
    const scheme = type === 'socks4' ? 'socks4' : 'socks5';
    return new SocksProxyAgent(`${scheme}://${auth}${host}:${port}`);
  }
  return new HttpsProxyAgent(`http://${auth}${host}:${port}`);
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
