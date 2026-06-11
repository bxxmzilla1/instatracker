import type { FollowerSnapshot } from '../types';
import { formatCount, formatDate } from '../lib/format';

interface Props {
  history: FollowerSnapshot[];
}

export function FollowerChart({ history }: Props) {
  if (history.length < 2) {
    return <p className="empty-note">Refresh this account a few times to build follower history.</p>;
  }

  const values = history.map((h) => h.followers);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);

  return (
    <div className="follower-chart">
      <div className="follower-chart__bars">
        {history.map((point) => {
          const height = 20 + ((point.followers - min) / range) * 80;
          return (
            <div key={point.capturedAt} className="follower-chart__bar" title={`${formatCount(point.followers)} on ${formatDate(point.capturedAt)}`}>
              <span style={{ height: `${height}%` }} />
            </div>
          );
        })}
      </div>
      <div className="follower-chart__labels">
        <span>{formatCount(history[0].followers)}</span>
        <span>{formatCount(history.at(-1)!.followers)}</span>
      </div>
    </div>
  );
}
