'use client';

import { useEffect, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCastStudio } from '../CastStudioContext';
import SpriteImg from '@/components/shared/SpriteImg';
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
    <div className="rounded-poke-lg border border-hairline bg-surface">
      <button
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        className="flex min-h-11 w-full items-center justify-between px-4 py-2 text-left focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        <span className="font-heading text-subtitle text-fg">
          {t('solo.meta.title')}
        </span>
        <span aria-hidden="true" className="text-caption text-fg-muted">
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
        </span>
      </button>

      {!collapsed && (
        <div className="border-t border-hairline px-4 pb-4 pt-3">
          {loading && (
            <p className="text-caption text-fg-muted animate-pulse">{t('solo.meta.loading')}</p>
          )}
          {error && (
            <p className="text-caption text-loss">
              {error.error || error.code ? errorText(error) : t('solo.meta.loadFailed')}
            </p>
          )}
          {!loading && pokemon.length === 0 && !error && (
            <p className="text-caption text-fg-muted">{t('solo.meta.empty')}</p>
          )}
          {pokemon.length > 0 && (
            <div className="grid grid-cols-2 gap-1 max-h-[360px] overflow-y-auto">
              {pokemon.map((p) => {
                const name = localizeSpecies(p.pokemon_name, dataLocale);
                return (
                  <button
                    key={p.pokemon_name}
                    onClick={() => handleAddToOpponent(p.pokemon_name)}
                    className="group flex items-center gap-2 rounded-poke-md px-2 py-1 text-left transition-colors hover:bg-hover"
                    title={t('solo.meta.addToOpponent', { pokemon: name })}
                  >
                    <SpriteImg
                      name={p.pokemon_name}
                      alt={name}
                      className="w-8 h-8"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="block truncate font-heading text-caption text-fg">
                        {name}
                      </span>
                      <span className="text-caption text-fg-muted">
                        {formatter.percent(p.usage_pct, 1)}
                      </span>
                    </div>
                    <span className="text-caption text-accent-ink opacity-0 group-hover:opacity-100 transition-opacity">
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
