"use client";

import { useMemo } from "react";
import { useCasterData } from "./CasterDataContext";
import { generateCommentaryPrompts, type CommentaryPrompt } from "@/lib/broadcast/commentary-prompts";
import type { TrackerState } from "@/types/broadcast";
import { useDataLocale, useLocale, useT } from "@/i18n/client";
import { broadcastCasterMessages } from "@/i18n/messages/broadcast-caster";

interface CommentaryPromptsProps {
  state: TrackerState;
  seriesScore: [number, number];
}

const TYPE_COLORS: Record<CommentaryPrompt["type"], string> = {
  series: "bg-purple-500/15 border-purple-500/30 text-purple-300",
  milestone: "bg-orange-500/15 border-orange-500/30 text-orange-300",
  advantage: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",
  streak: "bg-blue-500/15 border-blue-500/30 text-blue-300",
  h2h: "bg-cyan-500/15 border-cyan-500/30 text-cyan-300",
  off_meta: "bg-amber-500/15 border-amber-500/30 text-amber-300",
  signature: "bg-pink-500/15 border-pink-500/30 text-pink-300",
  first_meeting: "bg-indigo-500/15 border-indigo-500/30 text-indigo-300",
};

export default function CommentaryPrompts({ state, seriesScore }: CommentaryPromptsProps) {
  const t = useT(broadcastCasterMessages);
  const locale = useLocale();
  const dataLocale = useDataLocale();
  const data = useCasterData();

  const prompts = useMemo(() => {
    if (!data) return [];

    const p1 = state.current_game.player1;
    const p2 = state.current_game.player2;

    return generateCommentaryPrompts(data, {
      gameNumber: state.current_game.game_number,
      p1KOs: p1.slots.reduce((sum, s) => sum + s.kos_dealt, 0),
      p2KOs: p2.slots.reduce((sum, s) => sum + s.kos_dealt, 0),
      p1Remaining: p1.slots.filter((s) => s.was_brought && !s.was_koed).length,
      p2Remaining: p2.slots.filter((s) => s.was_brought && !s.was_koed).length,
      seriesScore,
    }, locale, dataLocale);
  }, [data, state, seriesScore, locale, dataLocale]);

  if (prompts.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <h4 className="text-[10px] font-semibold text-poke-text-secondary uppercase tracking-wider px-1">
        {t("tracker.talkingPoints")}
      </h4>
      {prompts.slice(0, 5).map((prompt, i) => (
        <div
          key={i}
          className={`px-2.5 py-1.5 rounded-lg border text-xs ${TYPE_COLORS[prompt.type]}`}
        >
          {prompt.text}
        </div>
      ))}
    </div>
  );
}
