"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCasterPlayerPokemon } from "./CasterDataContext";
import { useDataLocale, useFormatter, useT } from "@/i18n/client";
import { broadcastCasterMessages } from "@/i18n/messages/broadcast-caster";
import { localizeSpecies } from "@/lib/pkmn/i18n/names/species";

interface BringLeadStatsProps {
  player: 1 | 2;
}

export default function BringLeadStats({ player }: BringLeadStatsProps) {
  const t = useT(broadcastCasterMessages);
  const dataLocale = useDataLocale();
  const formatter = useFormatter();
  const pokemon = useCasterPlayerPokemon(player);
  const [collapsed, setCollapsed] = useState(true);

  // Only show if we have prediction data
  const hasData = pokemon.some((p) => p.bringPct !== null || p.leadPct !== null);
  if (!hasData) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="text-micro text-fg-muted hover:text-fg transition-colors px-1"
      >
        {collapsed ? <ChevronRight aria-hidden="true" className="inline size-3" /> : <ChevronDown aria-hidden="true" className="inline size-3" />} {t("bringLead.title")}
      </button>
      {!collapsed && (
        <div className="mt-1 space-y-1 px-1">
          {pokemon
            .filter((p) => p.bringPct !== null || p.leadPct !== null)
            .sort((a, b) => (b.bringPct ?? 0) - (a.bringPct ?? 0))
            .map((p) => (
              <div key={p.species} className="flex items-center gap-2">
                <span className="w-16 text-micro text-fg truncate font-medium">
                  {localizeSpecies(p.species, dataLocale)}
                </span>
                <div className="flex-1 space-y-0.5">
                  {/* Bring bar */}
                  {p.bringPct !== null && (
                    <div className="flex items-center gap-1">
                      <span className="text-micro text-fg-muted w-6">{t("bringLead.bringShort")}</span>
                      <div className="flex-1 h-2 bg-surface rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[rgb(16_185_129/0.6)] rounded-full"
                          style={{ width: `${Math.min(p.bringPct, 100)}%` }}
                        />
                      </div>
                      <span className="text-micro font-mono text-fg-muted min-w-[2rem] shrink-0 whitespace-nowrap text-right">
                        {formatter.percentOf(p.bringPct)}
                      </span>
                    </div>
                  )}
                  {/* Lead bar */}
                  {p.leadPct !== null && (
                    <div className="flex items-center gap-1">
                      <span className="text-micro text-fg-muted w-6">{t("bringLead.leadShort")}</span>
                      <div className="flex-1 h-2 bg-surface rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[rgb(234_179_8/0.6)] rounded-full"
                          style={{ width: `${Math.min(p.leadPct, 100)}%` }}
                        />
                      </div>
                      <span className="text-micro font-mono text-fg-muted min-w-[2rem] shrink-0 whitespace-nowrap text-right">
                        {formatter.percentOf(p.leadPct)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
