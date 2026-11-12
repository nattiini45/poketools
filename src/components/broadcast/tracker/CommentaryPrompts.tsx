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
  series: "bg-[rgb(168_85_247/0.15)] border-[rgb(168_85_247/0.3)] text-purple-300",
  milestone: "bg-[rgb(249_115_22/0.15)] border-[rgb(249_115_22/0.3)] text-orange-300",
  advantage: "bg-[rgb(16_185_129/0.15)] border-[rgb(16_185_129/0.3)] text-emerald-300",
  streak: "bg-[rgb(59_130_246/0.15)] border-[rgb(59_130_246/0.3)] text-blue-300",
  h2h: "bg-[rgb(6_182_212/0.15)] border-[rgb(6_182_212/0.3)] text-cyan-300",
  off_meta: "bg-[rgb(245_158_11/0.15)] border-[rgb(245_158_11/0.3)] text-amber-300",
  signature: "bg-[rgb(236_72_153/0.15)] border-[rgb(236_72_153/0.3)] text-pink-300",
  first_meeting: "bg-[rgb(99_102_241/0.15)] border-[rgb(99_102_241/0.3)] text-indigo-300",
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
      <h4 className="text-[10px] font-semibold text-fg-muted uppercase tracking-wider px-1">
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
