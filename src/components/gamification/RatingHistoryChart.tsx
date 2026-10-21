'use client';

import type { RatingHistoryEntry } from '@/types/rating';
import { useFormatter, useT } from '@/i18n/client';
import { gamificationMessages } from '@/i18n/messages/gamification';

interface RatingHistoryChartProps {
  history: RatingHistoryEntry[];
}

interface ChartPoint {
  x: number;
  ratingY: number;
  upperY: number;
  lowerY: number;
}

const WIDTH = 720;
const HEIGHT = 260;
const PADDING = 24;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export default function RatingHistoryChart({ history }: RatingHistoryChartProps) {
  const t = useT(gamificationMessages);
  const formatter = useFormatter();
  if (history.length === 0) {
    return (
      <div className="bg-poke-surface border border-poke-border rounded-poke-xl p-4 text-sm text-poke-text-tertiary">
        {t('ratingHistory.empty')}
      </div>
    );
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
  const span = Math.max(maxValue - minValue, 1);
  const yMin = minValue - span * 0.1;
  const yMax = maxValue + span * 0.1;
  const yRange = Math.max(yMax - yMin, 1);

  const xStep = points.length > 1 ? (WIDTH - PADDING * 2) / (points.length - 1) : 0;
  const toY = (value: number) => {
    const normalized = (value - yMin) / yRange;
    return clamp(HEIGHT - PADDING - normalized * (HEIGHT - PADDING * 2), PADDING, HEIGHT - PADDING);
  };

  const chartPoints: ChartPoint[] = points.map((point, index) => {
    const x = PADDING + index * xStep;
    const upper = point.rating_after + point.rd_after * 2;
    const lower = point.rating_after - point.rd_after * 2;
    return {
      x,
      ratingY: toY(point.rating_after),
      upperY: toY(upper),
      lowerY: toY(lower),
    };
  });

  const linePath = chartPoints.map((point) => `${point.x},${point.ratingY}`).join(' ');
  const upperPath = chartPoints.map((point) => `${point.x},${point.upperY}`);
  const lowerPath = [...chartPoints].reverse().map((point) => `${point.x},${point.lowerY}`);
  const confidenceBand = [...upperPath, ...lowerPath].join(' ');

  const firstLabel = formatter.instant(points[0].recorded_at, 'date');
  const lastLabel = formatter.instant(points[points.length - 1].recorded_at, 'date');

  return (
    <div className="bg-poke-surface border border-poke-border rounded-poke-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-heading font-semibold text-poke-text-primary">{t('ratingHistory.title')}</h3>
        <span className="text-xs text-poke-text-tertiary">{t('ratingHistory.band')}</span>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-56 rounded-poke-md bg-poke-elevated/30 border border-poke-border"
        role="img"
        aria-label={t('ratingHistory.chartAria')}
      >
        <line
          x1={PADDING}
          y1={HEIGHT - PADDING}
          x2={WIDTH - PADDING}
          y2={HEIGHT - PADDING}
          stroke="currentColor"
          className="text-poke-border"
          strokeWidth="1"
        />
        <line
          x1={PADDING}
          y1={PADDING}
          x2={PADDING}
          y2={HEIGHT - PADDING}
          stroke="currentColor"
          className="text-poke-border"
          strokeWidth="1"
        />

        <polygon points={confidenceBand} className="fill-poke-accent/15 stroke-none" />
        <polyline
          points={linePath}
          fill="none"
          stroke="currentColor"
          className="text-poke-accent"
          strokeWidth="2.5"
        />
        {chartPoints.map((point) => (
          <circle
            key={`${point.x}-${point.ratingY}`}
            cx={point.x}
            cy={point.ratingY}
            r={2.75}
            className="fill-poke-blue"
          />
        ))}
      </svg>
      <div className="mt-2 flex items-center justify-between text-xs text-poke-text-tertiary">
        <span>{firstLabel}</span>
        <span>{lastLabel}</span>
      </div>
    </div>
  );
}
