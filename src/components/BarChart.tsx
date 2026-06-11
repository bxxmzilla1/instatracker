import type { DayBar } from '../lib/dashboard';
import { formatCount } from '../lib/format';

interface Props {
  bars: DayBar[];
  color?: string;
}

export function BarChart({ bars, color = '#dd2a7b' }: Props) {
  const max = Math.max(...bars.map((bar) => bar.value), 1);

  return (
    <div className="bar-chart">
      <div className="bar-chart__bars">
        {bars.map((bar) => {
          const height = bar.value > 0 ? Math.max(3, (bar.value / max) * 100) : 0;
          const showLabel = bar.day % 2 === 1 || bar.isToday;
          return (
            <div
              key={bar.day}
              className={`bar-chart__col ${bar.isToday ? 'bar-chart__col--today' : ''}`}
              title={`${bar.day}: ${formatCount(bar.value)}${bar.isFuture ? ' (upcoming)' : ''}`}
            >
              <div className="bar-chart__bar-wrap">
                <span
                  className="bar-chart__bar"
                  style={{ height: `${height}%`, background: color }}
                />
              </div>
              <span className="bar-chart__label">{showLabel ? bar.day : ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
