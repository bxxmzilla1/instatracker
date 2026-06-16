// Instagram Graph API client for account analytics.
//
// All requests are relayed through our /api/graph serverless proxy (browsers
// cannot call graph.instagram.com directly because of CORS). Ported from the
// "IG Poster" project and adapted to the proxy transport.

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
  options: { method?: 'GET' | 'POST'; host?: string } = {},
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
    fields: 'id,username,name,followers_count,follows_count,media_count,profile_picture_url',
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
