import type { ContentMediaType, ContentReel } from '../types';

export const MIN_CAROUSEL_ITEMS = 2;
export const MAX_CAROUSEL_ITEMS = 10;
export const CONTENT_PAGE_SIZE = 10;

const VIDEO_EXT = /\.(mp4|mov|webm|m4v|mkv|avi)(\?|$)/i;

export function isVideoUrl(url: string): boolean {
  return VIDEO_EXT.test(url);
}

export function getContentMediaUrls(reel: ContentReel): string[] {
  if (reel.mediaUrls?.length) return reel.mediaUrls;
  if (reel.videoUrl) return [reel.videoUrl];
  return [];
}

/** True while an immediate or scheduled publish is in flight for this item. */
export function isContentPublishing(reel: ContentReel): boolean {
  if (reel.publishingAt) return true;
  return (reel.scheduledPosts ?? []).some((post) => post.publishingAt && !post.postedAt);
}

export function pendingScheduleCount(reel: ContentReel): number {
  return (reel.scheduledPosts ?? []).filter((post) => !post.postedAt).length;
}

export function isStoryVideo(reel: ContentReel): boolean {
  return isVideoUrl(getContentMediaUrls(reel)[0] ?? '');
}

export function contentMediaLabel(type: ContentMediaType | undefined): string {
  switch (type) {
    case 'image':
      return 'Image';
    case 'story':
      return 'Story';
    case 'carousel':
      return 'Carousel';
    default:
      return 'Reel';
  }
}

export function contentTabLabel(type: ContentMediaType): string {
  switch (type) {
    case 'image':
      return 'Images';
    case 'story':
      return 'Stories';
    case 'carousel':
      return 'Carousels';
    default:
      return 'Reels';
  }
}

export const ALL_MEDIA_ACCEPT =
  'image/*,video/*,.heic,.heif,.HEIC,.HEIF,.mov,.mp4,.m4v,.webm,.mkv,.avi';

export function isImageFile(file: Blob, name?: string): boolean {
  if (file.type.startsWith('image/')) return true;
  if (name && /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|avif)$/i.test(name)) return true;
  return false;
}

export function isVideoFile(file: Blob, name?: string): boolean {
  if (file.type.startsWith('video/')) return true;
  if (name && /\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(name)) return true;
  return false;
}

export function extForContentFile(file: Blob, name?: string): string {
  const map: Record<string, string> = {
    'video/webm': 'webm',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/x-m4v': 'm4v',
    'video/x-matroska': 'mkv',
    'video/avi': 'avi',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
  };
  if (file.type && map[file.type]) return map[file.type];
  if (name) {
    const match = name.match(/\.([a-z0-9]+)$/i);
    if (match) return match[1].toLowerCase();
  }
  return isImageFile(file, name) ? 'jpg' : 'mp4';
}

export function contentTabSingular(type: ContentMediaType): string {
  switch (type) {
    case 'image':
      return 'image';
    case 'story':
      return 'story';
    case 'carousel':
      return 'carousel';
    default:
      return 'reel';
  }
}
