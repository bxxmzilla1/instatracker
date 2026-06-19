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
  const parsed = parseProxyString(proxy.raw || '');
  const host = proxy.host || parsed?.host || '';
  const port = proxy.port || parsed?.port || '';
  if (!host || !port) return undefined;

  const user = proxy.username || parsed?.user || undefined;
  const pass = proxy.password || parsed?.pass || undefined;

  return {
    type: proxy.type || parsed?.type || 'http',
    host,
    port,
    user: user || undefined,
    pass: pass || undefined,
  };
}

export function proxyOptionLabel(proxy: Proxy): string {
  const endpoint =
    proxy.host && proxy.port ? `${proxy.host}:${proxy.port}` : proxy.raw || proxy.id;
  const type = (proxy.type || 'http').toUpperCase();
  return proxy.label?.trim() ? `${proxy.label.trim()} · ${type} · ${endpoint}` : `${type} · ${endpoint}`;
}
