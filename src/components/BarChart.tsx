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

const LADDER = [
  1_000, 5_000, 10_000, 50_000, 100_000, 250_000, 500_000, 750_000, 1_000_000, 5_000_000,
  10_000_000,
];

export function BarChart({
  bars,
  color = 'var(--chart-views)',
  markedDay,
  markedLabel = 'added',
  showValues,
  selectedDay,
  onSelectDay,
}: Props) {
  const dataMax = Math.max(...bars.map((bar) => bar.value), 0);
  const axisMax = LADDER.find((v) => v >= dataMax) ?? Math.max(dataMax, 1000);
  const ticks = LADDER.filter((v) => v <= axisMax);
  if (!ticks.includes(axisMax)) ticks.push(axisMax);
  const clickable = Boolean(onSelectDay);

  return (
    <div className="bar-chart">
      <div className="bar-chart__plot">
        <div className="bar-chart__yaxis">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="bar-chart__tick"
              style={{ bottom: `${(tick / axisMax) * 100}%` }}
            >
              {formatCount(tick)}
            </span>
          ))}
        </div>

        <div className="bar-chart__bars">
          {bars.map((bar) => {
            const height = bar.value > 0 ? Math.max(2, (bar.value / axisMax) * 100) : 0;
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
    </div>
  );
}
