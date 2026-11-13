"use client";

import { useMemo } from "react";
import { Dot, Shield, Swords, TriangleAlert, Zap, type LucideIcon } from 'lucide-react';
import { useCasterData } from "../tracker/CasterDataContext";
import { analyzeWinConditions } from "@/lib/broadcast/win-conditions";
import { useDataLocale, useLocale, useT } from "@/i18n/client";
import { broadcastCasterMessages } from "@/i18n/messages/broadcast-caster";

const TYPE_ICONS: Record<string, LucideIcon> = {
  sweeper: Swords,
  speed_advantage: Zap,
  no_answer: TriangleAlert,
  defensive_core: Shield,
};

const IMPORTANCE_COLORS: Record<number, string> = {
  5: "text-loss bg-[rgb(239_68_68/0.1)] border-[rgb(239_68_68/0.3)]",
  4: "text-accent-ink bg-[rgb(249_115_22/0.1)] border-[rgb(249_115_22/0.3)]",
  3: "text-accent-ink bg-[rgb(234_179_8/0.1)] border-[rgb(234_179_8/0.3)]",
  2: "text-fg-muted bg-surface",
  1: "text-fg-muted bg-surface",
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
      <div className="text-xs text-fg-muted text-center py-4">
        {t("winConditions.needBothTeams")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {conditions.map((cond, i) => {
        const colors = IMPORTANCE_COLORS[cond.importance] ?? IMPORTANCE_COLORS[1];
        const Icon = TYPE_ICONS[cond.type] ?? Dot;
        return (
          <div
            key={i}
            className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border ${colors}`}
          >
            <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-medium">{cond.description}</div>
              <div className="text-micro text-fg-muted mt-0.5">
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
