import { useMemo, useState } from 'react';
import type { ReelHistory } from '../types';
import { formatCount, proxiedImage } from '../lib/format';
import { currentMonthLabel, monthlyViewBarsForReel } from '../lib/dashboard';
import { BarChart } from './BarChart';

interface Props {
  history: ReelHistory;
}

export function ReelCard({ history }: Props) {
  const latest = history.snapshots.at(-1);
  const [thumbError, setThumbError] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const showThumb = Boolean(history.thumbnailUrl) && !thumbError;
  const reelUrl = `https://www.instagram.com/reel/${history.shortcode}/`;
  const monthlyBars = useMemo(
    () => monthlyViewBarsForReel(history.snapshots),
    [history.snapshots],
  );

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
      <button type="button" className="reel-card__stats" onClick={() => setShowStats(true)}>
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
            <p className="cred-note">
              /reel/{history.shortcode} · {currentMonthLabel()}
            </p>
            <div className="trend-chart__summary">
              <strong>{latest ? formatCount(latest.views) : '0'}</strong>
              <span className="delta">total views</span>
            </div>
            <BarChart bars={monthlyBars} />
          </div>
        </div>
      )}
    </article>
  );
}
