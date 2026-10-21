'use client';

import type { PokemonSet } from '@/types/team';
import { calcStat, getNatureModifier, getNatureLabel, getStatBarColor, getStatBarWidth, SHOWDOWN_MAX_STATS, STAT_KEYS } from '@/lib/pkmn/stat-calc';
import { useDataLocale } from '@/i18n/client';
import { localizeStat } from '@/lib/pkmn/i18n/names/misc';

// Shared stat display (base-stat bars with the computed stats of a set).
export { getNatureModifier, getNatureLabel };

/* ─── Stat display constants ───────────────────────────────────────── */

export interface BaseStats {
  hp: number; atk: number; def: number; spa: number; spd: number; spe: number;
}

/* ─── Component ────────────────────────────────────────────────────── */

interface StatDisplayProps {
  set: PokemonSet;
  /** Base stats for the Pokémon species, provided by the parent */
  baseStats: BaseStats | null;
  /** Compact mode for TeamDisplay cards */
  compact?: boolean;
  className?: string;
}

export default function StatDisplay({ set, baseStats, compact = false, className = '' }: StatDisplayProps) {
  const dataLocale = useDataLocale();
  // German short labels ("Sp.-Angr.") are wider than the English ones ("SpA"); widen only the label column.
  const wideLabels = dataLocale !== 'en';

  if (!baseStats) return null;

  const level = set.level || 100;

  return (
    <div className={`space-y-1 ${className}`}>
      {STAT_KEYS.map((stat) => {
        const base = baseStats[stat];
        const iv = set.ivs?.[stat] ?? 31;
        const ev = set.evs?.[stat] ?? 0;
        const natureMod = getNatureModifier(set.nature, stat);
        const final = calcStat(stat, base, iv, ev, level, natureMod);
        const maxStat = SHOWDOWN_MAX_STATS[stat];
        const width = getStatBarWidth(final, maxStat); // 0–180
        const cssWidth = Math.min((width / 180) * 100, 100);
        const { background } = getStatBarColor(final, maxStat);

        const isBoost = natureMod > 1;
        const isReduce = natureMod < 1;

        // Nature indicator: color the stat label + value
        let textColor = '';
        if (isBoost) textColor = 'text-poke-type-fire';
        if (isReduce) textColor = 'text-poke-type-water';

        if (compact) {
          return (
            <div key={stat} className="flex items-center gap-1">
              <span className={`${wideLabels ? 'w-12 whitespace-nowrap' : 'w-7'} text-[10px] font-semibold ${textColor || 'text-poke-text-muted'}`}>
                {localizeStat(stat, dataLocale, 'short')}
              </span>
              <div className="flex-1 h-1.5 bg-poke-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${cssWidth}%`, backgroundColor: background }}
                />
              </div>
              <span className={`w-7 text-[10px] text-right font-mono ${textColor || 'text-poke-text-muted'}`}>
                {final}
              </span>
            </div>
          );
        }

        return (
          <div key={stat} className="flex items-center gap-2">
            <span className={`${wideLabels ? 'w-16 whitespace-nowrap' : 'w-8'} text-xs font-semibold ${textColor || 'text-poke-text-secondary'}`}>
              {localizeStat(stat, dataLocale, 'short')}
            </span>
            <span className="w-8 text-xs text-poke-text-muted text-right font-mono">{base}</span>
            <div className="flex-1 h-3 bg-poke-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${cssWidth}%`, backgroundColor: background }}
              />
            </div>
            <span className={`w-8 text-xs text-right font-mono font-semibold ${textColor || 'text-poke-text-primary'}`}>
              {final}
            </span>
            {(isBoost || isReduce) && (
              <span className={`text-[10px] ${textColor}`}>
                {isBoost ? '▲' : '▼'}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}