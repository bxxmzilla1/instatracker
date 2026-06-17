// IPinfo helpers used to discover the current exit IP of a proxy (or the
// server itself) and to look up geo details for a known IP.
//
// The API token is read from the IPINFO_TOKEN environment variable (set in
// Vercel). Routing through a proxy reuses the same agent builder as the Graph
// relay so the IP we report is the proxy's real exit IP.

import https from 'https';
import { buildProxyAgent } from './proxyAgent.js';

const LITE_ME = 'https://api.ipinfo.io/lite/me';
const JSON_ENDPOINT = 'https://ipinfo.io/json';
const USER_AGENT = 'DrBossing/1.0';
const TIMEOUT_MS = 20000;

export function getIpInfoToken() {
  return process.env.IPINFO_TOKEN || process.env.VITE_IPINFO_TOKEN || '';
}

export function hasIpInfoToken() {
  return Boolean(getIpInfoToken());
}

function httpsGetJson(url, { agent, headers } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: 'GET', agent, headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(headers || {}) }, timeout: TIMEOUT_MS },
      (resp) => {
        const chunks = [];
        resp.on('data', (chunk) => chunks.push(chunk));
        resp.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data = {};
          try {
            data = text ? JSON.parse(text) : {};
          } catch {
            data = {};
          }
          resolve({ status: resp.statusCode || 0, data });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('IPinfo request timed out.')));
    req.on('error', reject);
    req.end();
  });
}

// Maps the various IPinfo response shapes (lite/me, /json, /lookup) into one.
function normalize(d) {
  if (!d || !d.ip) return null;
  const countryName = typeof d.country === 'string' && d.country.length > 2 ? d.country : undefined;
  const countryCode = d.country_code || (typeof d.country === 'string' && d.country.length <= 3 ? d.country : undefined);
  return {
    ip: d.ip,
    city: d.city || undefined,
    region: d.region || undefined,
    country: countryCode || undefined,
    countryName: countryName || undefined,
    org: d.as_name || d.org || d.asn?.name || undefined,
    hostname: d.hostname || undefined,
  };
}

/**
 * Finds the current exit IP (and basic geo) seen by IPinfo. When a proxy is
 * supplied the request is tunneled through it, so the result is the proxy's
 * live exit IP; otherwise it reflects the server's own IP.
 */
export async function lookupExitIp(proxy) {
  const token = getIpInfoToken();
  const agent = proxy?.host && proxy?.port ? buildProxyAgent(proxy) : undefined;

  if (token) {
    try {
      const { status, data } = await httpsGetJson(LITE_ME, {
        agent,
        headers: { Authorization: `Bearer ${token}` },
      });
      const info = normalize(data);
      if (status < 400 && info) return info;
    } catch {
      // fall through to the classic endpoint
    }
  }

  const url = token ? `${JSON_ENDPOINT}?token=${encodeURIComponent(token)}` : JSON_ENDPOINT;
  const { status, data } = await httpsGetJson(url, { agent });
  const info = normalize(data);
  if (status >= 400 || !info) {
    throw new Error(data?.error?.message || data?.error || `IPinfo lookup failed (${status})`);
  }
  return info;
}

/** Looks up geo details for a known IP address (not routed through a proxy). */
export async function lookupIp(ip) {
  const token = getIpInfoToken();
  const url = `https://api.ipinfo.io/lookup/${encodeURIComponent(ip)}`;
  const { status, data } = await httpsGetJson(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const info = normalize(data);
  if (status >= 400 || !info) {
    throw new Error(data?.error?.message || data?.error || `IPinfo lookup failed (${status})`);
  }
  return info;
}
