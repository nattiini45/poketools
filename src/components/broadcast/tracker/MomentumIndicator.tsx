"use client";

import { useMemo } from "react";
import { useCasterData } from "./CasterDataContext";
import { calculateMomentum } from "@/lib/broadcast/momentum-calc";
import type { TrackerState } from "@/types/broadcast";
import { useLocale } from "@/i18n/client";

interface MomentumIndicatorProps {
  state: TrackerState;
}

export default function MomentumIndicator({ state }: MomentumIndicatorProps) {
  const locale = useLocale();
  const data = useCasterData();

  const momentum = useMemo(() => {
    if (!data) return null;

    const p1Slots = state.current_game.player1.slots;
    const p2Slots = state.current_game.player2.slots;

    return calculateMomentum(
      data.player1.pokemon,
      data.player2.pokemon,
      p1Slots.map((s) => s.was_brought),
      p2Slots.map((s) => s.was_brought),
      p1Slots.map((s) => s.was_koed),
      p2Slots.map((s) => s.was_koed),
      locale
    );
  }, [data, state, locale]);

  if (!momentum) return null;

  // Don't show if no pokemon brought yet
  const anyBrought = state.current_game.player1.slots.some((s) => s.was_brought) ||
    state.current_game.player2.slots.some((s) => s.was_brought);
  if (!anyBrought) return null;

  const leftPct = Math.max(2, Math.min(98, 50 + momentum.score / 2));

  return (
    <div className="px-2">
      <div className="h-2 rounded-full bg-gradient-to-r from-blue-500 via-poke-surface to-red-500 relative overflow-hidden">
        <div
          className="absolute top-0 w-1 h-full bg-white rounded-full shadow-sm transition-all duration-500"
          style={{ left: `${leftPct}%` }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-poke-text-muted mt-0.5">
        <span>{data?.player1.name}</span>
        <span className="text-poke-text-secondary">{momentum.label}</span>
        <span>{data?.player2.name}</span>
      </div>
    </div>
  );
}
