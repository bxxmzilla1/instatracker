import { useState } from 'react';
import type { ReelHistory } from '../types';
import { formatCount, formatDelta, proxiedImage } from '../lib/format';

interface Props {
  history: ReelHistory;
}

export function ReelCard({ history }: Props) {
  const latest = history.snapshots.at(-1);
  const previous = history.snapshots.length > 1 ? history.snapshots.at(-2) : undefined;
  const viewDelta = latest ? formatDelta(latest.views, previous?.views) : null;
  const [thumbError, setThumbError] = useState(false);
  const showThumb = Boolean(history.thumbnailUrl) && !thumbError;
  const reelUrl = `https://www.instagram.com/reel/${history.shortcode}/`;

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
      {viewDelta && (
        <div className="reel-card__header">
          <span className={viewDelta.startsWith('+') ? 'delta delta--up' : viewDelta === '0' ? 'delta' : 'delta delta--down'}>
            {viewDelta} views
          </span>
        </div>
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
      <a href={reelUrl} target="_blank" rel="noreferrer" className="reel-card__watch">
        Watch Reel
      </a>
    </article>
  );
}
