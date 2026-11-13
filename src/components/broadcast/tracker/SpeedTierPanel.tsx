"use client";

import { useState, useMemo } from "react";
import { useCasterData } from "./CasterDataContext";
import type { CasterPokemonInfo } from "@/types/caster";
import { useDataLocale, useT } from "@/i18n/client";
import { broadcastCasterMessages } from "@/i18n/messages/broadcast-caster";
import { localizeSpecies } from "@/lib/pkmn/i18n/names/species";

type SpeedMode = "base" | "max" | "scarf";

interface SpeedEntry {
  species: string;
  speed: number;
  player: 1 | 2;
  types: string[];
}

export default function SpeedTierPanel() {
  const t = useT(broadcastCasterMessages);
  const dataLocale = useDataLocale();
  const data = useCasterData();
  const [mode, setMode] = useState<SpeedMode>("max");

  const entries = useMemo(() => {
    if (!data) return [];
    const list: SpeedEntry[] = [];

    function add(pokemon: CasterPokemonInfo[], player: 1 | 2) {
      for (const p of pokemon) {
        let speed: number;
        if (mode === "base") speed = p.baseStats.spe;
        else if (mode === "max") speed = p.speedTiers.max.raw;
        else speed = p.speedTiers.scarf.final;

        list.push({ species: p.species, speed, player, types: p.types });
      }
    }

    add(data.player1.pokemon, 1);
    add(data.player2.pokemon, 2);
    return list.sort((a, b) => b.speed - a.speed);
  }, [data, mode]);

  if (!data) {
    return (
      <div className="text-xs text-fg-muted text-center py-4">
        {t("speedTiers.noData")}
      </div>
    );
  }

  const maxSpeed = entries[0]?.speed ?? 1;

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="flex gap-1">
        {(["base", "max", "scarf"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
              mode === m
                ? "bg-accent-fill text-tier-ink"
                : "bg-elevated text-fg-muted hover:text-fg"
            }`}
          >
            {t(`speedTiers.mode.${m}`)}
          </button>
        ))}
      </div>

      {/* Speed bars */}
      <div className="space-y-1">
        {entries.map((entry, i) => {
          const width = Math.max((entry.speed / maxSpeed) * 100, 8);
          const color = entry.player === 1 ? "bg-sunken" : "bg-loss-bg";
          // Check for speed ties
          const isTied = entries.some(
            (e, j) => j !== i && e.speed === entry.speed && e.player !== entry.player
          );

          return (
            <div key={`${entry.species}-${entry.player}`} className="flex items-center gap-2">
              <span
                className={`w-20 text-xs truncate font-medium ${
                  entry.player === 1 ? "text-accent-ink" : "text-loss"
                }`}
              >
                {localizeSpecies(entry.species, dataLocale)}
              </span>
              <div className="flex-1 h-4 bg-surface rounded overflow-hidden relative">
                <div
                  className={`h-full ${color} rounded transition-all duration-300 ${
                    isTied ? "opacity-70 border-r-2 border-hairline-strong" : ""
                  }`}
                  style={{ width: `${width}%` }}
                />
              </div>
              <span
                className={`w-10 text-xs font-mono text-right ${
                  isTied ? "text-accent-ink font-bold" : "text-fg-muted"
                }`}
              >
                {entry.speed}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
