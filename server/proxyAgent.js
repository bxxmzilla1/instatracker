import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

/** Builds an HTTP(S) agent that tunnels requests through the given proxy. */
export function buildProxyAgent(proxy) {
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
