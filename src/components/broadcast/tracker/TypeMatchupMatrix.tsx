"use client";

import { useMemo } from "react";
import { useCasterData } from "./CasterDataContext";
import { getBestStabEffectiveness } from "@/lib/pkmn/type-chart";
import { useDataLocale, useT } from "@/i18n/client";
import { broadcastCasterMessages } from "@/i18n/messages/broadcast-caster";
import { localizeSpecies } from "@/lib/pkmn/i18n/names/species";

function effColor(eff: number): string {
  if (eff === 0) return "bg-gray-900 text-gray-600";
  if (eff < 1) return "bg-red-950/50 text-red-400";
  if (eff === 1) return "bg-poke-surface text-poke-text-secondary";
  if (eff === 2) return "bg-emerald-950/50 text-emerald-400";
  return "bg-emerald-900/60 text-emerald-300"; // 4x
}

function effLabel(eff: number): string {
  if (eff === 0) return "0";
  if (eff === 0.25) return "¼";
  if (eff === 0.5) return "½";
  if (eff === 1) return "1";
  if (eff === 2) return "2";
  if (eff === 4) return "4";
  return String(eff);
}

export default function TypeMatchupMatrix() {
  const t = useT(broadcastCasterMessages);
  const dataLocale = useDataLocale();
  const species = (name: string) => localizeSpecies(name, dataLocale);
  const data = useCasterData();

  const matrix = useMemo(() => {
    if (!data) return null;
    const p1 = data.player1.pokemon;
    const p2 = data.player2.pokemon;
    if (p1.length === 0 || p2.length === 0) return null;

    // P1 attacks → P2 defends (rows: P1 pokemon, cols: P2 pokemon)
    const grid = p1.map((atk) =>
      p2.map((def) => getBestStabEffectiveness(atk.types, def.types))
    );

    return { p1, p2, grid };
  }, [data]);

  if (!matrix) {
    return (
      <div className="text-xs text-poke-text-secondary text-center py-4">
        {t("matrix.needBothTeams")}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-center">
        <thead>
          <tr>
            <th className="p-1 text-[10px] text-poke-text-secondary font-normal">
              {t("matrix.corner")}
            </th>
            {matrix.p2.map((def) => (
              <th
                key={def.species}
                className="p-1 text-[10px] text-red-400 font-medium"
                title={species(def.species)}
              >
                {/* Table cells ignore max-width: truncate inside a block wrapper. */}
                <div className="max-w-[60px] truncate">{species(def.species)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.p1.map((atk, ri) => (
            <tr key={atk.species}>
              <td
                className="p-1 text-[10px] text-blue-400 font-medium text-left"
                title={species(atk.species)}
              >
                <div className="max-w-[60px] truncate">{species(atk.species)}</div>
              </td>
              {matrix.grid[ri].map((eff, ci) => (
                <td
                  key={`${ri}-${ci}`}
                  className={`p-1 text-[10px] font-bold rounded-sm ${effColor(eff)}`}
                >
                  {effLabel(eff)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex gap-3 mt-2 text-[9px] text-poke-text-secondary justify-center">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-emerald-950/50" /> {t("matrix.superEffective")}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-poke-surface" /> {t("matrix.neutral")}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-red-950/50" /> {t("matrix.notVeryEffective")}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-gray-900" /> {t("matrix.immune")}
        </span>
      </div>
    </div>
  );
}
