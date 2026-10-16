'use client';

import { useEffect, useState, useCallback } from 'react';
import { useCastStudio } from '../CastStudioContext';
import { getSpriteUrl } from '@/lib/pkmn/sprites';
import type { UsageListItem } from '@/types/usage';
import { EMPTY_SET } from '../CastTeamStrip';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { errorsStats } from '@/i18n/messages/errors';
import { creatorStudioMessages } from '@/i18n/messages/creator/studio';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

/**
 * SoloMetaPanel — collapsible panel showing top usage Pokémon for the
 * selected format. Clicking a Pokémon fills the next empty opponent slot.
 */
export default function SoloMetaPanel() {
  const { state, updatePlayer2Set } = useCastStudio();
  const t = useT(creatorStudioMessages);
  const dataLocale = useDataLocale();
  const formatter = useFormatter();
  const errorText = useApiErrorText(errorsStats);
  const [collapsed, setCollapsed] = useState(true);
  const [pokemon, setPokemon] = useState<UsageListItem[]>([]);
  const [loading, setLoading] = useState(false);
  /** The API's error, or `{}` when the request itself failed. Translated at render time. */
  const [error, setError] = useState<ApiErrorLike | null>(null);

  const format = state.format;

  const fetchUsage = useCallback(async (fmt: string, signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/usage-stats?format=${encodeURIComponent(fmt)}&limit=20`,
        { signal },
      );
      const json = await res.json();
      if (signal.aborted) return;
      if (json.success && json.data?.pokemon) {
        setPokemon(json.data.pokemon);
      } else {
        setPokemon([]);
        if (json.error || json.code) setError(toApiErrorLike(json));
      }
    } catch {
      if (!signal.aborted) setError({});
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (format === 'blank' || collapsed) return;
    const ac = new AbortController();
    fetchUsage(format, ac.signal);
    return () => ac.abort();
  }, [format, collapsed, fetchUsage]);

  const handleAddToOpponent = useCallback((speciesName: string) => {
    // Find the first empty slot in the opponent team
    const team = state.player2Team;
    const emptyIndex = team.length < 6
      ? team.length
      : team.findIndex((s) => !s.species);
    if (emptyIndex === -1) return; // Team is full

    updatePlayer2Set(emptyIndex, { ...EMPTY_SET, species: speciesName, name: speciesName });
  }, [state.player2Team, updatePlayer2Set]);

  if (format === 'blank') return null;

  return (
    <div className="rounded-poke-lg border border-poke-border bg-poke-surface">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-2 text-left"
      >
        <span className="font-heading text-sm font-bold text-poke-text-secondary uppercase tracking-wide">
          {t('solo.meta.title')}
        </span>
        <span className="text-poke-text-secondary text-xs">
          {collapsed ? '▶' : '▼'}
        </span>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 border-t border-poke-border pt-3">
          {loading && (
            <p className="text-xs text-poke-text-secondary animate-pulse">{t('solo.meta.loading')}</p>
          )}
          {error && (
            <p className="text-xs text-red-400">
              {error.error || error.code ? errorText(error) : t('solo.meta.loadFailed')}
            </p>
          )}
          {!loading && pokemon.length === 0 && !error && (
            <p className="text-xs text-poke-text-secondary">{t('solo.meta.empty')}</p>
          )}
          {pokemon.length > 0 && (
            <div className="grid grid-cols-2 gap-1 max-h-[360px] overflow-y-auto">
              {pokemon.map((p) => {
                const name = localizeSpecies(p.pokemon_name, dataLocale);
                return (
                  <button
                    key={p.pokemon_name}
                    onClick={() => handleAddToOpponent(p.pokemon_name)}
                    className="flex items-center gap-2 rounded-poke-md px-2 py-1 text-left hover:bg-poke-accent/10 transition-colors group"
                    title={t('solo.meta.addToOpponent', { pokemon: name })}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={getSpriteUrl(p.pokemon_name)}
                      alt={name}
                      className="w-8 h-8"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-heading font-bold text-poke-text-primary block truncate">
                        {name}
                      </span>
                      <span className="text-[10px] text-poke-text-secondary">
                        {formatter.percent(p.usage_pct, 1)}
                      </span>
                    </div>
                    <span className="text-poke-accent text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                      +
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
