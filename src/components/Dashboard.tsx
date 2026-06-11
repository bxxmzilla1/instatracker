import { useMemo, useState } from 'react';
import type { FollowerSnapshot, ReelSnapshot, TrackedAccount } from '../types';
import {
  computeStats,
  filterWindow,
  followerSeries,
  reelViewSeries,
} from '../lib/dashboard';
import { formatCount, proxiedImage } from '../lib/format';
import { TrendChart } from './TrendChart';

interface Props {
  accounts: TrackedAccount[];
  reelSnapshots: ReelSnapshot[];
  followerSnapshots: FollowerSnapshot[];
}

type Metric = 'views' | 'followers';
type Period = 'day' | 'week' | 'month';

const PERIOD_MS: Record<Period, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

export function Dashboard({ accounts, reelSnapshots, followerSnapshots }: Props) {
  const [metric, setMetric] = useState<Metric>('views');
  const [period, setPeriod] = useState<Period>('week');

  const stats = useMemo(
    () => computeStats(accounts, reelSnapshots),
    [accounts, reelSnapshots],
  );

  const series = useMemo(() => {
    const base = metric === 'views' ? reelViewSeries(reelSnapshots) : followerSeries(followerSnapshots);
    return filterWindow(base, PERIOD_MS[period]);
  }, [metric, period, reelSnapshots, followerSnapshots]);

  const chartColor = metric === 'views' ? '#dd2a7b' : '#8134af';

  return (
    <section className="panel dashboard">
      <div className="panel__head">
        <h2>Dashboard</h2>
      </div>

      <div className="dashboard__stats">
        <div className="stat-card">
          <span className="stat-card__label">Total Followers</span>
          <strong className="stat-card__value">{formatCount(stats.totalFollowers)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">Total Reel Views</span>
          <strong className="stat-card__value">{formatCount(stats.totalReelViews)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">Accounts</span>
          <strong className="stat-card__value">{formatCount(stats.accountCount)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">Total Reels</span>
          <strong className="stat-card__value">{formatCount(stats.reelCount)}</strong>
        </div>
      </div>

      <div className="dashboard__chart">
        <div className="dashboard__chart-head">
          <div className="toggle-group">
            <button
              type="button"
              className={metric === 'views' ? 'toggle toggle--active' : 'toggle'}
              onClick={() => setMetric('views')}
            >
              Reel Views
            </button>
            <button
              type="button"
              className={metric === 'followers' ? 'toggle toggle--active' : 'toggle'}
              onClick={() => setMetric('followers')}
            >
              Followers
            </button>
          </div>
          <div className="toggle-group">
            {(['day', 'week', 'month'] as Period[]).map((value) => (
              <button
                key={value}
                type="button"
                className={period === value ? 'toggle toggle--active' : 'toggle'}
                onClick={() => setPeriod(value)}
              >
                {value === 'day' ? 'Day' : value === 'week' ? 'Week' : 'Month'}
              </button>
            ))}
          </div>
        </div>

        <TrendChart points={series} color={chartColor} />
      </div>

      <div className="dashboard__highlights">
        <div className="highlight-card">
          <span className="highlight-card__label">Top profile by views</span>
          {stats.topProfile ? (
            <div className="highlight-card__body">
              <div className="highlight-card__avatar">
                {stats.topProfile.profilePicUrl ? (
                  <img src={proxiedImage(stats.topProfile.profilePicUrl)} alt="" loading="lazy" />
                ) : (
                  <span>{stats.topProfile.username.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div>
                <strong>@{stats.topProfile.username}</strong>
                <p>{formatCount(stats.topProfile.views)} total reel views</p>
                {stats.topProfile.followers !== undefined && (
                  <p className="muted">{formatCount(stats.topProfile.followers)} followers</p>
                )}
              </div>
            </div>
          ) : (
            <p className="empty-note">Refresh an account to see this.</p>
          )}
        </div>

        <div className="highlight-card">
          <span className="highlight-card__label">Top reel by views</span>
          {stats.topReel ? (
            <a
              className="highlight-card__body highlight-card__body--link"
              href={`https://www.instagram.com/reel/${stats.topReel.shortcode}/`}
              target="_blank"
              rel="noreferrer"
            >
              <div className="highlight-card__thumb">
                {stats.topReel.thumbnailUrl ? (
                  <img src={proxiedImage(stats.topReel.thumbnailUrl)} alt="" loading="lazy" />
                ) : (
                  <span>▶</span>
                )}
              </div>
              <div>
                <strong>{formatCount(stats.topReel.views)} views</strong>
                <p>@{stats.topReel.username}</p>
                {stats.topReel.caption && (
                  <p className="muted highlight-card__caption">{stats.topReel.caption}</p>
                )}
              </div>
            </a>
          ) : (
            <p className="empty-note">Refresh an account to see this.</p>
          )}
        </div>
      </div>
    </section>
  );
}
