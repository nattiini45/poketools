"use client";

import { useMemo } from "react";
import { useCasterData } from "../tracker/CasterDataContext";
import { analyzeWinConditions } from "@/lib/broadcast/win-conditions";
import { useDataLocale, useLocale, useT } from "@/i18n/client";
import { broadcastCasterMessages } from "@/i18n/messages/broadcast-caster";

const TYPE_ICONS: Record<string, string> = {
  sweeper: "⚔",
  speed_advantage: "⚡",
  no_answer: "⚠",
  defensive_core: "🛡",
};

const IMPORTANCE_COLORS: Record<number, string> = {
  5: "text-red-400 bg-red-500/10 border-red-500/30",
  4: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  3: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  2: "text-poke-text-secondary bg-poke-surface border-poke-border/30",
  1: "text-poke-text-muted bg-poke-surface border-poke-border/20",
};

export default function WinConditions() {
  const t = useT(broadcastCasterMessages);
  const locale = useLocale();
  const dataLocale = useDataLocale();
  const data = useCasterData();

  const conditions = useMemo(() => {
    if (!data) return [];
    return analyzeWinConditions(
      data.player1.pokemon,
      data.player2.pokemon,
      data.player1.name,
      data.player2.name,
      locale,
      dataLocale
    );
  }, [data, locale, dataLocale]);

  if (!data || conditions.length === 0) {
    return (
      <div className="text-xs text-poke-text-secondary text-center py-4">
        {t("winConditions.needBothTeams")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {conditions.map((cond, i) => {
        const colors = IMPORTANCE_COLORS[cond.importance] ?? IMPORTANCE_COLORS[1];
        return (
          <div
            key={i}
            className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border ${colors}`}
          >
            <span className="text-sm flex-shrink-0">
              {TYPE_ICONS[cond.type] ?? "•"}
            </span>
            <div className="min-w-0">
              <div className="text-xs font-medium">{cond.description}</div>
              <div className="text-[10px] text-poke-text-muted mt-0.5">
                {cond.player === 1 ? data.player1.name : data.player2.name} •{" "}
                {t(`winConditions.type.${cond.type}`)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
