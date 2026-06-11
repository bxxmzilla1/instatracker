import { useMemo, useState } from 'react';
import type { FollowerSnapshot, ReelSnapshot, TrackedAccount } from '../types';
import {
  computeCardStats,
  computeStats,
  dailyFollowerBars,
  dailyReelViewBars,
  monthLabel,
  totalsAsOf,
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
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const stats = useMemo(
    () => computeStats(accounts, reelSnapshots),
    [accounts, reelSnapshots],
  );

  const viewDate = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const bars = useMemo(
    () =>
      metric === 'views'
        ? dailyReelViewBars(reelSnapshots, year, month)
        : dailyFollowerBars(followerSnapshots, year, month),
    [metric, reelSnapshots, followerSnapshots, year, month],
  );

  const monthGain = bars.reduce((sum, bar) => (bar.isFuture ? sum : sum + bar.value), 0);
  const hasMonthGain = bars.some((bar) => !bar.isFuture && bar.value !== 0);

  const chartColor = metric === 'views' ? '#d4af37' : '#b8860b';

  const selectedBar = selectedDay ? bars.find((b) => b.day === selectedDay) ?? null : null;
  const metricNoun = metric === 'views' ? 'views' : 'followers';

  const card = useMemo(() => {
    if (selectedDay) {
      const dayStart = new Date(year, month, selectedDay, 0, 0, 0, 0).getTime();
      const dayEnd = new Date(year, month, selectedDay, 23, 59, 59, 999).getTime();
      const cur = totalsAsOf(accounts, reelSnapshots, followerSnapshots, dayEnd);
      const prev = totalsAsOf(accounts, reelSnapshots, followerSnapshots, dayStart - 1);
      return {
        totalFollowers: cur.followers - prev.followers,
        totalReelViews: cur.views - prev.views,
        totalAccounts: cur.accounts,
        totalReels: cur.reels,
        newAccounts: accounts.filter((a) => a.addedAt >= dayStart && a.addedAt <= dayEnd).length,
        bannedAccounts: accounts.filter(
          (a) => a.banned && a.bannedAt && a.bannedAt >= dayStart && a.bannedAt <= dayEnd,
        ).length,
      };
    }
    const windowStart = new Date(year, month, 1).getTime();
    const windowEnd = monthOffset === 0 ? Date.now() : new Date(year, month + 1, 1).getTime() - 1;
    return computeCardStats(accounts, reelSnapshots, followerSnapshots, undefined, windowStart, windowEnd);
  }, [accounts, reelSnapshots, followerSnapshots, selectedDay, year, month, monthOffset]);

  const currentTotal = metric === 'views' ? card.totalReelViews : card.totalFollowers;

  function toggleDay(day: number) {
    setSelectedDay((current) => (current === day ? null : day));
  }

  return (
    <section className="panel dashboard">
      <div className="dashboard__stats">
        <div className="stat-card">
          <span className="stat-card__label">Total Followers</span>
          <strong className="stat-card__value">{formatCount(card.totalFollowers)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">Total Reel Views</span>
          <strong className="stat-card__value">{formatCount(card.totalReelViews)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">Total Accounts</span>
          <strong className="stat-card__value">{formatCount(card.totalAccounts)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">New Accounts</span>
          <strong className="stat-card__value">{formatCount(card.newAccounts)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">Banned Accounts</span>
          <strong className="stat-card__value">{formatCount(card.bannedAccounts)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-card__label">Total Reels</span>
          <strong className="stat-card__value">{formatCount(card.totalReels)}</strong>
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
          <div className="month-nav">
            <button
              type="button"
              className="month-nav__btn"
              onClick={() => setMonthOffset((o) => o - 1)}
              aria-label="Previous month"
            >
              ‹
            </button>
            <span className="month-nav__label">{monthLabel(year, month)}</span>
            <button
              type="button"
              className="month-nav__btn"
              onClick={() => setMonthOffset((o) => o + 1)}
              disabled={monthOffset >= 0}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
        </div>

        <div className="trend-chart__summary">
          {selectedBar ? (
            <>
              <strong>
                {selectedBar.value > 0 ? '+' : ''}
                {formatCount(selectedBar.value)}
              </strong>
              <span className="delta">
                {metricNoun} gained on {monthLabel(year, month).split(' ')[0]} {selectedBar.day}
              </span>
            </>
          ) : (
            <>
              <strong>{formatCount(currentTotal)}</strong>
              {hasMonthGain && (
                <span className={monthGain > 0 ? 'delta delta--up' : monthGain < 0 ? 'delta delta--down' : 'delta'}>
                  {monthGain > 0 ? '+' : ''}
                  {formatCount(monthGain)} gained this month
                </span>
              )}
            </>
          )}
        </div>

        <BarChart
          bars={bars}
          color={chartColor}
          showValues
          selectedDay={selectedDay}
          onSelectDay={toggleDay}
        />
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
