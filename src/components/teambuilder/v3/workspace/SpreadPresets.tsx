'use client';

import { useCallback, useMemo } from 'react';
import { useDataLocale, useLocale, useT } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeNature, localizeStat } from '@/lib/pkmn/i18n/names/misc';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { useEditorContext } from '../editor/EditorContext';
import { useUsageDetail } from '../hooks/useUsageDetail';
import { NATURE_DATA } from '../constants';
import { formatUsagePct } from './usagePercent';
import type { StatSpread, PokemonSet } from '@/types/team';

type StatKey = keyof StatSpread;

interface PresetEntry {
  /** Stable React key (the English label or the Smogon spread key); never displayed. */
  id: string;
  /** How the label is built: a plain spread, or one of the named canonical presets. */
  kind: 'spread' | 'trickRoom' | 'bulky';
  evs: Partial<StatSpread>;
  /** Canonical English nature name (stored in the set). */
  nature: string;
  ivs?: Partial<StatSpread>;
  /** Stat order of the label (default: HP → Spe). */
  labelOrder?: readonly StatKey[];
  /** Usage share for meta spreads (0–1) */
  pct?: number;
}

const PRESETS: PresetEntry[] = [
  { id: '252 Atk / 252 Spe Jolly', kind: 'spread', evs: { atk: 252, spe: 252, hp: 4 }, nature: 'Jolly' },
  { id: '252 Atk / 252 Spe Adamant', kind: 'spread', evs: { atk: 252, spe: 252, hp: 4 }, nature: 'Adamant' },
  { id: '252 SpA / 252 Spe Timid', kind: 'spread', evs: { spa: 252, spe: 252, hp: 4 }, nature: 'Timid' },
  { id: '252 SpA / 252 Spe Modest', kind: 'spread', evs: { spa: 252, spe: 252, hp: 4 }, nature: 'Modest' },
  { id: '252 HP / 252 Def Bold', kind: 'spread', evs: { hp: 252, def: 252, spd: 4 }, nature: 'Bold' },
  { id: '252 HP / 252 SpD Calm', kind: 'spread', evs: { hp: 252, spd: 252, def: 4 }, nature: 'Calm' },
  {
    id: 'Trick Room (252 Atk / 252 HP)',
    kind: 'trickRoom',
    evs: { atk: 252, hp: 252, spe: 4 },
    nature: 'Brave',
    ivs: { spe: 0 },
    labelOrder: ['atk', 'hp'],
  },
  { id: 'Bulky (252 HP / 252 SpA Modest)', kind: 'bulky', evs: { hp: 252, spa: 252, spe: 4 }, nature: 'Modest' },
];

const VALID_NATURES = new Set<string>(NATURE_DATA.map(([name]) => name));
const STAT_ORDER: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

/** Parse a Smogon spread key like "Timid:0/0/0/252/4/252" */
function parseSpreadKey(key: string): { nature: string; evs: StatSpread } | null {
  const [nature, evPart] = key.split(':');
  if (!nature || !evPart || !VALID_NATURES.has(nature)) return null;
  const nums = evPart.split('/').map((n) => parseInt(n, 10));
  if (nums.length !== 6 || nums.some((n) => isNaN(n) || n < 0 || n > 252)) return null;
  const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  STAT_ORDER.forEach((stat, i) => {
    evs[stat] = nums[i];
  });
  return { nature, evs };
}

/** "252 SpA / 252 Spe": invested stats (≥ 16 EVs) with localized short stat names. */
function spreadStats(evs: Partial<StatSpread>, l: Locale, order: readonly StatKey[] = STAT_ORDER): string {
  return order
    .filter((s) => (evs[s] ?? 0) >= 16)
    .map((s) => `${evs[s]} ${localizeStat(s, l, 'short')}`)
    .join(' / ');
}

/** Short display label: "252 SpA / 252 Spe Timid" */
function spreadLabel(nature: string, evs: Partial<StatSpread>, l: Locale): string {
  return `${spreadStats(evs, l)} ${localizeNature(nature, l)}`;
}

interface SpreadPresetsProps {
  slot: number;
  species: string;
}

export default function SpreadPresets({ slot, species }: SpreadPresetsProps) {
  const { state, dispatch } = useEditorContext();
  const usageDetail = useUsageDetail(species, state.format, state.seasonId);
  const t = useT(teambuilderIntelMessages);
  const locale = useLocale();
  const dl = useDataLocale();

  // Top meta spreads for this species (with usage share)
  const metaSpreads = useMemo<PresetEntry[]>(() => {
    if (!usageDetail?.spreads) return [];
    return Object.entries(usageDetail.spreads)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 4)
      .map(([key, pct]): PresetEntry | null => {
        const parsed = parseSpreadKey(key);
        if (!parsed) return null;
        return { id: key, kind: 'spread', evs: parsed.evs, nature: parsed.nature, pct };
      })
      .filter((p): p is PresetEntry => p !== null);
  }, [usageDetail]);

  /** The localized label, built at render (never stored). */
  const labelOf = (preset: PresetEntry): string => {
    switch (preset.kind) {
      case 'trickRoom':
        return t('spreadPresets.trickRoom', {
          move: localizeMove('Trick Room', dl),
          spread: spreadStats(preset.evs, dl, preset.labelOrder),
        });
      case 'bulky':
        return t('spreadPresets.bulky', { spread: spreadLabel(preset.nature, preset.evs, dl) });
      default:
        return spreadLabel(preset.nature, preset.evs, dl);
    }
  };

  const applyPreset = useCallback(
    (preset: PresetEntry) => {
      const fullEvs: StatSpread = {
        hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0,
        ...preset.evs,
      };
      const patch: Partial<PokemonSet> = { evs: fullEvs };
      if (preset.nature) patch.nature = preset.nature;
      if (preset.ivs) {
        patch.ivs = {
          hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31,
          ...preset.ivs,
        };
      }
      dispatch({ type: 'UPDATE_SLOT', slot, patch });
    },
    [dispatch, slot],
  );

  return (
    <div className="space-y-2">
      {/* Real spreads from the meta, with usage share */}
      {metaSpreads.length > 0 && (
        <div>
          <h4 className="text-[9px] text-poke-text-muted uppercase tracking-wide mb-1.5">
            {t('spreadPresets.metaTitle', { species: localizeSpecies(species, dl) })}
          </h4>
          <div className="flex flex-col gap-1">
            {metaSpreads.map((preset) => {
              const label = labelOf(preset);
              return (
                <button
                  key={preset.id}
                  onClick={() => applyPreset(preset)}
                  className="flex items-center gap-2 px-1.5 py-0.5 text-[10px] bg-poke-surface hover:bg-poke-muted border border-poke-border rounded text-left text-poke-text-secondary hover:text-poke-text-primary transition-colors"
                  title={t('spreadPresets.applyTitle', { spread: label })}
                >
                  <span className="flex-1 truncate">{label}</span>
                  <span className="text-poke-text-muted tabular-nums shrink-0">
                    {formatUsagePct(preset.pct ?? 0, locale, 0)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Canonical quick presets */}
      <div>
        <h4 className="text-[9px] text-poke-text-muted uppercase tracking-wide mb-1.5">
          {t('spreadPresets.quickTitle')}
        </h4>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset)}
              title={labelOf(preset)}
              className="px-1.5 py-0.5 text-[10px] bg-poke-surface hover:bg-poke-muted border border-poke-border rounded text-poke-text-secondary hover:text-poke-text-primary transition-colors"
            >
              {localizeNature(preset.nature, dl)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
