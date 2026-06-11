import { useMemo, useState } from 'react';
import type { FollowerSnapshot, ReelSnapshot, TrackedAccount } from '../types';
import {
  computeStats,
  currentMonthLabel,
  monthlyFollowerBars,
  monthlyReelViewBars,
} from '../lib/dashboard';
import { formatCount, proxiedImage } from '../lib/format';
import { BarChart } from './BarChart';

interface Props {
  accounts: TrackedAccount[];
  reelSnapshots: ReelSnapshot[];
  followerSnapshots: FollowerSnapshot[];
}

type Metric = 'views' | 'followers';

export function Dashboard({ accounts, reelSnapshots, followerSnapshots }: Props) {
  const [metric, setMetric] = useState<Metric>('views');

  const stats = useMemo(
    () => computeStats(accounts, reelSnapshots),
    [accounts, reelSnapshots],
  );

  const bars = useMemo(
    () =>
      metric === 'views'
        ? monthlyReelViewBars(reelSnapshots)
        : monthlyFollowerBars(followerSnapshots),
    [metric, reelSnapshots, followerSnapshots],
  );

  const monthLabel = currentMonthLabel();
  const currentTotal = metric === 'views' ? stats.totalReelViews : stats.totalFollowers;
  const recorded = bars.filter((bar) => !bar.isFuture && bar.value > 0);
  const monthGain =
    recorded.length >= 2 ? recorded[recorded.length - 1].value - recorded[0].value : 0;

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
          <span className="dashboard__month">{monthLabel}</span>
        </div>

        <div className="trend-chart__summary">
          <strong>{formatCount(currentTotal)}</strong>
          <span className={monthGain > 0 ? 'delta delta--up' : monthGain < 0 ? 'delta delta--down' : 'delta'}>
            {monthGain > 0 ? '+' : ''}
            {formatCount(monthGain)} this month
          </span>
        </div>

        <BarChart bars={bars} color={chartColor} />
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
