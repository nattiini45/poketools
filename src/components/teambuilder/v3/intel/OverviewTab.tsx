'use client';

import { useEffect, useState, useMemo } from 'react';
import TypeBadge from '@/components/shared/TypeBadge';
import PokemonSprite from '@/components/shared/PokemonSprite';
import { useDataLocale, useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { useEditorContext } from '../editor/EditorContext';
import { useUsageDetail } from '../hooks/useUsageDetail';
import type { TeamTypeAnalysis } from '@/lib/pkmn/dex';

// Cache per sorted-species-key:gen
const analysisCache = new Map<string, TeamTypeAnalysis>();

export default function OverviewTab() {
  const { state, dispatch } = useEditorContext();
  const t = useT(teambuilderIntelMessages);
  const dl = useDataLocale();
  const species = useMemo(
    () =>
      state.team
        .filter((s): s is NonNullable<typeof s> => s !== null && !!s.species)
        .map((s) => s.species),
    [state.team],
  );

  // Usage detail per slot (fixed call count keeps the hooks rule happy)
  const d0 = useUsageDetail(state.team[0]?.species, state.format, state.seasonId);
  const d1 = useUsageDetail(state.team[1]?.species, state.format, state.seasonId);
  const d2 = useUsageDetail(state.team[2]?.species, state.format, state.seasonId);
  const d3 = useUsageDetail(state.team[3]?.species, state.format, state.seasonId);
  const d4 = useUsageDetail(state.team[4]?.species, state.format, state.seasonId);
  const d5 = useUsageDetail(state.team[5]?.species, state.format, state.seasonId);

  // Common teammates: aggregate teammate % across members, exclude on-team mons
  const teammateSuggestions = useMemo(() => {
    const onTeam = new Set(species.map((s) => s.toLowerCase()));
    const scores = new Map<string, number>();
    for (const detail of [d0, d1, d2, d3, d4, d5]) {
      for (const [name, pct] of Object.entries(detail?.teammates ?? {})) {
        if (onTeam.has(name.toLowerCase())) continue;
        scores.set(name, (scores.get(name) ?? 0) + pct);
      }
    }
    return [...scores.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([name, score]) => ({ name, score }));
  }, [species, d0, d1, d2, d3, d4, d5]);

  const teamFull = state.team.every((s) => s !== null);

  const cacheKey = useMemo(
    () => `${[...species].sort().join(',')}:${state.generation}`,
    [species, state.generation],
  );

  const [analysis, setAnalysis] = useState<TeamTypeAnalysis | null>(
    () => analysisCache.get(cacheKey) ?? null,
  );
  const [loading, setLoading] = useState<boolean>(
    () => species.length > 0 && !analysisCache.has(cacheKey),
  );
  const [trackedKey, setTrackedKey] = useState(cacheKey);

  // Adjust state during render on key change (avoids setState in effect body)
  if (cacheKey !== trackedKey) {
    setTrackedKey(cacheKey);
    setAnalysis(analysisCache.get(cacheKey) ?? null);
    setLoading(species.length > 0 && !analysisCache.has(cacheKey));
  }

  useEffect(() => {
    if (species.length === 0 || analysisCache.has(cacheKey)) return;

    const controller = new AbortController();

    fetch('/api/pkmn/type-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ species, gen: state.generation }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.success) {
          analysisCache.set(cacheKey, j.data);
          setAnalysis(j.data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [cacheKey, species, state.generation]);

  if (species.length === 0) {
    return (
      <div className="text-caption text-fg-muted text-center py-6">
        {t('overview.empty')}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-caption text-fg-muted text-center py-6">
        {t('overview.loading')}
      </div>
    );
  }

  if (!analysis) return null;

  const sortedWeaknesses = [...analysis.teamWeaknesses].sort((a, b) => b.count - a.count);
  const notableWeaknesses = sortedWeaknesses.filter((w) => w.count >= 2);
  const sortedResistances = [...analysis.teamResistances].sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-4">
      {/* Team weaknesses */}
      <div>
        <h4 className="text-caption font-[550] text-fg mb-1.5">
          {t('overview.weaknesses')}
        </h4>
        {notableWeaknesses.length === 0 ? (
          <p className="text-caption text-win">{t('overview.noSharedWeaknesses')}</p>
        ) : (
          <div className="flex flex-wrap gap-x-2 gap-y-1">
            {notableWeaknesses.map((w) => (
              <div key={w.type} className="flex items-center gap-0.5">
                <TypeBadge type={w.type} size="compact" className="px-1.5! py-0.5!" />
                <span className="font-mono text-caption font-[550] text-loss">×{w.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Team resistances */}
      {sortedResistances.length > 0 && (
        <div>
          <h4 className="text-caption font-[550] text-fg mb-1.5">
            {t('overview.resistances')}
          </h4>
          <div className="flex flex-wrap gap-x-2 gap-y-1">
            {sortedResistances.slice(0, 8).map((r) => (
              <div key={r.type} className="flex items-center gap-0.5">
                <TypeBadge type={r.type} size="compact" className="px-1.5! py-0.5!" />
                <span className="font-mono text-caption font-[550] text-win">×{r.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Common teammates (from meta usage data) */}
      {teammateSuggestions.length > 0 && (
        <div>
          <h4 className="text-caption font-[550] text-fg mb-1.5">
            {t('overview.teammates')}
          </h4>
          <div className="flex flex-wrap gap-1">
            {teammateSuggestions.map((mate) => {
              const mateName = localizeSpecies(mate.name, dl);
              return (
                <button
                  key={mate.name}
                  onClick={() => {
                    if (!state.locked && !teamFull) dispatch({ type: 'ADD_SLOT', species: mate.name });
                  }}
                  disabled={state.locked || teamFull}
                  title={
                    teamFull
                      ? t('overview.teammateFull', { species: mateName })
                      : t('overview.teammateAdd', { species: mateName })
                  }
                  className="flex items-center gap-1 rounded-full border border-hairline bg-elevated py-0.5 pl-1 pr-2 text-caption text-fg transition-colors duration-80 ease-out hover:border-hairline-strong hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:min-h-11"
                >
                  <PokemonSprite name={mate.name} size={24} />
                  {mateName}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-Pokémon breakdown */}
      <div>
        <h4 className="text-caption font-[550] text-fg mb-1.5">
          {t('overview.individual')}
        </h4>
        <div className="space-y-2">
          {analysis.pokemon.map((mon) => (
            <div key={mon.species} className="rounded-lg bg-elevated p-2">
              <div className="mb-1 flex items-center gap-1.5 text-caption font-[550] text-fg">
                <PokemonSprite name={mon.species} size={24} />
                {localizeSpecies(mon.species, dl)}
              </div>
              {mon.weaknesses.length > 0 && (
                <div className="mb-1 flex flex-wrap gap-1">
                  {mon.weaknesses.map((type) => (
                    <TypeBadge
                      key={type}
                      type={type}
                      size="compact"
                      className="px-1.5! py-0.5!"
                    />
                  ))}
                </div>
              )}
              {mon.immunities.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {mon.immunities.map((type) => (
                    <span
                      key={type}
                      className="inline-flex items-center justify-center rounded-full border border-hairline-strong px-1.5 text-caption text-fg-muted"
                    >
                      {localizeType(type, dl)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
