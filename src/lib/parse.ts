import type { ParsedProfile, ParsedReel, ParsedStory } from '../types';

function pickNumber(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === 'number' && !Number.isNaN(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(/,/g, ''));
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return 0;
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

export function parseProfileResponse(data: unknown, username: string): ParsedProfile {
  const root = (data as Record<string, unknown>) ?? {};
  const result = (root.result ?? root.data ?? root.user ?? root) as Record<string, unknown>;
  const user = (result.user ?? result) as Record<string, unknown>;
  const edgeFollowedBy = user.edge_followed_by as Record<string, unknown> | undefined;
  const edgeFollow = user.edge_follow as Record<string, unknown> | undefined;
  const edgeMedia = user.edge_owner_to_timeline_media as Record<string, unknown> | undefined;
  const hdProfile = user.hd_profile_pic_url_info as Record<string, unknown> | undefined;

  return {
    username: pickString(user.username, result.username, username).toLowerCase() || username.toLowerCase(),
    fullName: pickString(user.full_name, user.fullName, result.full_name),
    profilePicUrl: pickString(
      user.profile_pic_url_hd,
      user.profilePicUrlHD,
      hdProfile?.url,
      user.profile_pic_url,
      user.profilePicUrl,
      result.profile_pic_url,
    ),
    followers: pickNumber(
      user.follower_count,
      user.followers,
      user.followersCount,
      edgeFollowedBy?.count,
      result.follower_count,
    ),
    following: pickNumber(
      user.following_count,
      user.following,
      user.followsCount,
      edgeFollow?.count,
      result.following_count,
    ),
    mediaCount: pickNumber(
      user.media_count,
      user.posts,
      user.postsCount,
      edgeMedia?.count,
      result.media_count,
    ),
    isVerified: Boolean(user.is_verified ?? user.isVerified ?? user.verified ?? result.is_verified),
    biography: pickString(user.biography, user.bio, result.biography),
  };
}

function extractReelNodes(data: unknown): Record<string, unknown>[] {
  const root = (data as Record<string, unknown>) ?? {};
  const result = (root.result ?? root.data ?? root) as Record<string, unknown>;

  const candidates = [
    result.items,
    result.reels,
    result.edges,
    (result.edge_owner_to_timeline_media as Record<string, unknown>)?.edges,
    (result.media as Record<string, unknown>)?.items,
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate.map((item) => {
      if (item && typeof item === 'object' && 'node' in item) {
        return (item as { node: Record<string, unknown> }).node;
      }
      return item as Record<string, unknown>;
    });
  }

  return [];
}

export function parseReelsResponse(data: unknown): ParsedReel[] {
  const nodes = extractReelNodes(data);

  return nodes.map((node, index) => {
    const media = (node.media ?? node) as Record<string, unknown>;
    const shortcode = pickString(media.shortcode, media.code, node.shortcode, node.code) || `reel-${index}`;
    const id = pickString(media.id, media.pk, node.id, shortcode) || shortcode;

    const captionObj = media.caption as Record<string, unknown> | undefined;
    const caption =
      pickString(captionObj?.text, media.caption, node.caption) || '';

    const thumbnailUrl = pickString(
      media.thumbnail_url,
      media.display_url,
      media.image,
      (media.images as Array<Record<string, unknown>>)?.[0]?.url,
      media.image_versions2?.candidates?.[0]?.url,
      node.thumbnail_url,
      node.display_url,
    );

    return {
      id,
      shortcode,
      caption,
      thumbnailUrl: thumbnailUrl || undefined,
      views: pickNumber(
        media.play_count,
        media.view_count,
        media.video_view_count,
        node.play_count,
        node.view_count,
      ),
      likes: pickNumber(
        media.like_count,
        media.likes,
        node.like_count,
        (node.edge_liked_by as Record<string, unknown>)?.count,
      ),
      comments: pickNumber(
        media.comment_count,
        media.comments,
        node.comment_count,
        (node.edge_media_to_comment as Record<string, unknown>)?.count,
      ),
      takenAt:
        pickNumber(
          media.taken_at,
          node.taken_at,
          captionObj?.created_at,
          captionObj?.created_at_utc,
        ) || undefined,
    };
  });
}

export function parseStoriesResponse(data: unknown): ParsedStory[] {
  const root = (data as Record<string, unknown>) ?? {};
  const result = (root.result ?? root.data ?? root) as Record<string, unknown>;
  const items = result.items;

  if (!Array.isArray(items)) return [];

  return items.map((raw, index) => {
    const item = raw as Record<string, unknown>;
    const imageVersions = item.image_versions as Record<string, unknown> | undefined;
    const imageItems = imageVersions?.items as Array<Record<string, unknown>> | undefined;
    const videoVersions = item.video_versions as Array<Record<string, unknown>> | undefined;

    const thumbnailUrl = pickString(
      imageItems?.[0]?.url,
      (item.image_versions2 as Record<string, unknown>)?.candidates &&
        ((item.image_versions2 as Record<string, unknown>).candidates as Array<Record<string, unknown>>)?.[0]?.url,
    );

    return {
      id: pickString(item.id, item.pk, item.code, `story-${index}`) || `story-${index}`,
      thumbnailUrl: thumbnailUrl || undefined,
      isVideo: Array.isArray(videoVersions) && videoVersions.length > 0,
      expiringAt: pickNumber(item.expiring_at) || undefined,
    };
  });
}

export function extractReelsCursor(data: unknown): string | undefined {
  const root = (data as Record<string, unknown>) ?? {};
  const result = (root.result ?? root.data ?? root) as Record<string, unknown>;
  const cursor = pickString(
    result.pagination_token,
    result.maxId,
    result.end_cursor,
    result.next_max_id,
    (result.page_info as Record<string, unknown>)?.end_cursor,
  );
  return cursor || undefined;
}
