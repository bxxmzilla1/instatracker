import type { ContentMediaType, ContentReel } from '../types';

export const MIN_CAROUSEL_ITEMS = 2;
export const MAX_CAROUSEL_ITEMS = 10;

const VIDEO_EXT = /\.(mp4|mov|webm)(\?|$)/i;

export function isVideoUrl(url: string): boolean {
  return VIDEO_EXT.test(url);
}

export function getContentMediaUrls(reel: ContentReel): string[] {
  if (reel.mediaUrls?.length) return reel.mediaUrls;
  if (reel.videoUrl) return [reel.videoUrl];
  return [];
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
