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
