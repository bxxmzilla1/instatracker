import type { Proxy } from '../types';
import { parseProxyString } from './proxy';

export interface GraphRelayProxy {
  type?: string;
  host: string;
  port: string;
  user?: string;
  pass?: string;
}

export function proxyToRelayConfig(proxy: Proxy): GraphRelayProxy | undefined {
  if (proxy.host && proxy.port) {
    return {
      type: proxy.type || 'http',
      host: proxy.host,
      port: proxy.port,
      user: proxy.username || undefined,
      pass: proxy.password || undefined,
    };
  }
  const parsed = parseProxyString(proxy.raw || '');
  if (!parsed?.host || !parsed.port) return undefined;
  return {
    type: proxy.type || 'http',
    host: parsed.host,
    port: parsed.port,
    user: parsed.user || undefined,
    pass: parsed.pass || undefined,
  };
}

export function proxyOptionLabel(proxy: Proxy): string {
  const endpoint =
    proxy.host && proxy.port ? `${proxy.host}:${proxy.port}` : proxy.raw || proxy.id;
  const type = (proxy.type || 'http').toUpperCase();
  return proxy.label?.trim() ? `${proxy.label.trim()} · ${type} · ${endpoint}` : `${type} · ${endpoint}`;
}
