"use client";

import type { GameSummary } from "@/types/match";
import { useCasterData } from "./CasterDataContext";
import { useT } from "@/i18n/client";
import { broadcastCasterMessages } from "@/i18n/messages/broadcast-caster";

interface MomentumTimelineProps {
  gamesSubmitted: GameSummary[];
}

export default function MomentumTimeline({ gamesSubmitted }: MomentumTimelineProps) {
  const t = useT(broadcastCasterMessages);
  const data = useCasterData();
  if (!data || gamesSubmitted.length === 0) return null;

  const width = 280;
  const height = 32;
  const gameWidth = width / Math.max(gamesSubmitted.length, 1);

  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-blue-400 font-medium w-12 text-right truncate">
        {data.player1.name}
      </span>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Center line */}
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="currentColor" strokeWidth={0.5} className="text-poke-border/30" />

        {/* Game segments */}
        {gamesSubmitted.map((game, i) => {
          const x = i * gameWidth;
          const isP1Win = game.winner_id === data.player1.id;
          const cy = isP1Win ? height / 2 - 8 : height / 2 + 8;
          const color = isP1Win ? "#3b82f6" : "#ef4444";

          return (
            <g key={game.id}>
              {/* Divider */}
              {i > 0 && (
                <line
                  x1={x}
                  y1={2}
                  x2={x}
                  y2={height - 2}
                  stroke="currentColor"
                  strokeWidth={0.5}
                  className="text-poke-border/20"
                />
              )}
              {/* Game dot */}
              <circle
                cx={x + gameWidth / 2}
                cy={cy}
                r={4}
                fill={color}
                opacity={0.8}
              />
              {/* Game number */}
              <text
                x={x + gameWidth / 2}
                y={height / 2 + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={7}
                className="fill-poke-text-muted"
              >
                {t("tracker.timelineGame", { game: game.game_number })}
              </text>
            </g>
          );
        })}
      </svg>
      <span className="text-[9px] text-red-400 font-medium w-12 truncate">
        {data.player2.name}
      </span>
    </div>
  );
}
