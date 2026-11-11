'use client';

import type { RatingHistoryEntry } from '@/types/rating';
import { useFormatter, useT } from '@/i18n/client';
import { gamificationMessages } from '@/i18n/messages/gamification';

interface RatingHistoryChartProps {
  history: RatingHistoryEntry[];
}

/** Tick distances for the rating axis; the smallest one that fits the values into four steps or fewer is used. */
const TICK_STEPS = [25, 50, 100, 200, 250, 500, 1000, 2000];

export default function RatingHistoryChart({ history }: RatingHistoryChartProps) {
  const t = useT(gamificationMessages);
  const formatter = useFormatter();
  if (history.length === 0) {
    return <p className="text-body text-fg-muted">{t('ratingHistory.empty')}</p>;
  }

  const points = [...history].sort((a, b) => {
    return new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime();
  });

  const values = points.flatMap((point) => [
    point.rating_after,
    point.rating_after - point.rd_after * 2,
    point.rating_after + point.rd_after * 2,
  ]);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const step =
    TICK_STEPS.find((candidate) => Math.ceil(maxValue / candidate) - Math.floor(minValue / candidate) <= 4) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const yMin = Math.floor(minValue / step) * step;
  const yMax = Math.max(Math.ceil(maxValue / step) * step, yMin + step);
  const yRange = yMax - yMin;
  // Grid lines from the top value down, as a share of the plot height.
  const grid = Array.from({ length: Math.round(yRange / step) + 1 }, (_, index) => (index * step) / yRange);

  // The plot is a 100 x 100 box stretched to the element, so every coordinate is a percentage.
  const toX = (index: number) => (points.length > 1 ? (index / (points.length - 1)) * 100 : 50);
  const toY = (value: number) => Math.max(0, Math.min(100, 100 - ((value - yMin) / yRange) * 100));

  const chartPoints = points.map((point, index) => ({
    x: toX(index),
    ratingY: toY(point.rating_after),
    upperY: toY(point.rating_after + point.rd_after * 2),
    lowerY: toY(point.rating_after - point.rd_after * 2),
  }));

  const linePath = chartPoints.map((point) => `${point.x},${point.ratingY}`).join(' ');
  const upperPath = chartPoints.map((point) => `${point.x},${point.upperY}`);
  const lowerPath = [...chartPoints].reverse().map((point) => `${point.x},${point.lowerY}`);
  const confidenceBand = [...upperPath, ...lowerPath].join(' ');

  const firstLabel = formatter.instant(points[0].recorded_at, 'date');
  const lastLabel = formatter.instant(points[points.length - 1].recorded_at, 'date');

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-subtitle font-[550] text-fg">{t('ratingHistory.title')}</h3>
        <span className="text-caption text-fg-muted">{t('ratingHistory.band')}</span>
      </figcaption>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        <div aria-hidden="true" className="relative my-2 min-w-8 font-mono text-micro text-fg-muted tabular-nums">
          {grid.map((share) => (
            <span key={share} className="absolute right-0 -translate-y-1/2" style={{ top: `${share * 100}%` }}>
              {String(Math.round(yMax - share * yRange))}
            </span>
          ))}
        </div>
        <div className="relative my-2 h-44">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
            role="img"
            aria-label={t('ratingHistory.chartAria')}
          >
            {grid.map((share) => (
              <line
                key={share}
                x1={0}
                y1={share * 100}
                x2={100}
                y2={share * 100}
                className="stroke-hairline"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <polygon points={confidenceBand} className="fill-accent-subtle stroke-none" />
            <polyline
              points={linePath}
              fill="none"
              className="stroke-accent-ink"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {chartPoints.map((point, index) => (
            <span
              key={`${point.x}-${point.ratingY}`}
              aria-hidden="true"
              className={
                index === chartPoints.length - 1
                  ? 'absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent-ink'
                  : 'absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-ink'
              }
              style={{ left: `${point.x}%`, top: `${point.ratingY}%` }}
            />
          ))}
        </div>
        <div className="col-start-2 flex items-center justify-between font-mono text-micro text-fg-muted">
          <span>{firstLabel}</span>
          <span>{lastLabel}</span>
        </div>
      </div>
    </figure>
  );
}
