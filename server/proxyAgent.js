import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

function proxyAgentUrl(proxy) {
  const type = String(proxy.type || 'http').toLowerCase();
  const host = String(proxy.host || '').trim();
  const port = String(proxy.port || '').trim();
  if (!host || !port) throw new Error('Proxy host/port is missing.');

  const user = proxy.user != null ? String(proxy.user) : '';
  const pass = proxy.pass != null ? String(proxy.pass) : '';

  const scheme = type.startsWith('socks') ? (type === 'socks4' ? 'socks4' : 'socks5') : 'http';
  const url = new URL(`${scheme}://${host}:${port}`);
  if (user) {
    url.username = user;
    url.password = pass;
  }
  return url;
}

/** Builds an HTTP(S) agent that tunnels requests through the given proxy. */
export function buildProxyAgent(proxy) {
  const type = String(proxy.type || 'http').toLowerCase();
  const url = proxyAgentUrl(proxy);

  // Both agents read credentials from the proxy URL (username/password fields),
  // not from a separate auth option.
  if (type.startsWith('socks')) {
    return new SocksProxyAgent(url);
  }
  return new HttpsProxyAgent(url);
}
