import { isSupabaseConfigured, supabase } from './supabase';

const BUCKET = 'media';

export function imgKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

/**
 * Downloads an Instagram image (via the server proxy) and stores it in Supabase
 * Storage at a deterministic path, returning a stable public URL. Re-uploading the
 * same path overwrites it, so storage does not grow with every refresh.
 *
 * Falls back to the original URL when Supabase is not configured or anything fails.
 */
export async function cacheImage(
  sourceUrl: string | undefined,
  path: string,
): Promise<string | undefined> {
  if (!sourceUrl) return undefined;
  if (!isSupabaseConfigured || !supabase) return sourceUrl;

  try {
    const response = await fetch(`/api/image?url=${encodeURIComponent(sourceUrl)}`);
    if (!response.ok) return sourceUrl;

    const blob = await response.blob();
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
      upsert: true,
      contentType: blob.type || 'image/jpeg',
      cacheControl: '604800',
    });
    if (error) return sourceUrl;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl || sourceUrl;
  } catch {
    return sourceUrl;
  }
}
