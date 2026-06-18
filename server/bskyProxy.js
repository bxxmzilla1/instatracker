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
 * Request/response bodies use base64 when bodyEncoding is set (binary-safe).
 */
export async function relayThroughProxy({
  url,
  method = 'GET',
  headers = {},
  body = null,
  bodyEncoding,
  proxy,
}) {
  if (!url || !/^https:\/\//i.test(url)) throw new Error('Only https targets are allowed.');
  if (!proxy) throw new Error('Missing proxy configuration.');

  const agent = buildAgent(proxy);
  const target = new URL(url);

  const outHeaders = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    outHeaders[k] = v;
  }
  // Force an uncompressed response so we can hand the body back reliably.
  outHeaders['accept-encoding'] = 'identity';

  return await new Promise((resolve, reject) => {
    const req = https.request(
      target,
      { method, headers: outHeaders, agent, timeout: 90000 },
      (resp) => {
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          const buf = Buffer.concat(chunks);
          const contentType = resp.headers['content-type'] || '';
          const isText =
            !contentType ||
            contentType.includes('json') ||
            contentType.startsWith('text/');
          resolve({
            status: resp.statusCode || 502,
            headers: { 'content-type': contentType || 'application/json' },
            body: isText ? buf.toString('utf8') : buf.toString('base64'),
            bodyEncoding: isText ? 'text' : 'base64',
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Proxy request timed out.')));
    req.on('error', (err) => {
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
      if (code === 'ECONNRESET') {
        reject(new Error('Proxy connection was reset — try again or switch proxy.'));
        return;
      }
      if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
        reject(new Error('Proxy request timed out.'));
        return;
      }
      reject(err);
    });
    if (body) {
      const payload = bodyEncoding === 'base64' ? Buffer.from(body, 'base64') : body;
      req.write(payload);
    }
    req.end();
  });
}
