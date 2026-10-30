'use client';

import { useMemo } from 'react';
import { useDataLocale, useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { localizeStat } from '@/lib/pkmn/i18n/names/misc';
import { useEditorContext } from '../editor/EditorContext';
import { useSpeciesData } from '../hooks/useSpeciesData';
import SpreadPresets from './SpreadPresets';
import { NATURE_DATA } from '../constants';
import type { PokemonSet, StatSpread } from '@/types/team';
import { toBoundedInt } from '@/lib/pkmn/set-bounds';

const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
type StatKey = (typeof STAT_KEYS)[number];

const NATURE_EFFECTS = Object.fromEntries(
  NATURE_DATA
    .filter(([, plus]) => plus !== '')
    .map(([name, plus, minus]) => [name, { plus, minus }]),
) as Record<string, { plus: string; minus: string }>;

const BAR_COLORS: Record<StatKey, string> = {
  hp: 'bg-green-500',
  atk: 'bg-red-400',
  def: 'bg-orange-400',
  spa: 'bg-blue-400',
  spd: 'bg-teal-400',
  spe: 'bg-yellow-400',
};

function calcStat(base: number, ev: number, iv: number, level: number, stat: StatKey, nature: string): number {
  const n = NATURE_EFFECTS[nature];
  const multiplier = n ? (n.plus === stat ? 1.1 : n.minus === stat ? 0.9 : 1) : 1;
  if (stat === 'hp') {
    if (base === 1) return 1; // Shedinja
    return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
  }
  return Math.floor(
    (Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5) * multiplier,
  );
}

interface StatEditorProps {
  slot: number;
  set: PokemonSet;
}

export default function StatEditor({ slot, set }: StatEditorProps) {
  const { state, dispatch } = useEditorContext();
  const { data: speciesData } = useSpeciesData(set.species, state.generation);
  const t = useT(teambuilderIntelMessages);
  const dl = useDataLocale();

  const baseStats: StatSpread = speciesData?.info?.baseStats ?? {
    hp: 50, atk: 50, def: 50, spa: 50, spd: 50, spe: 50,
  };
  const evs: StatSpread = useMemo(
    () => set.evs ?? { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    [set.evs],
  );
  const ivs: StatSpread = set.ivs ?? { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const level = set.level ?? 100;
  const nature = set.nature ?? '';

  const totalEvs = useMemo(
    () => STAT_KEYS.reduce((sum, k) => sum + (evs[k] ?? 0), 0),
    [evs],
  );

  const handleEvChange = (stat: StatKey, raw: string) => {
    const requested = toBoundedInt(raw, 0, 252, 0);
    const currentForStat = evs[stat] ?? 0;
    const remaining = 510 - totalEvs + currentForStat;
    const clamped = Math.min(requested, remaining);
    dispatch({ type: 'UPDATE_SLOT', slot, patch: { evs: { ...evs, [stat]: clamped } } });
  };

  const handleIvChange = (stat: StatKey, raw: string) => {
    const val = toBoundedInt(raw, 0, 31, 0);
    dispatch({ type: 'UPDATE_SLOT', slot, patch: { ivs: { ...ivs, [stat]: val } } });
  };

  const evPercent = Math.min(100, (totalEvs / 510) * 100);
  const evOver508 = totalEvs > 508;

  return (
    <div>
      {/* Header row with EV budget bar */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] text-poke-text-muted uppercase tracking-wide">{t('statEditor.title')}</h3>
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] font-mono ${evOver508 ? 'text-yellow-400' : 'text-poke-text-muted'}`}
          >
            {t('statEditor.evTotal', { total: totalEvs })}
          </span>
          <div className="w-16 h-1.5 bg-poke-border rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${evOver508 ? 'bg-yellow-400' : 'bg-poke-blue'}`}
              style={{ width: `${evPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Column header row */}
      <div className="grid grid-cols-[3rem_2.5rem_4rem_3.5rem_3rem_1fr] items-center gap-1.5 mb-0.5">
        <div />
        <span className="text-[9px] text-poke-text-muted text-right">{t('statEditor.base')}</span>
        <span className="text-[9px] text-poke-text-muted text-center">{t('statEditor.ev')}</span>
        <span className="text-[9px] text-poke-text-muted text-center">{t('statEditor.iv')}</span>
        <span className="text-[9px] text-poke-text-muted text-right">{t('statEditor.total')}</span>
        <div />
      </div>

      {/* Stat rows */}
      <div className="space-y-1.5 mb-3">
        {STAT_KEYS.map((stat) => {
          const base = baseStats[stat] ?? 50;
          const ev = evs[stat] ?? 0;
          const iv = ivs[stat] ?? 31;
          const total = calcStat(base, ev, iv, level, stat, nature);
          const barWidth = Math.min(100, (total / 400) * 100);

          const n = NATURE_EFFECTS[nature];
          const isBoosted = n?.plus === stat;
          const isLowered = n?.minus === stat;

          return (
            <div
              key={stat}
              className="grid grid-cols-[3rem_2.5rem_4rem_3.5rem_3rem_1fr] items-center gap-1.5"
            >
              <span
                className={[
                  'text-[10px] text-right font-medium',
                  isBoosted
                    ? 'text-red-400'
                    : isLowered
                      ? 'text-blue-400'
                      : 'text-poke-text-muted',
                ].join(' ')}
              >
                {localizeStat(stat, dl, 'short')}
              </span>
              <span className="text-[10px] text-poke-text-muted font-mono text-right">{base}</span>
              <input
                type="number"
                min={0}
                max={252}
                step={1}
                value={ev}
                onChange={(e) => handleEvChange(stat, e.target.value)}
                disabled={state.locked}
                className="w-full px-1 py-0.5 text-xs text-center bg-poke-surface border border-poke-border rounded font-mono text-poke-text-primary disabled:opacity-50 focus:border-poke-focus/60 outline-none"
              />
              <input
                type="number"
                min={0}
                max={31}
                step={1}
                value={iv}
                onChange={(e) => handleIvChange(stat, e.target.value)}
                disabled={state.locked}
                className="w-full px-1 py-0.5 text-xs text-center bg-poke-surface border border-poke-border rounded font-mono text-poke-text-muted disabled:opacity-50 focus:border-poke-focus/60 outline-none"
              />
              <span
                className={[
                  'text-xs font-mono font-semibold text-right',
                  isBoosted
                    ? 'text-red-400'
                    : isLowered
                      ? 'text-blue-400'
                      : 'text-poke-text-primary',
                ].join(' ')}
              >
                {total}
              </span>
              <div className="h-2 bg-poke-border rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${BAR_COLORS[stat]}`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* EV presets */}
      {!state.locked && <SpreadPresets slot={slot} species={set.species} />}
    </div>
  );
}
