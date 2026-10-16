"use client";

import CountUpNumber from "@/components/shared/CountUpNumber";

interface MatchScoreDisplayProps {
  score1: number;
  score2: number;
  /** False renders the final numbers at once (an off-screen capture copy never scrolls into view). */
  animate?: boolean;
}

export default function MatchScoreDisplay({ score1, score2, animate = true }: MatchScoreDisplayProps) {
  return (
    <div className="flex gap-1.5 sm:gap-3 text-xl sm:text-3xl font-bold mt-3 text-poke-text-primary">
      {animate ? <CountUpNumber value={score1} /> : <span>{score1}</span>}
      <span className="text-poke-text-muted">–</span>
      {animate ? <CountUpNumber value={score2} /> : <span>{score2}</span>}
    </div>
  );
}
