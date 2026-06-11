import type { DayBar } from '../lib/dashboard';
import { formatCount } from '../lib/format';

interface Props {
  bars: DayBar[];
  color?: string;
  markedDay?: number;
  markedLabel?: string;
  showValues?: boolean;
  selectedDay?: number | null;
  onSelectDay?: (day: number) => void;
}

export function BarChart({
  bars,
  color = '#d4af37',
  markedDay,
  markedLabel = 'added',
  showValues,
  selectedDay,
  onSelectDay,
}: Props) {
  const max = Math.max(...bars.map((bar) => bar.value), 1);
  const clickable = Boolean(onSelectDay);

  return (
    <div className="bar-chart">
      <div className="bar-chart__bars">
        {bars.map((bar) => {
          const height = bar.value > 0 ? Math.max(3, (bar.value / max) * 100) : 0;
          const isMarked = markedDay === bar.day;
          const isSelected = selectedDay === bar.day;
          const className = [
            'bar-chart__col',
            bar.isToday ? 'bar-chart__col--today' : '',
            isMarked ? 'bar-chart__col--posted' : '',
            isSelected ? 'bar-chart__col--selected' : '',
            clickable ? 'bar-chart__col--clickable' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <button
              key={bar.day}
              type="button"
              className={className}
              onClick={clickable ? () => onSelectDay?.(bar.day) : undefined}
              title={`Day ${bar.day}: ${formatCount(bar.value)} views${
                isMarked ? ` · ${markedLabel}` : ''
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
              {isMarked && <span className="bar-chart__posted">{markedLabel}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
