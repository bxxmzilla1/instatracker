import type { ProxyIpInfo } from '../types';
import type { GraphRelayProxy } from './proxyRelay';

export interface IpLookupResult extends ProxyIpInfo {
  checkedAt?: number;
}

/**
 * Asks the server for the current exit IP of a proxy (routed through it). When
 * no proxy is given, returns the server's own exit IP. The IPinfo token lives
 * server-side (IPINFO_TOKEN), so it is never exposed to the browser.
 */
export async function fetchProxyIp(proxy?: GraphRelayProxy): Promise<IpLookupResult> {
  const res = await fetch('/api/proxy-ip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proxy }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data as { error?: string }).error) {
    throw new Error((data as { error?: string }).error || `IP lookup failed (${res.status})`);
  }
  return data as IpLookupResult;
}

/** A proxy candidate sent to the Auto Unique resolver (DB row shape). */
export interface AutoUniqueProxyInput {
  id?: string;
  type?: string;
  host: string;
  port: string;
  username?: string;
  password?: string;
  rotating_link?: string;
}

export interface AutoUniqueResult {
  proxy: GraphRelayProxy | null;
  ip?: string;
  ipInfo?: ProxyIpInfo;
  proxyId?: string;
  checked?: string[];
}

/**
 * Runs ONE pass of the Auto Unique resolver on the server: rotates each proxy,
 * checks its refreshed IP, and returns the first proxy whose IP is brand new.
 * Returns `{ proxy: null }` when no unused IP was found this pass.
 */
export async function fetchAutoUniqueProxy(
  proxies: AutoUniqueProxyInput[],
  usedIps: string[],
): Promise<AutoUniqueResult> {
  const res = await fetch('/api/auto-unique-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proxies, usedIps }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data as { error?: string }).error) {
    throw new Error((data as { error?: string }).error || `Auto Unique failed (${res.status})`);
  }
  return data as AutoUniqueResult;
}

/** Compact "1.2.3.4 · City, Country" label for an IP info object. */
export function formatIpInfo(info?: {
  ip?: string;
  city?: string;
  country?: string;
  countryName?: string;
}): string {
  if (!info?.ip) return '';
  const place = [info.city, info.countryName || info.country].filter(Boolean).join(', ');
  return place ? `${info.ip} · ${place}` : info.ip;
}
