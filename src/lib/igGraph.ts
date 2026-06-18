// Instagram Graph API client for account analytics.
//
// All requests are relayed through our /api/graph serverless proxy (browsers
// cannot call graph.instagram.com directly because of CORS). Ported from the
// "IG Poster" project and adapted to the proxy transport.

import type { GraphRelayProxy } from './proxyRelay';

const GRAPH_API_VERSION = 'v23.0';

export interface GraphApiError {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

export class InstagramApiError extends Error {
  readonly graphError: GraphApiError;

  constructor(graphError: GraphApiError) {
    super(graphError.message);
    this.name = 'InstagramApiError';
    this.graphError = graphError;
  }

  toDisplayString(): string {
    const e = this.graphError;
    const parts = [e.message, `Code: ${e.code}`];
    if (e.error_subcode != null) parts.push(`Subcode: ${e.error_subcode}`);
    return parts.join(' · ');
  }
}

export interface IgAccountProfile {
  id: string;
  username: string;
  name?: string;
  biography?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  profile_picture_url?: string;
}

export interface InsightMetricValue {
  value: number;
  end_time?: string;
}

export interface InsightBreakdownResult {
  dimension_values: string[];
  value: number;
}

export interface InsightBreakdown {
  dimension_keys: string[];
  results: InsightBreakdownResult[];
}

export interface InsightMetric {
  name: string;
  title?: string;
  description?: string;
  period?: string;
  values?: InsightMetricValue[];
  total_value?: {
    value?: number;
    breakdowns?: InsightBreakdown[];
  };
}

interface InsightsResponse {
  data: InsightMetric[];
}

export type IgMediaProductType = 'FEED' | 'REELS' | 'STORY' | 'AD' | string;

export interface IgMediaItem {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: IgMediaProductType;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  thumbnail_url?: string;
  media_url?: string;
  permalink?: string;
}

export interface IgMediaListResponse {
  data: IgMediaItem[];
  paging?: {
    cursors?: { before?: string; after?: string };
    next?: string;
  };
}

export type DemographicTimeframe = 'this_week' | 'this_month' | 'last_30_days';

export interface InsightSlice {
  label: string;
  value: number;
}

export interface FullAccountInsights {
  activity: InsightMetric[];
  supplemental: InsightMetric[];
  demographics: InsightMetric[];
}

interface IgMeResponse {
  user_id: string;
  username: string;
  profile_picture_url?: string;
}

const GRAPH_HOST = 'https://graph.instagram.com';

async function graphRequest<T>(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
  options: { method?: 'GET' | 'POST'; host?: string; proxy?: GraphRelayProxy } = {},
): Promise<T> {
  const response = await fetch('/api/graph', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: options.method ?? 'GET',
      path,
      params,
      accessToken,
      host: options.host ?? GRAPH_HOST,
      version: GRAPH_API_VERSION,
      proxy: options.proxy,
    }),
  });

  const data = await response.json().catch(() => ({}));
  const err = (data as { error?: GraphApiError }).error;
  if (!response.ok || err) {
    throw new InstagramApiError(
      err ?? { message: `HTTP ${response.status}`, type: 'HttpError', code: response.status },
    );
  }
  return data as T;
}

export async function validateAccount(accessToken: string, igUserId?: string) {
  const me = await graphRequest<IgMeResponse>('/me', accessToken, {
    fields: 'user_id,username,profile_picture_url',
  });
  if (igUserId && igUserId !== me.user_id) {
    throw new InstagramApiError({
      message: `Token belongs to @${me.username} (ID: ${me.user_id}), not ${igUserId}`,
      type: 'MismatchError',
      code: 0,
    });
  }
  return { id: me.user_id, username: me.username, profile_picture_url: me.profile_picture_url };
}

export async function getAccountProfile(
  igUserId: string,
  accessToken: string,
): Promise<IgAccountProfile> {
  return graphRequest<IgAccountProfile>(`/${igUserId}`, accessToken, {
    fields: 'id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url',
  });
}

const ACCOUNT_INSIGHT_METRICS = [
  'reach',
  'views',
  'accounts_engaged',
  'total_interactions',
  'likes',
  'comments',
  'shares',
  'saves',
] as const;

const ACCOUNT_SUPPLEMENTAL_METRICS = ['profile_views', 'replies', 'reposts'] as const;

const DEMOGRAPHIC_BREAKDOWNS = ['age', 'city', 'country', 'gender'] as const;

const DEMOGRAPHIC_METRICS = [
  'follower_demographics',
  'engaged_audience_demographics',
  'reached_audience_demographics',
] as const;

const ACCOUNT_BREAKDOWN_REQUESTS: Array<{ metric: string; breakdown: string; label: string }> = [
  { metric: 'reach', breakdown: 'media_product_type', label: 'reach_by_surface' },
  { metric: 'views', breakdown: 'media_product_type', label: 'views_by_surface' },
  { metric: 'reach', breakdown: 'follow_type', label: 'reach_by_follow_type' },
  { metric: 'views', breakdown: 'follower_type', label: 'views_by_follower_type' },
  { metric: 'likes', breakdown: 'media_product_type', label: 'likes_by_surface' },
  { metric: 'total_interactions', breakdown: 'media_product_type', label: 'interactions_by_surface' },
  { metric: 'profile_links_taps', breakdown: 'contact_button_type', label: 'profile_links_taps' },
];

const MEDIA_INSIGHT_METRICS: Record<string, string[]> = {
  REELS: [
    'views',
    'reach',
    'likes',
    'comments',
    'saved',
    'shares',
    'total_interactions',
    'ig_reels_avg_watch_time',
    'ig_reels_video_view_total_time',
    'follows',
  ],
  STORY: ['views', 'reach', 'replies', 'shares', 'total_interactions', 'navigation', 'follows'],
  FEED: [
    'views',
    'reach',
    'likes',
    'comments',
    'saved',
    'shares',
    'total_interactions',
    'profile_visits',
    'follows',
  ],
};

function insightMetricValue(metric: InsightMetric): number | undefined {
  if (metric.total_value?.value != null) return metric.total_value.value;
  const values = metric.values;
  if (!values?.length) return undefined;
  return values.reduce((sum, v) => sum + (v.value ?? 0), 0);
}

async function fetchAccountInsightMetric(
  igUserId: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<InsightMetric | null> {
  try {
    const { data } = await graphRequest<InsightsResponse>(`/${igUserId}/insights`, accessToken, params);
    return data[0] ?? null;
  } catch {
    return null;
  }
}

export function parseInsightBreakdown(metric: InsightMetric, dimensionKey: string): InsightSlice[] {
  const breakdowns = metric.total_value?.breakdowns ?? [];
  const slices: InsightSlice[] = [];
  for (const breakdown of breakdowns) {
    const dimensionKeys = breakdown.dimension_keys ?? [];
    const keyIndex = dimensionKeys.indexOf(dimensionKey);
    if (keyIndex < 0) continue;
    for (const result of breakdown.results ?? []) {
      const label = (result.dimension_values ?? [])[keyIndex];
      if (!label) continue;
      slices.push({ label, value: result.value ?? 0 });
    }
  }
  return slices.sort((a, b) => b.value - a.value);
}

export function parseDemographicBreakdown(metric: InsightMetric, demographicKey: string): InsightSlice[] {
  const breakdowns = metric.total_value?.breakdowns ?? [];
  const slices: InsightSlice[] = [];
  for (const breakdown of breakdowns) {
    const dimensionKeys = breakdown.dimension_keys ?? [];
    const keyIndex = dimensionKeys.indexOf(demographicKey);
    if (keyIndex < 0) continue;
    for (const result of breakdown.results ?? []) {
      const label = (result.dimension_values ?? [])[keyIndex];
      if (!label || label.startsWith('LAST_') || label === 'THIS_WEEK' || label === 'THIS_MONTH') {
        continue;
      }
      slices.push({ label, value: result.value ?? 0 });
    }
  }
  return slices.sort((a, b) => b.value - a.value);
}

export async function getAccountInsights(
  igUserId: string,
  accessToken: string,
  since: number,
  until: number,
): Promise<InsightMetric[]> {
  const { data } = await graphRequest<InsightsResponse>(`/${igUserId}/insights`, accessToken, {
    metric: ACCOUNT_INSIGHT_METRICS.join(','),
    period: 'day',
    metric_type: 'total_value',
    since: String(since),
    until: String(until),
  });
  return data ?? [];
}

export async function getFullAccountInsights(
  igUserId: string,
  accessToken: string,
  since: number,
  until: number,
  demographicTimeframe: DemographicTimeframe,
  existingActivity?: InsightMetric[],
): Promise<FullAccountInsights> {
  const activity =
    existingActivity ?? (await getAccountInsights(igUserId, accessToken, since, until));

  const supplementalMetrics: InsightMetric[] = [];
  try {
    const { data } = await graphRequest<InsightsResponse>(`/${igUserId}/insights`, accessToken, {
      metric: ACCOUNT_SUPPLEMENTAL_METRICS.join(','),
      period: 'day',
      metric_type: 'total_value',
      since: String(since),
      until: String(until),
    });
    supplementalMetrics.push(...(data ?? []));
  } catch {
    // optional
  }

  const breakdownMetrics = (
    await Promise.all(
      ACCOUNT_BREAKDOWN_REQUESTS.map(async (req) => {
        const metric = await fetchAccountInsightMetric(igUserId, accessToken, {
          metric: req.metric,
          period: 'day',
          metric_type: 'total_value',
          breakdown: req.breakdown,
          since: String(since),
          until: String(until),
        });
        if (metric) metric.name = req.label;
        return metric;
      }),
    )
  ).filter((m): m is InsightMetric => m != null);

  const demographicRequests = DEMOGRAPHIC_METRICS.flatMap((metric) =>
    DEMOGRAPHIC_BREAKDOWNS.map((breakdown) =>
      fetchAccountInsightMetric(igUserId, accessToken, {
        metric,
        period: 'lifetime',
        timeframe: demographicTimeframe,
        breakdown,
        metric_type: 'total_value',
      }).then((result) => {
        if (result) result.name = `${metric}_${breakdown}`;
        return result;
      }),
    ),
  );

  const demographics = (await Promise.all(demographicRequests)).filter(
    (m): m is InsightMetric => m != null,
  );

  return {
    activity: activity ?? [],
    supplemental: [...supplementalMetrics, ...breakdownMetrics],
    demographics,
  };
}

export async function getAccountMedia(
  igUserId: string,
  accessToken: string,
  limit = 12,
  after?: string,
): Promise<IgMediaListResponse> {
  const params: Record<string, string> = {
    fields:
      'id,caption,media_type,media_product_type,timestamp,like_count,comments_count,thumbnail_url,media_url,permalink',
    limit: String(limit),
  };
  if (after) params.after = after;
  return graphRequest<IgMediaListResponse>(`/${igUserId}/media`, accessToken, params);
}

function metricsForMedia(item: IgMediaItem): string[] {
  const productType = (item.media_product_type ?? 'FEED').toUpperCase();
  if (productType === 'REELS') return MEDIA_INSIGHT_METRICS.REELS;
  if (productType === 'STORY') return MEDIA_INSIGHT_METRICS.STORY;
  return MEDIA_INSIGHT_METRICS.FEED;
}

export async function getMediaInsights(
  mediaId: string,
  accessToken: string,
  mediaItem?: IgMediaItem,
): Promise<InsightMetric[]> {
  const metrics = mediaItem ? metricsForMedia(mediaItem) : MEDIA_INSIGHT_METRICS.FEED;
  const results: InsightMetric[] = [];
  try {
    const { data } = await graphRequest<InsightsResponse>(`/${mediaId}/insights`, accessToken, {
      metric: metrics.join(','),
    });
    results.push(...data);
  } catch {
    for (const metric of metrics) {
      try {
        const { data } = await graphRequest<InsightsResponse>(`/${mediaId}/insights`, accessToken, {
          metric,
        });
        results.push(...data);
      } catch {
        // skip unavailable metrics
      }
    }
  }
  return results;
}

export function summarizeInsights(
  metrics: InsightMetric[] | null | undefined,
): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const metric of metrics ?? []) {
    if (!metric?.name) continue;
    const value = insightMetricValue(metric);
    if (value != null) summary[metric.name] = value;
  }
  return summary;
}

export function formatInsightPeriod(days: number): { since: number; until: number } {
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 24 * 60 * 60;
  return { since, until };
}

export function demographicTimeframeForDays(days: number): DemographicTimeframe {
  if (days <= 7) return 'this_week';
  if (days <= 30) return 'last_30_days';
  return 'this_month';
}

// ---------------------------------------------------------------------------
// Publishing (Reels / Images / Carousels)
//
// Ported from the IG Poster project. The Graph publishing flow is:
//   1. POST /{ig-user-id}/media           → returns a creation/container id
//   2. (videos) poll GET /{container-id}  → wait until status_code = FINISHED
//   3. POST /{ig-user-id}/media_publish   → returns the published media id
// All media URLs must be publicly reachable so Instagram can fetch them.
// ---------------------------------------------------------------------------

export interface PublishProgress {
  stage: 'creating' | 'processing' | 'publishing' | 'done';
  status?: string;
  mediaId?: string;
  permalink?: string;
}

export interface PublishResult {
  mediaId: string;
  permalink?: string;
}

interface MediaContainerResponse {
  id: string;
}

interface ContainerStatusResponse {
  status_code: string;
}

interface MediaDetailsResponse {
  id: string;
  permalink?: string;
}

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60;

async function createMediaContainer(
  igUserId: string,
  accessToken: string,
  params: Record<string, string>,
  proxy?: GraphRelayProxy,
): Promise<string> {
  const payload = { ...params };
  if (payload.caption != null) payload.caption = String(payload.caption);
  const data = await graphRequest<MediaContainerResponse>(`/${igUserId}/media`, accessToken, payload, {
    method: 'POST',
    proxy,
  });
  return data.id;
}

async function publishContainer(
  igUserId: string,
  accessToken: string,
  creationId: string,
  proxy?: GraphRelayProxy,
): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const data = await graphRequest<MediaContainerResponse>(
        `/${igUserId}/media_publish`,
        accessToken,
        { creation_id: creationId },
        { method: 'POST', proxy },
      );
      return data.id;
    } catch (err) {
      const message = err instanceof InstagramApiError ? err.message : String(err);
      const retryable = /media id is not available/i.test(message);
      if (!retryable || attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw new InstagramApiError({
    message: 'Failed to publish media container',
    type: 'PublishError',
    code: 0,
  });
}

async function waitForContainerReady(
  containerId: string,
  accessToken: string,
  onProgress?: (status: string) => void,
  proxy?: GraphRelayProxy,
): Promise<void> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const { status_code } = await graphRequest<ContainerStatusResponse>(
      `/${containerId}`,
      accessToken,
      { fields: 'status_code' },
      { proxy },
    );
    onProgress?.(status_code);
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') {
      throw new InstagramApiError({
        message: `Media processing failed with status: ${status_code}`,
        type: 'ContainerError',
        code: 0,
      });
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new InstagramApiError({
    message: 'Timed out waiting for media to finish processing',
    type: 'TimeoutError',
    code: 0,
  });
}

async function resolvePermalink(
  mediaId: string,
  accessToken: string,
  proxy?: GraphRelayProxy,
): Promise<string | undefined> {
  try {
    const details = await graphRequest<MediaDetailsResponse>(`/${mediaId}`, accessToken, {
      fields: 'id,permalink',
    }, { proxy });
    return details.permalink;
  } catch {
    return undefined;
  }
}

export async function publishImage(
  igUserId: string,
  accessToken: string,
  imageUrl: string,
  caption: string,
  onProgress?: (progress: PublishProgress) => void,
  proxy?: GraphRelayProxy,
): Promise<PublishResult> {
  onProgress?.({ stage: 'creating' });
  const containerId = await createMediaContainer(igUserId, accessToken, {
    image_url: imageUrl,
    caption,
  }, proxy);
  onProgress?.({ stage: 'processing', status: 'IN_PROGRESS' });
  await waitForContainerReady(containerId, accessToken, (status) =>
    onProgress?.({ stage: 'processing', status }),
  proxy);
  onProgress?.({ stage: 'publishing' });
  const mediaId = await publishContainer(igUserId, accessToken, containerId, proxy);
  const permalink = await resolvePermalink(mediaId, accessToken, proxy);
  onProgress?.({ stage: 'done', mediaId, permalink });
  return { mediaId, permalink };
}

export async function publishReel(
  igUserId: string,
  accessToken: string,
  videoUrl: string,
  caption: string,
  onProgress?: (progress: PublishProgress) => void,
  proxy?: GraphRelayProxy,
): Promise<PublishResult> {
  onProgress?.({ stage: 'creating' });
  const containerId = await createMediaContainer(igUserId, accessToken, {
    media_type: 'REELS',
    video_url: videoUrl,
    caption,
  }, proxy);
  onProgress?.({ stage: 'processing', status: 'IN_PROGRESS' });
  await waitForContainerReady(containerId, accessToken, (status) =>
    onProgress?.({ stage: 'processing', status }),
  proxy);
  onProgress?.({ stage: 'publishing' });
  const mediaId = await publishContainer(igUserId, accessToken, containerId, proxy);
  const permalink = await resolvePermalink(mediaId, accessToken, proxy);
  onProgress?.({ stage: 'done', mediaId, permalink });
  return { mediaId, permalink };
}

export async function publishCarousel(
  igUserId: string,
  accessToken: string,
  mediaUrls: string[],
  caption: string,
  onProgress?: (progress: PublishProgress) => void,
  proxy?: GraphRelayProxy,
): Promise<PublishResult> {
  onProgress?.({ stage: 'creating' });
  const childIds: string[] = [];
  for (const url of mediaUrls) {
    const isVideo = /\.(mp4|mov|webm|m4v|mkv|avi)(\?|$)/i.test(url);
    const params: Record<string, string> = { is_carousel_item: 'true' };
    if (isVideo) {
      params.media_type = 'VIDEO';
      params.video_url = url;
    } else {
      params.image_url = url;
    }
    childIds.push(await createMediaContainer(igUserId, accessToken, params, proxy));
  }

  for (const childId of childIds) {
    await waitForContainerReady(childId, accessToken, undefined, proxy);
  }

  const containerId = await createMediaContainer(igUserId, accessToken, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption,
  }, proxy);
  onProgress?.({ stage: 'processing', status: 'IN_PROGRESS' });
  await waitForContainerReady(containerId, accessToken, (status) =>
    onProgress?.({ stage: 'processing', status }),
  proxy);
  onProgress?.({ stage: 'publishing' });
  const mediaId = await publishContainer(igUserId, accessToken, containerId, proxy);
  const permalink = await resolvePermalink(mediaId, accessToken, proxy);
  onProgress?.({ stage: 'done', mediaId, permalink });
  return { mediaId, permalink };
}

export async function publishStoryImage(
  igUserId: string,
  accessToken: string,
  imageUrl: string,
  onProgress?: (progress: PublishProgress) => void,
  proxy?: GraphRelayProxy,
): Promise<PublishResult> {
  onProgress?.({ stage: 'creating' });
  const containerId = await createMediaContainer(igUserId, accessToken, {
    media_type: 'STORIES',
    image_url: imageUrl,
  }, proxy);
  onProgress?.({ stage: 'processing', status: 'IN_PROGRESS' });
  await waitForContainerReady(containerId, accessToken, (status) =>
    onProgress?.({ stage: 'processing', status }),
  proxy);
  onProgress?.({ stage: 'publishing' });
  const mediaId = await publishContainer(igUserId, accessToken, containerId, proxy);
  const permalink = await resolvePermalink(mediaId, accessToken, proxy);
  onProgress?.({ stage: 'done', mediaId, permalink });
  return { mediaId, permalink };
}

export async function publishStoryVideo(
  igUserId: string,
  accessToken: string,
  videoUrl: string,
  onProgress?: (progress: PublishProgress) => void,
  proxy?: GraphRelayProxy,
): Promise<PublishResult> {
  onProgress?.({ stage: 'creating' });
  const containerId = await createMediaContainer(igUserId, accessToken, {
    media_type: 'STORIES',
    video_url: videoUrl,
  }, proxy);
  onProgress?.({ stage: 'processing', status: 'IN_PROGRESS' });
  await waitForContainerReady(containerId, accessToken, (status) =>
    onProgress?.({ stage: 'processing', status }),
  proxy);
  onProgress?.({ stage: 'publishing' });
  const mediaId = await publishContainer(igUserId, accessToken, containerId, proxy);
  const permalink = await resolvePermalink(mediaId, accessToken, proxy);
  onProgress?.({ stage: 'done', mediaId, permalink });
  return { mediaId, permalink };
}

/**
 * Publishes reels, feed images, stories, or carousels.
 */
export async function publishContent(
  igUserId: string,
  accessToken: string,
  options: {
    mediaType: 'reel' | 'image' | 'story' | 'carousel';
    mediaUrls: string[];
    caption: string;
    proxy?: GraphRelayProxy;
  },
  onProgress?: (progress: PublishProgress) => void,
): Promise<PublishResult> {
  const { mediaType, mediaUrls, caption, proxy } = options;
  if (mediaUrls.length === 0) {
    throw new InstagramApiError({ message: 'No media to publish', type: 'BadRequest', code: 400 });
  }
  if (mediaType === 'carousel' || mediaUrls.length > 1) {
    return publishCarousel(igUserId, accessToken, mediaUrls, caption, onProgress, proxy);
  }
  if (mediaType === 'story') {
    const isVideo = /\.(mp4|mov|webm|m4v|mkv|avi)(\?|$)/i.test(mediaUrls[0]);
    return isVideo
      ? publishStoryVideo(igUserId, accessToken, mediaUrls[0], onProgress, proxy)
      : publishStoryImage(igUserId, accessToken, mediaUrls[0], onProgress, proxy);
  }
  if (mediaType === 'reel') {
    return publishReel(igUserId, accessToken, mediaUrls[0], caption, onProgress, proxy);
  }
  return publishImage(igUserId, accessToken, mediaUrls[0], caption, onProgress, proxy);
}
