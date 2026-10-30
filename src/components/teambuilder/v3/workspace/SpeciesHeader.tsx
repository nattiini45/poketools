'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';
import TypeBadge from '@/components/shared/TypeBadge';
import TeraTypePicker from './TeraTypePicker';
import { useDataLocale, useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { localizeStat } from '@/lib/pkmn/i18n/names/misc';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { useEditorContext } from '../editor/EditorContext';
import { useSpeciesData } from '../hooks/useSpeciesData';
import type { PokemonSet } from '@/types/team';
import { toBoundedInt } from '@/lib/pkmn/set-bounds';

interface SpeciesHeaderProps {
  slot: number;
  set: PokemonSet;
  /** Opens the SpeciesPicker to swap this slot's species */
  onChangeSpecies: () => void;
}

/**
 * SpeciesHeader — sprite, species name (click to change), types, base stat
 * summary, nickname/level/shiny inputs, and the Tera type picker.
 * Species selection itself lives in SpeciesPicker.
 */
export default function SpeciesHeader({ slot, set, onChangeSpecies }: SpeciesHeaderProps) {
  const { state, dispatch } = useEditorContext();
  const { data: speciesData } = useSpeciesData(set.species, state.generation);
  const t = useT(teambuilderIntelMessages);
  const dl = useDataLocale();
  const speciesName = localizeSpecies(set.species, dl);

  const types = speciesData?.info?.types ?? [];
  const baseStats = speciesData?.info?.baseStats;

  return (
    <div className="flex items-start gap-4">
      {/* Sprite */}
      <div className="shrink-0">
        <PokemonSprite name={set.species} size={80} animated />
      </div>

      {/* Info block */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <button
            onClick={() => {
              if (!state.locked) onChangeSpecies();
            }}
            disabled={state.locked}
            className="text-lg font-heading font-bold text-poke-text-primary hover:text-poke-blue transition-colors disabled:cursor-default disabled:hover:text-poke-text-primary"
            aria-label={t('speciesHeader.changeSpeciesAria', { species: speciesName })}
            title={t('speciesHeader.changeSpecies')}
          >
            {speciesName}
          </button>
          {!state.locked && (
            <button
              onClick={onChangeSpecies}
              className="text-[10px] text-poke-text-muted hover:text-poke-blue transition-colors"
            >
              {t('speciesHeader.change')}
            </button>
          )}
        </div>

        {/* Type badges */}
        {types.length > 0 && (
          <div className="flex gap-1 mb-2">
            {types.map((t) => (
              <TypeBadge key={t} type={t} className="!text-[9px] !px-1.5 !py-0.5" />
            ))}
          </div>
        )}

        {/* Base stat summary */}
        {baseStats && (
          <div className="flex flex-wrap gap-2.5 text-[10px] text-poke-text-muted mb-2">
            {(['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const).map((s) => (
              <span key={s} className="flex flex-col items-center leading-none">
                <span className="uppercase opacity-60">{localizeStat(s, dl, 'short')}</span>
                <span className="font-mono mt-0.5">{baseStats[s]}</span>
              </span>
            ))}
          </div>
        )}

        {/* Nickname, level, shiny */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <input
            type="text"
            value={set.name || ''}
            onChange={(e) =>
              dispatch({ type: 'UPDATE_SLOT', slot, patch: { name: e.target.value } })
            }
            placeholder={t('speciesHeader.nickname')}
            maxLength={24}
            disabled={state.locked}
            className="w-24 px-2 py-1 text-xs bg-poke-surface border border-poke-border rounded text-poke-text-primary placeholder:text-poke-text-muted disabled:opacity-50 focus:border-poke-focus/60 outline-none"
          />
          <label className="flex items-center gap-1 text-xs text-poke-text-muted">
            {t('speciesHeader.level')}
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={set.level ?? 100}
              onChange={(e) => {
                const v = toBoundedInt(e.target.value, 1, 100, 100);
                dispatch({ type: 'UPDATE_SLOT', slot, patch: { level: v } });
              }}
              disabled={state.locked}
              className="w-12 px-2 py-1 text-xs bg-poke-surface border border-poke-border rounded text-poke-text-primary disabled:opacity-50 focus:border-poke-focus/60 outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-poke-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!set.shiny}
              onChange={(e) =>
                dispatch({ type: 'UPDATE_SLOT', slot, patch: { shiny: e.target.checked } })
              }
              disabled={state.locked}
              className="accent-poke-blue"
            />
            {t('speciesHeader.shiny')}
          </label>
        </div>
      </div>

      {/* Tera type picker */}
      {state.generation >= 9 && (
        <div className="shrink-0">
          <div className="text-[10px] text-poke-text-muted uppercase tracking-wide mb-1">{t('speciesHeader.tera')}</div>
          <TeraTypePicker
            value={set.tera_type ?? null}
            species={set.species}
            onChange={(t) =>
              dispatch({ type: 'UPDATE_SLOT', slot, patch: { tera_type: t ?? undefined } })
            }
            disabled={state.locked}
          />
        </div>
      )}
    </div>
  );
}
