'use client';

import { useEffect, useState, useCallback, startTransition } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import type { ResolvedSampleSet } from '@/types/sample-sets';
import type { PokemonSet } from '@/types/team';
import { useDataLocale, useT } from '@/i18n/client';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';
import type { DataLocale, StatKey } from '@/lib/pkmn/i18n/types';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { localizeAbility } from '@/lib/pkmn/i18n/names/abilities';
import { localizeNature, localizeStat } from '@/lib/pkmn/i18n/names/misc';

/**
 * SampleSetPicker — sidebar component that fetches and displays Smogon sample sets
 * for a given species + format. One-click apply loads the resolved set into the editor.
 *
 * Features:
 * - Auto-fetches sets when species changes
 * - Groups by set name (standard Smogon sets)
 * - Shows key info: moves, item, ability, EV spread summary
 * - One-click apply → calls onApplySet with resolved PokemonSet
 * - Individual move/item/ability buttons for partial apply
 */

interface SampleSetPickerProps {
  species: string;
  format: string;
  generation: number;
  onApplySet: (set: PokemonSet) => void;
  onApplyMove: (moveName: string) => void;
  onApplyItem: (itemName: string) => void;
  onApplyAbility: (abilityName: string) => void;
}

function resolveSlash<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value;
}

const EV_KEYS: readonly StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

/** "252 Atk / 4 SpD / 252 Spe" ('en') or "252 Angr. / 4 Sp.-Vert. / 252 Init." ('de'). Display only. */
function evSpreadSummary(evs: Partial<Record<string, number>> | undefined, dl: DataLocale): string {
  if (!evs) return '';
  const parts: string[] = [];
  for (const key of EV_KEYS) {
    const val = evs[key];
    if (val && val > 0) parts.push(`${val} ${localizeStat(key, dl)}`);
  }
  return parts.join(' / ');
}

export default function SampleSetPicker({
  species,
  format,
  generation,
  onApplySet,
  onApplyMove,
  onApplyItem,
  onApplyAbility,
}: SampleSetPickerProps) {
  const t = useT(teambuilderMessages);
  const dl = useDataLocale();
  const [sets, setSets] = useState<ResolvedSampleSet[]>([]);
  const [loading, setLoading] = useState(false);
  // Only one failure is possible here, so a flag: the text is translated at render.
  const [error, setError] = useState(false);

  // Fetch sample sets via the public API route.
  // Uses a cancelled flag to discard stale results.
  useEffect(() => {
    if (!species) return;
    let cancelled = false;
    startTransition(() => {
      setLoading(true);
      setError(false);
    });

    const params = new URLSearchParams({ pokemon: species });
    if (generation) params.set('generation', String(generation));
    if (format) params.set('format', format);

    fetch(`/api/sample-sets?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch');
        return res.json();
      })
      .then((body) => {
        if (!cancelled && body.success && body.data) {
          setSets(body.data.sets ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [species, format, generation]);

  const handleApplyFullSet = useCallback((resolved: ResolvedSampleSet) => {
    onApplySet(resolved.pokemon_set);
  }, [onApplySet]);

  if (!species) return null;

  return (
    <div className="p-3">
      <h3 className="text-xs font-heading font-semibold text-poke-text-secondary mb-2">
        {t('sampleSets.title')}
      </h3>

      {loading && (
        <div className="text-xs text-poke-text-muted py-4 text-center">
          {t('sampleSets.loading')}
        </div>
      )}

      {error && (
        <div className="text-xs text-poke-danger py-2">
          {t('errors.sampleSetsFailed')}
        </div>
      )}

      {!loading && !error && sets.length === 0 && (
        <div className="text-xs text-poke-text-muted py-4 text-center">
          {t('sampleSets.empty')}
        </div>
      )}

      <div className="space-y-2">
        {sets.map((resolved, idx) => {
          const moveset = resolved.raw_moveset;
          const resolvedMoves = moveset.moves.map((m) => resolveSlash(m));
          const resolvedItem = resolveSlash(moveset.item);
          const resolvedAbility = resolveSlash(moveset.ability);
          const resolvedNature = resolveSlash(moveset.nature);

          return (
            <div
              key={`${resolved.set_name}-${idx}`}
              className="border border-poke-border rounded-poke-md p-2 bg-poke-surface hover:border-poke-blue/40 transition-colors"
            >
              {/* Set header */}
              <div className="flex items-center gap-2 mb-2">
                <PokemonSprite name={species} size={32} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate" lang="en">{resolved.set_name}</p>
                  {resolved.description && (
                    <p className="text-[10px] text-poke-text-muted truncate" lang="en">
                      {resolved.description}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleApplyFullSet(resolved)}
                  className="px-2 py-1 text-[10px] bg-poke-blue/10 text-poke-blue rounded hover:bg-poke-blue/20 transition-colors font-medium"
                  title={t('sampleSets.applyFullSet')}
                >
                  {t('sampleSets.apply')}
                </button>
              </div>

              {/* Item + Ability */}
              <div className="flex flex-wrap gap-1 mb-1.5">
                {resolvedItem && (
                  <button
                    onClick={() => onApplyItem(resolvedItem)}
                    className="text-[10px] px-1.5 py-0.5 bg-poke-muted rounded hover:bg-poke-blue/20 transition-colors"
                    title={t('sampleSets.applyItem')}
                  >
                    {localizeItem(resolvedItem, dl)}
                  </button>
                )}
                {resolvedAbility && (
                  <button
                    onClick={() => onApplyAbility(resolvedAbility)}
                    className="text-[10px] px-1.5 py-0.5 bg-poke-muted rounded hover:bg-poke-blue/20 transition-colors"
                    title={t('sampleSets.applyAbility')}
                  >
                    {localizeAbility(resolvedAbility, dl)}
                  </button>
                )}
                {resolvedNature && (
                  <span className="text-[10px] px-1.5 py-0.5 text-poke-text-muted">
                    {localizeNature(resolvedNature, dl)}
                  </span>
                )}
              </div>

              {/* EV spread */}
              {moveset.evs && (
                <p className="text-[10px] text-poke-text-muted mb-1.5 font-mono">
                  {evSpreadSummary(moveset.evs, dl)}
                </p>
              )}

              {/* Moves */}
              <div className="flex flex-wrap gap-1">
                {resolvedMoves.map((move, i) => (
                  <button
                    key={i}
                    onClick={() => onApplyMove(move)}
                    className="text-[10px] px-1.5 py-0.5 bg-poke-blue/5 text-poke-text-secondary rounded hover:bg-poke-blue/20 transition-colors"
                    title={t('sampleSets.applyMove')}
                  >
                    {localizeMove(move, dl)}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
