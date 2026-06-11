import type { DayBar } from '../lib/dashboard';
import { formatCount } from '../lib/format';

interface Props {
  bars: DayBar[];
  color?: string;
  postedDay?: number;
  showValues?: boolean;
}

export function BarChart({ bars, color = '#d4af37', postedDay, showValues }: Props) {
  const max = Math.max(...bars.map((bar) => bar.value), 1);

  return (
    <div className="bar-chart">
      <div className="bar-chart__bars">
        {bars.map((bar) => {
          const height = bar.value > 0 ? Math.max(3, (bar.value / max) * 100) : 0;
          const isPosted = postedDay === bar.day;
          return (
            <div
              key={bar.day}
              className={`bar-chart__col ${bar.isToday ? 'bar-chart__col--today' : ''} ${
                isPosted ? 'bar-chart__col--posted' : ''
              }`}
              title={`Day ${bar.day}: ${formatCount(bar.value)} views${
                isPosted ? ' · posted' : ''
              }${bar.isFuture ? ' (upcoming)' : ''}`}
            >
              <div className="bar-chart__bar-wrap">
                {showValues && bar.value > 0 && (
                  <span className="bar-chart__value">{formatCount(bar.value)}</span>
                )}
                <span
                  className="bar-chart__bar"
                  style={{ height: `${height}%`, background: color }}
                />
              </div>
              <span className="bar-chart__label">{bar.day}</span>
              {isPosted && <span className="bar-chart__posted">posted</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
