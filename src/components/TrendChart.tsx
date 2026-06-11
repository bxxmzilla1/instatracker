import { useId } from 'react';
import type { SeriesPoint } from '../lib/dashboard';
import { formatCount, formatDate } from '../lib/format';

interface Props {
  points: SeriesPoint[];
  color?: string;
}

const WIDTH = 100;
const HEIGHT = 42;
const PAD_Y = 3;

export function TrendChart({ points, color = '#dd2a7b' }: Props) {
  const gradientId = useId();

  if (points.length < 2) {
    return (
      <p className="empty-note">
        Not enough data yet — refresh your accounts over time to build this trend.
      </p>
    );
  }

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const count = points.length;

  const coords = points.map((point, index) => {
    const x = (index / (count - 1)) * WIDTH;
    const y = HEIGHT - PAD_Y - ((point.value - min) / range) * (HEIGHT - PAD_Y * 2);
    return [x, y] as const;
  });

  const line = coords
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const area = `${line} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z`;

  const first = points[0];
  const last = points[points.length - 1];
  const change = last.value - first.value;

  return (
    <div className="trend-chart">
      <div className="trend-chart__summary">
        <strong>{formatCount(last.value)}</strong>
        <span className={change > 0 ? 'delta delta--up' : change < 0 ? 'delta delta--down' : 'delta'}>
          {change > 0 ? '+' : ''}
          {formatCount(change)} in range
        </span>
      </div>
      <svg
        className="trend-chart__svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Trend chart"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.45" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="0.8"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="trend-chart__axis">
        <span>{formatDate(first.t)}</span>
        <span>{formatDate(last.t)}</span>
      </div>
    </div>
  );
}
