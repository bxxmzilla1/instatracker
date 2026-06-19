import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

/** Builds an HTTP(S) agent that tunnels requests through the given proxy. */
export function buildProxyAgent(proxy) {
  const type = String(proxy.type || 'http').toLowerCase();
  const host = String(proxy.host || '').trim();
  const port = String(proxy.port || '').trim();
  if (!host || !port) throw new Error('Proxy host/port is missing.');

  const user = proxy.user != null ? String(proxy.user) : '';
  const pass = proxy.pass != null ? String(proxy.pass) : '';
  const auth = user ? `${user}:${pass}` : undefined;

  if (type.startsWith('socks')) {
    const scheme = type === 'socks4' ? 'socks4' : 'socks5';
    return new SocksProxyAgent(`${scheme}://${host}:${port}`, auth ? { auth } : undefined);
  }

  // Pass credentials via the agent auth option (not URL encoding) so special
  // characters in passwords don't break proxy authentication.
  return new HttpsProxyAgent(`http://${host}:${port}`, auth ? { auth } : undefined);
}
