"use client";

import type { StatSpread } from "@/types/team";
import { useDataLocale } from "@/i18n/client";
import { localizeStat } from "@/lib/pkmn/i18n/names/misc";

interface StatRadarProps {
  stats: StatSpread;
  size?: number;
}

const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"] as const satisfies readonly (keyof StatSpread)[];
const MAX_STAT = 200;

function point(cx: number, cy: number, r: number, i: number): [number, number] {
  const angle = (Math.PI / 3) * i - Math.PI / 2;
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function polygon(cx: number, cy: number, values: number[]): string {
  return values
    .map((v, i) => {
      const r = (Math.min(v, MAX_STAT) / MAX_STAT) * (cx - 4);
      const [x, y] = point(cx, cy, r, i);
      return `${x},${y}`;
    })
    .join(" ");
}

export default function StatRadar({ stats, size = 80 }: StatRadarProps) {
  const dataLocale = useDataLocale();
  const cx = size / 2;
  const cy = size / 2;
  const r = cx - 4;
  const values = STAT_KEYS.map((k) => stats[k]);
  const total = values.reduce((s, v) => s + v, 0);

  // Color: low BST → cool blue, high BST → warm orange/red
  const t = Math.min(total / 720, 1);
  const hue = Math.round(210 - t * 180); // 210 (blue) → 30 (orange)
  const fillColor = `hsla(${hue}, 70%, 55%, 0.35)`;
  const strokeColor = `hsl(${hue}, 70%, 55%)`;

  // Background hex rings
  const rings = [0.25, 0.5, 0.75, 1].map((f) => {
    const pts = Array.from({ length: 6 }, (_, i) => {
      const [x, y] = point(cx, cy, r * f, i);
      return `${x},${y}`;
    }).join(" ");
    return pts;
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Background rings */}
      {rings.map((pts, i) => (
        <polygon
          key={i}
          points={pts}
          fill="none"
          stroke="currentColor"
          strokeWidth={0.5}
          className="text-poke-border/30"
        />
      ))}

      {/* Axis lines */}
      {Array.from({ length: 6 }, (_, i) => {
        const [x, y] = point(cx, cy, r, i);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="currentColor"
            strokeWidth={0.3}
            className="text-poke-border/20"
          />
        );
      })}

      {/* Stat polygon */}
      <polygon
        points={polygon(cx, cy, values)}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={1.5}
      />

      {/* Labels */}
      {STAT_KEYS.map((stat, i) => {
        const [x, y] = point(cx, cy, r + 2, i);
        return (
          <text
            key={stat}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={7}
            fontWeight={600}
            className="fill-poke-text-secondary"
          >
            {localizeStat(stat, dataLocale, "short")}
          </text>
        );
      })}
    </svg>
  );
}
