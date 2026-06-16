// Server-side Instagram Graph publishing (reels / images / carousels).
// Uses the same relay as /api/graph so it can run from cron without a browser.

import { relayGraphRequest } from './graph.js';

const GRAPH_API_VERSION = 'v23.0';
const GRAPH_HOST = 'https://graph.instagram.com';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60;

async function graphCall(method, path, accessToken, params = {}) {
  const { status, data } = await relayGraphRequest({
    method,
    path,
    params,
    accessToken,
    host: GRAPH_HOST,
    version: GRAPH_API_VERSION,
  });
  if (status >= 400 || data?.error) {
    throw new Error(data?.error?.message || `Instagram API error (${status})`);
  }
  return data;
}

async function createMediaContainer(igUserId, accessToken, params) {
  const data = await graphCall('POST', `/${igUserId}/media`, accessToken, params);
  return data.id;
}

async function publishContainer(igUserId, accessToken, creationId) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const data = await graphCall('POST', `/${igUserId}/media_publish`, accessToken, {
        creation_id: creationId,
      });
      return data.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/media id is not available/i.test(message) || attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw new Error('Failed to publish media container');
}

async function waitForContainerReady(containerId, accessToken, onProgress) {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const { status_code } = await graphCall('GET', `/${containerId}`, accessToken, {
      fields: 'status_code',
    });
    onProgress?.(status_code);
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') {
      throw new Error(`Media processing failed: ${status_code}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error('Timed out waiting for media to finish processing');
}

async function resolvePermalink(mediaId, accessToken) {
  try {
    const data = await graphCall('GET', `/${mediaId}`, accessToken, { fields: 'id,permalink' });
    return data.permalink;
  } catch {
    return undefined;
  }
}

export async function publishImage(igUserId, accessToken, imageUrl, caption, onProgress) {
  onProgress?.({ stage: 'creating' });
  const containerId = await createMediaContainer(igUserId, accessToken, {
    image_url: imageUrl,
    caption,
  });
  onProgress?.({ stage: 'processing', status: 'IN_PROGRESS' });
  await waitForContainerReady(containerId, accessToken, (status) =>
    onProgress?.({ stage: 'processing', status }),
  );
  onProgress?.({ stage: 'publishing' });
  const mediaId = await publishContainer(igUserId, accessToken, containerId);
  const permalink = await resolvePermalink(mediaId, accessToken);
  onProgress?.({ stage: 'done', mediaId, permalink });
  return { mediaId, permalink };
}

export async function publishReel(igUserId, accessToken, videoUrl, caption, onProgress) {
  onProgress?.({ stage: 'creating' });
  const containerId = await createMediaContainer(igUserId, accessToken, {
    media_type: 'REELS',
    video_url: videoUrl,
    caption,
  });
  onProgress?.({ stage: 'processing', status: 'IN_PROGRESS' });
  await waitForContainerReady(containerId, accessToken, (status) =>
    onProgress?.({ stage: 'processing', status }),
  );
  onProgress?.({ stage: 'publishing' });
  const mediaId = await publishContainer(igUserId, accessToken, containerId);
  const permalink = await resolvePermalink(mediaId, accessToken);
  onProgress?.({ stage: 'done', mediaId, permalink });
  return { mediaId, permalink };
}

export async function publishCarousel(igUserId, accessToken, mediaUrls, caption, onProgress) {
  onProgress?.({ stage: 'creating' });
  const childIds = [];
  for (const url of mediaUrls) {
    const isVideo = /\.(mp4|mov|webm|m4v|mkv|avi)(\?|$)/i.test(url);
    const params = { is_carousel_item: 'true' };
    if (isVideo) {
      params.media_type = 'VIDEO';
      params.video_url = url;
    } else {
      params.image_url = url;
    }
    childIds.push(await createMediaContainer(igUserId, accessToken, params));
  }
  for (const childId of childIds) {
    await waitForContainerReady(childId, accessToken);
  }
  const containerId = await createMediaContainer(igUserId, accessToken, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption,
  });
  onProgress?.({ stage: 'processing', status: 'IN_PROGRESS' });
  await waitForContainerReady(containerId, accessToken, (status) =>
    onProgress?.({ stage: 'processing', status }),
  );
  onProgress?.({ stage: 'publishing' });
  const mediaId = await publishContainer(igUserId, accessToken, containerId);
  const permalink = await resolvePermalink(mediaId, accessToken);
  onProgress?.({ stage: 'done', mediaId, permalink });
  return { mediaId, permalink };
}

export async function publishStoryImage(igUserId, accessToken, imageUrl, onProgress) {
  onProgress?.({ stage: 'creating' });
  const containerId = await createMediaContainer(igUserId, accessToken, {
    media_type: 'STORIES',
    image_url: imageUrl,
  });
  onProgress?.({ stage: 'processing', status: 'IN_PROGRESS' });
  await waitForContainerReady(containerId, accessToken, (status) =>
    onProgress?.({ stage: 'processing', status }),
  );
  onProgress?.({ stage: 'publishing' });
  const mediaId = await publishContainer(igUserId, accessToken, containerId);
  const permalink = await resolvePermalink(mediaId, accessToken);
  onProgress?.({ stage: 'done', mediaId, permalink });
  return { mediaId, permalink };
}

export async function publishStoryVideo(igUserId, accessToken, videoUrl, onProgress) {
  onProgress?.({ stage: 'creating' });
  const containerId = await createMediaContainer(igUserId, accessToken, {
    media_type: 'STORIES',
    video_url: videoUrl,
  });
  onProgress?.({ stage: 'processing', status: 'IN_PROGRESS' });
  await waitForContainerReady(containerId, accessToken, (status) =>
    onProgress?.({ stage: 'processing', status }),
  );
  onProgress?.({ stage: 'publishing' });
  const mediaId = await publishContainer(igUserId, accessToken, containerId);
  const permalink = await resolvePermalink(mediaId, accessToken);
  onProgress?.({ stage: 'done', mediaId, permalink });
  return { mediaId, permalink };
}

export async function publishContent(igUserId, accessToken, options, onProgress) {
  const { mediaType, mediaUrls, caption } = options;
  if (!mediaUrls?.length) throw new Error('No media to publish');
  if (mediaType === 'carousel' || mediaUrls.length > 1) {
    return publishCarousel(igUserId, accessToken, mediaUrls, caption, onProgress);
  }
  if (mediaType === 'story') {
    const isVideo = /\.(mp4|mov|webm|m4v|mkv|avi)(\?|$)/i.test(mediaUrls[0]);
    return isVideo
      ? publishStoryVideo(igUserId, accessToken, mediaUrls[0], onProgress)
      : publishStoryImage(igUserId, accessToken, mediaUrls[0], onProgress);
  }
  if (mediaType === 'reel') {
    return publishReel(igUserId, accessToken, mediaUrls[0], caption, onProgress);
  }
  return publishImage(igUserId, accessToken, mediaUrls[0], caption, onProgress);
}
