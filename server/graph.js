// Server-side relay for the Instagram Graph API.
//
// Browsers cannot call graph.instagram.com directly (CORS), so the frontend
// posts { method, path, params, body, accessToken, proxy? } here and we forward it,
// attaching the bearer token, then return { status, data }.

import https from 'https';
import { buildProxyAgent } from './proxyAgent.js';

const GRAPH_HOST = 'https://graph.instagram.com';
const FACEBOOK_GRAPH_HOST = 'https://graph.facebook.com';
const DEFAULT_VERSION = 'v23.0';

const ALLOWED_HOSTS = new Set([GRAPH_HOST, FACEBOOK_GRAPH_HOST]);

function proxyErrorMessage(err) {
  const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
  const message = err instanceof Error ? err.message : String(err);
  if (/407|proxy auth|unexpected proxy auth|auth/i.test(message)) {
    return 'Proxy authentication failed. Check the proxy username and password.';
  }
  if (code === 'ECONNRESET') {
    return 'Proxy connection was reset — try again or switch proxy.';
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
    return 'Proxy request timed out.';
  }
  return message || 'Graph proxy request failed';
}

function requestViaProxy(urlString, init, proxy) {
  const agent = buildProxyAgent(proxy);
  const target = new URL(urlString);
  const method = init.method || 'GET';
  const body = init.body != null ? init.body : null;
  const headers = { ...(init.headers || {}) };

  if (body != null) {
    headers['Content-Length'] = String(Buffer.byteLength(body));
  } else if (method !== 'GET' && method !== 'HEAD') {
    headers['Content-Length'] = '0';
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        agent,
        timeout: 90000,
      },
      (resp) => {
        const chunks = [];
        resp.on('data', (chunk) => chunks.push(chunk));
        resp.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data = {};
          try {
            data = text ? JSON.parse(text) : {};
          } catch {
            data = { error: { message: text || 'Invalid JSON from Graph API', type: 'ParseError', code: 502 } };
          }
          resolve({ status: resp.statusCode || 502, data });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Graph proxy request timed out.')));
    req.on('error', (err) => reject(new Error(proxyErrorMessage(err))));
    req.end(body ?? undefined);
  });
}

// `target` is a URLSearchParams (either `url.searchParams` or a standalone
// form body). Both expose `.set`, so callers must pass the params object
// directly — never a URL instance.
function appendQueryParams(target, params) {
  for (const [key, value] of Object.entries(params)) {
    if (value != null) target.set(key, String(value));
  }
}

export async function relayGraphRequest(payload = {}) {
  const {
    method = 'GET',
    path = '',
    params = {},
    body,
    accessToken,
    host = GRAPH_HOST,
    version = DEFAULT_VERSION,
    proxy,
  } = payload;

  if (!accessToken) {
    return { status: 400, data: { error: { message: 'accessToken is required', type: 'BadRequest', code: 400 } } };
  }
  if (!path || typeof path !== 'string') {
    return { status: 400, data: { error: { message: 'path is required', type: 'BadRequest', code: 400 } } };
  }
  const base = ALLOWED_HOSTS.has(host) ? host : GRAPH_HOST;
  const proxied = Boolean(proxy?.host && proxy?.port);

  const url = new URL(`${base}/${version}${path.startsWith('/') ? path : `/${path}`}`);

  const init = {
    method,
    headers: { Authorization: `Bearer ${accessToken}` },
  };

  if (method === 'GET') {
    url.searchParams.set('access_token', accessToken);
    appendQueryParams(url.searchParams, params);
  } else if (body != null) {
    if (typeof body === 'string') {
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = body;
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    url.searchParams.set('access_token', accessToken);
  } else if (proxied) {
    // Proxied POST: keep the URL short (access_token + caption only) and send
    // the full payload in a form body. Scheduled cron publishes use Node
    // https.request through the proxy tunnel; mirroring caption in the query
    // string ensures Meta receives it even if the body is mishandled. Immediate
    // browser posts use fetch() to /api/graph and tolerate longer query strings,
    // but both paths share this split for consistency.
    url.searchParams.set('access_token', accessToken);
    const caption = params.caption != null ? String(params.caption).trim() : '';
    if (caption) url.searchParams.set('caption', caption);

    const form = new URLSearchParams();
    form.set('access_token', accessToken);
    appendQueryParams(form, params);
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = form.toString();
  } else {
    // Direct POST (no proxy): form body — same format Meta documents.
    const form = new URLSearchParams();
    form.set('access_token', accessToken);
    appendQueryParams(form, params);
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = form.toString();
  }

  try {
    if (proxied) {
      return await requestViaProxy(url.toString(), init, proxy);
    }
    const response = await fetch(url.toString(), init);
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } catch (err) {
    return {
      status: 502,
      data: { error: { message: proxyErrorMessage(err), type: 'RelayError', code: 502 } },
    };
  }
}
