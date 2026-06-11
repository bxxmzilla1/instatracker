const ALLOWED_HOST_PATTERNS = [/\.cdninstagram\.com$/i, /\.fbcdn\.net$/i];

export function resolveImageTarget(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    return null;
  }

  if (target.protocol !== 'https:') return null;
  if (!ALLOWED_HOST_PATTERNS.some((pattern) => pattern.test(target.hostname))) return null;

  return target;
}

export async function fetchImage(rawUrl) {
  const target = resolveImageTarget(rawUrl);

  if (!target) {
    const error = new Error('Image URL is missing or from a host that is not allowed.');
    error.statusCode = 400;
    throw error;
  }

  const response = await fetch(target.toString(), {
    headers: {
      referer: 'https://www.instagram.com/',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    const error = new Error(`Image fetch failed (${response.status})`);
    error.statusCode = response.status;
    throw error;
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await response.arrayBuffer());

  return { contentType, buffer };
}
