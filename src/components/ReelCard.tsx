import { useMemo, useState } from 'react';
import type { ReelHistory } from '../types';
import { formatCount, proxiedImage } from '../lib/format';
import { monthLabel, monthlyViewBarsForReel } from '../lib/dashboard';
import { BarChart } from './BarChart';

interface Props {
  history: ReelHistory;
  addedAt?: number;
}

export function ReelCard({ history, addedAt }: Props) {
  const latest = history.snapshots.at(-1);
  const [thumbError, setThumbError] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);
  const showThumb = Boolean(history.thumbnailUrl) && !thumbError;
  const reelUrl = `https://www.instagram.com/reel/${history.shortcode}/`;

  const viewDate = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const monthlyBars = useMemo(
    () => monthlyViewBarsForReel(history.snapshots, year, month),
    [history.snapshots, year, month],
  );

  const addedDay = useMemo(() => {
    if (!addedAt) return undefined;
    const d = new Date(addedAt);
    return d.getFullYear() === year && d.getMonth() === month ? d.getDate() : undefined;
  }, [addedAt, year, month]);

  function openStats() {
    setMonthOffset(0);
    setShowStats(true);
  }

  return (
    <article className="reel-card">
      {showThumb && (
        <a href={reelUrl} target="_blank" rel="noreferrer" className="reel-card__thumb">
          <img
            src={proxiedImage(history.thumbnailUrl)}
            alt={`Reel ${history.shortcode}`}
            loading="lazy"
            onError={() => setThumbError(true)}
          />
        </a>
      )}

      {history.caption && <p className="reel-card__caption">{history.caption}</p>}
      <div className="reel-card__metrics">
        <div>
          <span className="label">Views</span>
          <strong>{latest ? formatCount(latest.views) : '—'}</strong>
        </div>
        <div>
          <span className="label">Likes</span>
          <strong>{latest ? formatCount(latest.likes) : '—'}</strong>
        </div>
        <div>
          <span className="label">Comments</span>
          <strong>{latest ? formatCount(latest.comments) : '—'}</strong>
        </div>
      </div>
      <button type="button" className="reel-card__stats" onClick={openStats}>
        Monthly views
      </button>
      <a href={reelUrl} target="_blank" rel="noreferrer" className="reel-card__watch">
        Watch Reel
      </a>

      {showStats && (
        <div className="modal" onClick={() => setShowStats(false)}>
          <div className="modal__card modal__card--wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <h3>Monthly views</h3>
              <button
                type="button"
                className="modal__close"
                onClick={() => setShowStats(false)}
                aria-label="Close"
              >
                ✕
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

            <div className="trend-chart__summary">
              <strong>{latest ? formatCount(latest.views) : '0'}</strong>
              <span className="delta">total views</span>
            </div>

            <BarChart bars={monthlyBars} markedDay={addedDay} markedLabel="added" showValues />
          </div>
        </div>
      )}
    </article>
  );
}
