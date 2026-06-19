/** Parse proxy strings (mirrors src/lib/proxy.ts for server-side use). */
export function parseProxyString(raw) {
  let s = String(raw || '').trim().replace(/^\uFEFF/, '');
  s = s.replace(/^[|>\s]+/u, '').replace(/[|>\s]+$/u, '').trim();
  if (!s) return null;

  let type = 'http';
  let rest = s;

  const protoMatch = s.match(/^(socks5|socks4|https?):\/\//i);
  if (protoMatch) {
    type = protoMatch[1].toLowerCase();
    rest = s.slice(protoMatch[0].length);
  }

  const atMatch = rest.match(/^([^:@]+):([^@]+)@([^:]+):(\d+)$/);
  if (atMatch) {
    return { type, user: atMatch[1], pass: atMatch[2], host: atMatch[3], port: atMatch[4] };
  }

  const parts = rest.split(':');
  if (parts.length >= 4) {
    const port = parts[1];
    if (!/^\d+$/.test(port)) return null;
    return {
      type,
      host: parts[0],
      port,
      user: parts[2],
      pass: parts.slice(3).join(':'),
    };
  }
  if (parts.length === 2) {
    return { type, host: parts[0], port: parts[1], user: '', pass: '' };
  }

  return null;
}

/** Merge DB proxy row fields with any credentials embedded in `raw`. */
export function proxyRowToRelay(row) {
  if (!row) return undefined;
  const parsed = parseProxyString(row.raw || '');
  const host = row.host || parsed?.host;
  const port = row.port || parsed?.port;
  if (!host || !port) return undefined;

  const user = row.username || parsed?.user || undefined;
  const pass = row.password ?? parsed?.pass ?? undefined;

  return {
    type: row.type || parsed?.type || 'http',
    host,
    port: String(port),
    user: user || undefined,
    pass: pass || undefined,
  };
}
