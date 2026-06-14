import { formatCount } from '../lib/format';

export interface FollowBar {
  day: number;
  newValue: number;
  oldValue: number;
  isFuture: boolean;
  isToday: boolean;
}

interface Props {
  bars: FollowBar[];
}

const LADDER = [10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 50_000, 100_000];

export function BskyFollowChart({ bars }: Props) {
  const dataMax = Math.max(...bars.map((b) => b.newValue + b.oldValue), 0);
  const axisMax = LADDER.find((v) => v >= dataMax) ?? Math.max(dataMax, 10);
  const ticks = LADDER.filter((v) => v <= axisMax);
  if (!ticks.includes(axisMax)) ticks.push(axisMax);

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
            const total = bar.newValue + bar.oldValue;
            const newH = bar.newValue > 0 ? Math.max(2, (bar.newValue / axisMax) * 100) : 0;
            const oldH = bar.oldValue > 0 ? Math.max(2, (bar.oldValue / axisMax) * 100) : 0;
            const className = ['bar-chart__col', bar.isToday ? 'bar-chart__col--today' : '']
              .filter(Boolean)
              .join(' ');

            return (
              <div
                key={bar.day}
                className={className}
                title={`Day ${bar.day}: ${formatCount(total)} follows · new accounts ${formatCount(
                  bar.newValue,
                )}, old accounts ${formatCount(bar.oldValue)}${bar.isFuture ? ' (upcoming)' : ''}`}
              >
                <div className="bar-chart__bar-wrap">
                  {total > 0 && <span className="bar-chart__value">{formatCount(total)}</span>}
                  {bar.newValue > 0 && (
                    <span className="bsky-bar bsky-bar--new" style={{ height: `${newH}%` }} />
                  )}
                  {bar.oldValue > 0 && (
                    <span className="bsky-bar bsky-bar--old" style={{ height: `${oldH}%` }} />
                  )}
                </div>
                <span className="bar-chart__label">{bar.day}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
