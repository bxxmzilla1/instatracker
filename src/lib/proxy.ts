export interface ParsedProxy {
  type: string;
  host: string;
  port: string;
  user: string;
  pass: string;
}

/**
 * Parses proxy strings in multiple formats (mirrors the Sessions project):
 *   socks5://host:port:user:pass
 *   http://user:pass@host:port
 *   host:port:user:pass  (password may contain ':')
 *   host:port
 */
export function parseProxyString(raw: string): ParsedProxy | null {
  let s = raw.trim().replace(/^\uFEFF/, '');
  s = s.replace(/^[|>\s]+/u, '').replace(/[|>\s]+$/u, '').trim();
  if (!s) return null;

  let type = 'http';
  let rest = s;

  const protoMatch = s.match(/^(socks5|socks4|https?):\/\//i);
  if (protoMatch) {
    type = protoMatch[1].toLowerCase();
    rest = s.slice(protoMatch[0].length);
  }

  // user:pass@host:port
  const atMatch = rest.match(/^([^:@]+):([^@]+)@([^:]+):(\d+)$/);
  if (atMatch) {
    return { type, user: atMatch[1], pass: atMatch[2], host: atMatch[3], port: atMatch[4] };
  }

  // host:port:user:pass  (pass may include ':')
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
