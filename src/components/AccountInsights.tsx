import { useCallback, useEffect, useState } from 'react';
import {
  demographicTimeframeForDays,
  formatInsightPeriod,
  getAccountInsights,
  getAccountMedia,
  getAccountProfile,
  getFullAccountInsights,
  getMediaInsights,
  InstagramApiError,
  parseDemographicBreakdown,
  parseInsightBreakdown,
  summarizeInsights,
  type FullAccountInsights,
  type IgAccountProfile,
  type IgMediaItem,
  type InsightMetric,
  type InsightSlice,
} from '../lib/igGraph';
import { formatCount, proxiedImage } from '../lib/format';

interface Props {
  igUserId: string;
  accessToken: string;
}

const PERIOD_OPTIONS = [
  { days: 7, label: 'Last 7 days' },
  { days: 28, label: 'Last 28 days' },
] as const;

const ACCOUNT_METRIC_LABELS: Record<string, string> = {
  reach: 'Reach',
  views: 'Views',
  accounts_engaged: 'Accounts engaged',
  total_interactions: 'Interactions',
  likes: 'Likes',
  comments: 'Comments',
  shares: 'Shares',
  saves: 'Saves',
  profile_views: 'Profile views',
  replies: 'Replies',
  reposts: 'Reposts',
};

const MEDIA_METRIC_LABELS: Record<string, string> = {
  views: 'Views',
  reach: 'Reach',
  likes: 'Likes',
  comments: 'Comments',
  saved: 'Saves',
  shares: 'Shares',
  total_interactions: 'Interactions',
  replies: 'Replies',
  profile_visits: 'Profile visits',
  ig_reels_avg_watch_time: 'Avg watch time',
  ig_reels_video_view_total_time: 'Total watch time',
  follows: 'Follows',
  navigation: 'Story navigation',
};

const BREAKDOWN_SECTION_LABELS: Record<string, string> = {
  reach_by_surface: 'Reach by surface',
  views_by_surface: 'Views by surface',
  likes_by_surface: 'Likes by surface',
  interactions_by_surface: 'Interactions by surface',
  reach_by_follow_type: 'Reach (followers vs non-followers)',
  views_by_follower_type: 'Views (followers vs non-followers)',
  profile_links_taps: 'Profile link taps',
};

const SURFACE_LABELS: Record<string, string> = {
  FEED: 'Posts',
  REELS: 'Reels',
  STORY: 'Stories',
  POST: 'Posts',
  CAROUSEL_CONTAINER: 'Carousels',
  AD: 'Ads',
};

const FOLLOW_TYPE_LABELS: Record<string, string> = {
  FOLLOWER: 'Followers',
  NON_FOLLOWER: 'Non-followers',
  UNKNOWN: 'Unknown',
};

const DEMOGRAPHIC_TABS = [
  { id: 'country', label: 'Country' },
  { id: 'city', label: 'City' },
  { id: 'age', label: 'Age' },
  { id: 'gender', label: 'Gender' },
] as const;

function metricLabel(name: string, labels: Record<string, string>): string {
  return labels[name] ?? BREAKDOWN_SECTION_LABELS[name] ?? name.replace(/_/g, ' ');
}

function formatSliceLabel(label: string): string {
  return FOLLOW_TYPE_LABELS[label] ?? SURFACE_LABELS[label] ?? label.replace(/_/g, ' ');
}

function formatMetricValue(name: string, value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (name.includes('avg_watch_time') || name.includes('view_total_time')) {
    const sec = value / 1000;
    if (sec < 60) return `${sec.toFixed(1)}s`;
    return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  }
  return formatCount(value);
}

function formatMediaDate(timestamp?: string): string {
  if (!timestamp) return '';
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return timestamp;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function MetricGrid({ summary, labels }: { summary: Record<string, number>; labels: Record<string, string> }) {
  const entries = Object.entries(summary);
  if (entries.length === 0) {
    return <p className="empty-note">No insight data available for this period.</p>;
  }
  return (
    <div className="metric-grid">
      {entries.map(([key, value]) => (
        <div className="metric-card" key={key}>
          <span>{metricLabel(key, labels)}</span>
          <strong>{formatMetricValue(key, value)}</strong>
        </div>
      ))}
    </div>
  );
}

function SliceBarList({ slices, maxItems = 12 }: { slices: InsightSlice[]; maxItems?: number }) {
  if (slices.length === 0) return <p className="empty-note">No data for this breakdown.</p>;
  const top = slices.slice(0, maxItems);
  const max = top[0]?.value ?? 1;
  return (
    <ul className="insight-bars">
      {top.map((slice, index) => (
        <li className="insight-bar" key={`${slice.label}-${index}`}>
          <div className="insight-bar__head">
            <span className="insight-bar__label">{formatSliceLabel(slice.label)}</span>
            <span className="insight-bar__value">{formatCount(slice.value)}</span>
          </div>
          <div className="insight-bar__track">
            <div
              className="insight-bar__fill"
              style={{ width: `${Math.max(4, (slice.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function BreakdownSections({
  metrics,
  configs,
}: {
  metrics: InsightMetric[];
  configs: Array<{ name: string; dimensionKey: string }>;
}) {
  const sections = configs
    .map((cfg) => {
      const metric = metrics.find((m) => m.name === cfg.name);
      if (!metric) return null;
      const slices = parseInsightBreakdown(metric, cfg.dimensionKey);
      if (slices.length === 0) return null;
      return { id: cfg.name, title: metricLabel(cfg.name, {}), slices };
    })
    .filter(Boolean) as Array<{ id: string; title: string; slices: InsightSlice[] }>;

  if (sections.length === 0) return null;
  return (
    <div className="insight-breakdowns">
      {sections.map((section) => (
        <div className="insight-breakdown" key={section.id}>
          <h4>{section.title}</h4>
          <SliceBarList slices={section.slices} />
        </div>
      ))}
    </div>
  );
}

function DemographicsPanel({ demographics }: { demographics: InsightMetric[] }) {
  const [audienceTab, setAudienceTab] = useState<'followers' | 'engaged' | 'reached'>('reached');
  const [breakdownTab, setBreakdownTab] = useState<string>('country');

  const followerData: Record<string, InsightSlice[]> = {};
  const engagedData: Record<string, InsightSlice[]> = {};
  const reachedData: Record<string, InsightSlice[]> = {};

  for (const metric of demographics) {
    if (!metric.name) continue;
    const match = metric.name.match(
      /^(follower_demographics|engaged_audience_demographics|reached_audience_demographics)_(\w+)$/,
    );
    if (!match) continue;
    const [, type, breakdown] = match;
    const slices = parseDemographicBreakdown(metric, breakdown);
    if (slices.length === 0) continue;
    if (type === 'follower_demographics') followerData[breakdown] = slices;
    else if (type === 'engaged_audience_demographics') engagedData[breakdown] = slices;
    else reachedData[breakdown] = slices;
  }

  const activeData =
    audienceTab === 'followers' ? followerData : audienceTab === 'engaged' ? engagedData : reachedData;
  const slices = activeData[breakdownTab] ?? [];
  const hasData =
    Object.keys(followerData).length + Object.keys(engagedData).length + Object.keys(reachedData).length > 0;

  if (!hasData) {
    return (
      <p className="empty-note">
        Demographics unavailable. Requires 100+ followers or engagements for the selected period.
      </p>
    );
  }

  const audienceTabs: Array<{ id: 'reached' | 'followers' | 'engaged'; label: string }> = [
    { id: 'reached', label: 'Reached' },
    { id: 'followers', label: 'Followers' },
    { id: 'engaged', label: 'Engaged' },
  ];

  return (
    <div className="insight-demographics">
      <div className="toggle-row">
        {audienceTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`toggle ${audienceTab === tab.id ? 'toggle--active' : ''}`}
            onClick={() => setAudienceTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="toggle-row">
        {DEMOGRAPHIC_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`toggle ${breakdownTab === tab.id ? 'toggle--active' : ''}`}
            onClick={() => setBreakdownTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <SliceBarList slices={slices} maxItems={15} />
    </div>
  );
}

function ReelPreviewCard({ item, accessToken }: { item: IgMediaItem; accessToken: string }) {
  const [metrics, setMetrics] = useState<InsightMetric[] | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [thumbError, setThumbError] = useState(false);

  // Pull this reel's insights up front so the card can show its view count,
  // matching the Views/Likes/Comments layout of the Apify reel cards.
  useEffect(() => {
    let cancelled = false;
    getMediaInsights(item.id, accessToken, item)
      .then((data) => {
        if (!cancelled) setMetrics(data);
      })
      .catch(() => {
        if (!cancelled) setMetrics([]);
      });
    return () => {
      cancelled = true;
    };
  }, [item, accessToken]);

  const summary = summarizeInsights(metrics);
  const thumb = proxiedImage(item.thumbnail_url ?? item.media_url);
  const showThumb = Boolean(thumb) && !thumbError;
  const reelUrl = item.permalink ?? '#';
  const views = summary.views;

  return (
    <article className="reel-card">
      {showThumb && (
        <a href={reelUrl} target="_blank" rel="noreferrer" className="reel-card__thumb">
          <img src={thumb} alt="Reel" loading="lazy" onError={() => setThumbError(true)} />
        </a>
      )}

      {item.caption && <p className="reel-card__caption">{item.caption}</p>}
      <div className="reel-card__metrics">
        <div>
          <span className="label">Views</span>
          <strong>{views != null ? formatCount(views) : '—'}</strong>
        </div>
        <div>
          <span className="label">Likes</span>
          <strong>{formatCount(item.like_count ?? summary.likes ?? 0)}</strong>
        </div>
        <div>
          <span className="label">Comments</span>
          <strong>{formatCount(item.comments_count ?? summary.comments ?? 0)}</strong>
        </div>
      </div>
      <button type="button" className="reel-card__stats" onClick={() => setShowStats(true)}>
        View all stats
      </button>
      <a href={reelUrl} target="_blank" rel="noreferrer" className="reel-card__watch">
        Watch Reel
      </a>

      {showStats && (
        <div className="modal" onClick={() => setShowStats(false)}>
          <div className="modal__card modal__card--wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <h3>Reel insights</h3>
              <button
                type="button"
                className="modal__close"
                onClick={() => setShowStats(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {item.timestamp && (
              <p className="cred-note">Posted {formatMediaDate(item.timestamp)}</p>
            )}
            {metrics == null ? (
              <p className="empty-note">Loading reel insights…</p>
            ) : (
              <MetricGrid summary={summary} labels={MEDIA_METRIC_LABELS} />
            )}
          </div>
        </div>
      )}
    </article>
  );
}

export function AccountInsights({ igUserId, accessToken }: Props) {
  const [periodDays, setPeriodDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<IgAccountProfile | null>(null);
  const [fullInsights, setFullInsights] = useState<FullAccountInsights | null>(null);
  const [reels, setReels] = useState<IgMediaItem[]>([]);
  const [loadingReels, setLoadingReels] = useState(false);

  const loadInsights = useCallback(async () => {
    setLoading(true);
    setLoadingDetails(true);
    setLoadingReels(true);
    setError(null);
    setReels([]);
    setFullInsights(null);

    const { since, until } = formatInsightPeriod(periodDays);
    const demographicTimeframe = demographicTimeframeForDays(periodDays);

    try {
      const [profileData, activityData] = await Promise.all([
        getAccountProfile(igUserId, accessToken),
        getAccountInsights(igUserId, accessToken, since, until),
      ]);

      setProfile(profileData);
      setFullInsights({ activity: activityData, supplemental: [], demographics: [] });
      setLoading(false);

      // Pull every media page and keep only reels (no "load more" button).
      void (async () => {
        const collected: IgMediaItem[] = [];
        let after: string | undefined;
        let pages = 0;
        try {
          do {
            const page = await getAccountMedia(igUserId, accessToken, 50, after);
            for (const item of page.data ?? []) {
              if ((item.media_product_type ?? '').toUpperCase() === 'REELS') collected.push(item);
            }
            after = page.paging?.cursors?.after;
            pages += 1;
          } while (after && pages < 20);
          setReels(collected);
        } catch {
          setReels(collected);
        } finally {
          setLoadingReels(false);
        }
      })();

      const details = await getFullAccountInsights(
        igUserId,
        accessToken,
        since,
        until,
        demographicTimeframe,
        activityData,
      );
      setFullInsights(details);
    } catch (err) {
      const message =
        err instanceof InstagramApiError
          ? err.toDisplayString()
          : err instanceof Error
            ? err.message
            : 'Failed to load insights';
      setError(message);
      setProfile(null);
      setFullInsights(null);
      setReels([]);
      setLoadingReels(false);
    } finally {
      setLoading(false);
      setLoadingDetails(false);
    }
  }, [igUserId, accessToken, periodDays]);

  useEffect(() => {
    void loadInsights();
  }, [loadInsights]);

  const accountAudienceMetrics = fullInsights
    ? fullInsights.supplemental.filter(
        (m) => m.name === 'reach_by_follow_type' || m.name === 'views_by_follower_type',
      )
    : [];
  const accountSurfaceMetrics = fullInsights
    ? fullInsights.supplemental.filter((m) => m.name?.endsWith('_by_surface'))
    : [];

  return (
    <div className="section-block insight-panel">
      <div className="insight-panel__head">
        <h3>Analytics</h3>
        <div className="insight-panel__controls">
          <div className="toggle-row">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                type="button"
                className={`toggle ${periodDays === opt.days ? 'toggle--active' : ''}`}
                onClick={() => setPeriodDays(opt.days)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn--ghost" onClick={() => void loadInsights()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="banner banner--warn">
          <span>{error}</span>
        </div>
      )}

      {profile && (
        <div className="insight-profile">
          {proxiedImage(profile.profile_picture_url) ? (
            <img className="insight-profile__avatar" src={proxiedImage(profile.profile_picture_url)} alt="" />
          ) : (
            <div className="insight-profile__avatar insight-profile__avatar--empty" />
          )}
          <div>
            <p className="insight-profile__name">
              @{profile.username}
              {profile.name && <span> · {profile.name}</span>}
            </p>
            <div className="insight-profile__stats">
              <span>
                <strong>{formatCount(profile.followers_count ?? 0)}</strong> followers
              </span>
              <span>
                <strong>{formatCount(profile.follows_count ?? 0)}</strong> following
              </span>
              <span>
                <strong>{formatCount(profile.media_count ?? 0)}</strong> posts
              </span>
            </div>
          </div>
        </div>
      )}

      {fullInsights && (
        <div className="insight-section">
          <h4 className="insight-section__title">Overview ({periodDays} days)</h4>
          <MetricGrid
            summary={{
              ...summarizeInsights(fullInsights.activity),
              ...summarizeInsights(
                fullInsights.supplemental.filter(
                  (m) => m.name && !m.name.includes('_by_') && m.name !== 'profile_links_taps',
                ),
              ),
            }}
            labels={ACCOUNT_METRIC_LABELS}
          />
        </div>
      )}

      {(accountAudienceMetrics.length > 0 || accountSurfaceMetrics.length > 0) && (
        <div className="insight-section">
          <h4 className="insight-section__title">Breakdowns ({periodDays} days)</h4>
          <BreakdownSections
            metrics={[...accountAudienceMetrics, ...accountSurfaceMetrics]}
            configs={[
              { name: 'reach_by_follow_type', dimensionKey: 'follow_type' },
              { name: 'views_by_follower_type', dimensionKey: 'follower_type' },
              { name: 'reach_by_surface', dimensionKey: 'media_product_type' },
              { name: 'views_by_surface', dimensionKey: 'media_product_type' },
              { name: 'likes_by_surface', dimensionKey: 'media_product_type' },
              { name: 'interactions_by_surface', dimensionKey: 'media_product_type' },
            ]}
          />
        </div>
      )}

      {loadingDetails && <p className="empty-note">Loading demographics and breakdowns…</p>}

      {fullInsights && !loadingDetails && (
        <div className="insight-section">
          <h4 className="insight-section__title">Demographics</h4>
          <DemographicsPanel demographics={fullInsights.demographics} />
        </div>
      )}

      <div className="insight-section">
        <h4 className="insight-section__title">Reels ({reels.length})</h4>
        {loadingReels && reels.length === 0 ? (
          <p className="empty-note">Loading reels…</p>
        ) : reels.length === 0 ? (
          <p className="empty-note">No reels found.</p>
        ) : (
          <div className="reel-grid">
            {reels.map((item) => (
              <ReelPreviewCard key={item.id} item={item} accessToken={accessToken} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
