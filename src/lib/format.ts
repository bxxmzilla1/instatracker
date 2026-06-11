export function proxiedImage(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('data:') || url.startsWith('/api/image')) return url;
  // Only Instagram CDN images need the server-side proxy (referrer/expiry).
  if (/cdninstagram\.com|fbcdn\.net/i.test(url)) {
    return `/api/image?url=${encodeURIComponent(url)}`;
  }
  // Already-cached (e.g. Supabase Storage) URLs load directly and fast.
  return url;
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

export function formatDelta(current: number, previous?: number): string | null {
  if (previous === undefined) return null;
  const delta = current - previous;
  if (delta === 0) return '0';
  return delta > 0 ? `+${formatCount(delta)}` : `-${formatCount(Math.abs(delta))}`;
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
