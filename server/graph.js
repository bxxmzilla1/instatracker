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

function requestViaProxy(url, init, proxy) {
  const agent = buildProxyAgent(proxy);
  const target = new URL(url);
  const method = init.method || 'GET';
  const headers = { ...(init.headers || {}) };
  if (init.body != null && headers['Content-Length'] == null) {
    headers['Content-Length'] = Buffer.byteLength(init.body);
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      target,
      { method, headers, agent, timeout: 90000 },
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
    req.on('error', reject);
    req.end(init.body ?? undefined);
  });
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

  const url = new URL(`${base}/${version}${path.startsWith('/') ? path : `/${path}`}`);
  // Meta accepts access_token in the query string; keep it there so proxied
  // requests still authenticate even if a proxy mishandles Authorization.
  url.searchParams.set('access_token', accessToken);

  // Put ALL Graph parameters (caption, media_type, video_url, …) in the query
  // string for every method. This is the relay's original, proven-working
  // behavior. It was changed to send params in a POST body (commit 94c689a),
  // which silently dropped captions on proxied scheduled publishes — Meta's
  // /media endpoint does not reliably read `caption` from a request body. The
  // query string carries every parameter reliably for both proxied and direct
  // requests, so captions publish correctly regardless of proxy.
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }

  const init = {
    method,
    headers: { Authorization: `Bearer ${accessToken}` },
  };

  // Only attach a request body when the caller explicitly provides one.
  if (method !== 'GET' && body != null) {
    if (typeof body === 'string') {
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = body;
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }

  try {
    if (proxy?.host && proxy?.port) {
      return await requestViaProxy(url.toString(), init, proxy);
    }
    const response = await fetch(url.toString(), init);
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } catch (err) {
    return {
      status: 502,
      data: { error: { message: err?.message || 'Graph relay failed', type: 'RelayError', code: 502 } },
    };
  }
}
