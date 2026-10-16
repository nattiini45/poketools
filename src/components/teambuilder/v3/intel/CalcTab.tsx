'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import TypeBadge from '@/components/shared/TypeBadge';
import { useDataLocale, useFormatter, useLocale, useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { formatKo, koLevel as toKoLevel, type KoLevel } from '@/lib/pkmn/i18n/calc-text';
import { localizeTerrain, localizeWeather } from '@/lib/pkmn/i18n/names/misc';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { TerrainKey, WeatherKey } from '@/lib/pkmn/i18n/types';
import { useEditorContext } from '../editor/EditorContext';
import { useIntelSubject } from '../hooks/useIntelSubject';
import { useUsageDetail } from '../hooks/useUsageDetail';
import { useOpponentSummary } from '../hooks/useOpponentSummary';
import type { CalcField, ThreatEntry, BatchCalcResponse } from '@/types/calc';

/** English keys sent to the calc API; labels come from `localizeWeather` / `localizeTerrain`. */
const WEATHER_OPTIONS: readonly ('' | WeatherKey)[] = ['', 'Sun', 'Rain', 'Sand', 'Snow'];
const TERRAIN_OPTIONS: readonly ('' | TerrainKey)[] = ['', 'Electric', 'Grassy', 'Misty', 'Psychic'];

/** The Showdown KO token (same in both languages): OHKO, 2HKO, … */
function koToken(n: number): string {
  return n <= 1 ? 'OHKO' : `${n}HKO`;
}

const KO_COLORS: Record<KoLevel, string> = {
  guaranteed: 'bg-red-500/80 text-white',
  likely: 'bg-orange-500/80 text-white',
  possible: 'bg-yellow-500/80 text-zinc-900',
  unlikely: 'bg-poke-surface text-poke-text-muted',
};

/** Strip empty/undefined entries so the calc API gets a clean field object */
function cleanFieldConditions(field: CalcField): CalcField | undefined {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(field)) {
    if (value === undefined || value === '') continue;
    cleaned[key] = value;
  }
  return Object.keys(cleaned).length > 0 ? (cleaned as CalcField) : undefined;
}

// Cache threats per format
const threatsCache = new Map<string, ThreatEntry[]>();

export default function CalcTab() {
  const { state, dispatch } = useEditorContext();
  const t = useT(teambuilderIntelMessages);
  const locale = useLocale();
  const dl = useDataLocale();
  const f = useFormatter();
  const subject = useIntelSubject();
  const attacker = subject.set;
  const usageDetail = useUsageDetail(attacker?.species, state.format, state.seasonId);

  // Defender source: meta threats, or the scouted opponent's mons (plan mode)
  const isPlanWithMatch = state.mode === 'plan' && !!state.matchId;
  const [source, setSource] = useState<'meta' | 'opponent'>('meta');
  const { summary: oppSummary, loading: oppLoading } = useOpponentSummary(
    isPlanWithMatch ? state.matchId : null,
  );

  const [threats, setThreats] = useState<ThreatEntry[]>(
    () => threatsCache.get(state.format) ?? [],
  );
  const [threatsLoading, setThreatsLoading] = useState<boolean>(
    () => !threatsCache.has(state.format),
  );
  const [trackedFormat, setTrackedFormat] = useState(state.format);
  const [trackedSource, setTrackedSource] = useState(source);
  const [calcResults, setCalcResults] = useState<BatchCalcResponse['data']['results'] | null>(null);
  const [loading, setLoading] = useState(false);

  // Adjust threat state during render on format change (avoids setState in effect body)
  if (state.format !== trackedFormat) {
    setTrackedFormat(state.format);
    setThreats(threatsCache.get(state.format) ?? []);
    setThreatsLoading(!threatsCache.has(state.format));
    setCalcResults(null);
  }
  // Stale results don't apply across sources
  if (source !== trackedSource) {
    setTrackedSource(source);
    setCalcResults(null);
  }

  // Opponent mons as calc-ready threat entries
  const opponentThreats = useMemo<ThreatEntry[]>(() => {
    if (!oppSummary) return [];
    return oppSummary.pokemon
      .filter((p) => p.default_set)
      .map((p) => ({
        species: p.species,
        usage_pct: p.bring_rate / 100,
        default_set: p.default_set!,
        types: p.types,
      }));
  }, [oppSummary]);

  const defenders = source === 'opponent' ? opponentThreats : threats;
  const defendersLoading = source === 'opponent' ? oppLoading : threatsLoading;

  // Fetch threats for format
  useEffect(() => {
    if (threatsCache.has(state.format)) return;
    const controller = new AbortController();
    fetch(`/api/calc/threats?format=${encodeURIComponent(state.format)}&limit=12`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.success) {
          threatsCache.set(state.format, j.data.threats);
          setThreats(j.data.threats);
        }
      })
      .catch(() => {})
      .finally(() => setThreatsLoading(false));
    return () => controller.abort();
  }, [state.format]);

  // Moves to calc with: chosen moves, else top-4 usage moves ("projected")
  const chosenMoves = useMemo(
    () => (attacker?.moves ?? []).filter(Boolean),
    [attacker?.moves],
  );
  const usageMoves = useMemo(() => {
    if (!usageDetail?.moves) return [];
    return Object.entries(usageDetail.moves)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 4)
      .map(([name]) => name)
      .filter((n) => n.toLowerCase() !== 'other');
  }, [usageDetail]);

  const calcMoves = chosenMoves.length > 0 ? chosenMoves : usageMoves;
  const isProjected = chosenMoves.length === 0 && usageMoves.length > 0;

  // Run batch calc when attacker / moves / defenders / field change
  const runCalc = useCallback(async () => {
    if (!attacker?.species || defenders.length === 0 || calcMoves.length === 0) {
      setCalcResults(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/calc/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generation: state.generation,
          attacker: {
            species: attacker.species,
            item: attacker.item || undefined,
            ability: attacker.ability || undefined,
            nature: attacker.nature || undefined,
            evs: attacker.evs,
            ivs: attacker.ivs,
            level: attacker.level ?? 100,
            moves: calcMoves,
          },
          defenders: defenders.map((t) => t.default_set),
          field: cleanFieldConditions(state.fieldConditions),
        }),
      });
      const json = await res.json();
      if (json.success) setCalcResults(json.data.results);
    } catch {
      setCalcResults(null);
    } finally {
      setLoading(false);
    }
  }, [attacker, defenders, calcMoves, state.generation, state.fieldConditions]);

  // Debounced calc trigger
  useEffect(() => {
    if (!attacker?.species || defenders.length === 0 || calcMoves.length === 0) return;
    const timer = setTimeout(runCalc, 400);
    return () => clearTimeout(timer);
  }, [runCalc, attacker?.species, defenders.length, calcMoves.length]);

  const weather = (state.fieldConditions.weather ?? '') as string;
  const terrain = (state.fieldConditions.terrain ?? '') as string;

  // Toggle helpers that omit empty keys instead of storing undefined values
  const setWeather = (value: string) => {
    const next: CalcField = { ...state.fieldConditions };
    if (value) next.weather = value as CalcField['weather'];
    else delete next.weather;
    dispatch({ type: 'SET_FIELD_CONDITIONS', conditions: next });
  };
  const setTerrain = (value: string) => {
    const next: CalcField = { ...state.fieldConditions };
    if (value) next.terrain = value as CalcField['terrain'];
    else delete next.terrain;
    dispatch({ type: 'SET_FIELD_CONDITIONS', conditions: next });
  };

  return (
    <div className="space-y-3">
      {/* Field conditions */}
      <div>
        <h4 className="text-[9px] text-poke-text-muted uppercase tracking-wide mb-1.5">
          {t('calc.fieldConditions')}
        </h4>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] text-poke-text-muted w-14 shrink-0">{t('calc.weather')}</span>
            {WEATHER_OPTIONS.map((value) => (
              <button
                key={value}
                onClick={() => setWeather(value)}
                className={[
                  'px-1.5 py-0.5 text-[10px] rounded border transition-colors',
                  weather === value
                    ? 'bg-poke-blue/20 border-poke-blue/60 text-poke-blue'
                    : 'border-poke-border text-poke-text-muted hover:text-poke-text-secondary',
                ].join(' ')}
              >
                {value ? localizeWeather(value, dl) : t('common.none')}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] text-poke-text-muted w-14 shrink-0">{t('calc.terrain')}</span>
            {TERRAIN_OPTIONS.map((value) => (
              <button
                key={value}
                onClick={() => setTerrain(value)}
                className={[
                  'px-1.5 py-0.5 text-[10px] rounded border transition-colors',
                  terrain === value
                    ? 'bg-poke-blue/20 border-poke-blue/60 text-poke-blue'
                    : 'border-poke-border text-poke-text-muted hover:text-poke-text-secondary',
                ].join(' ')}
              >
                {value ? localizeTerrain(value, dl) : t('common.none')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Matchup matrix */}
      {!attacker?.species ? (
        <p className="text-[11px] text-poke-text-muted text-center py-4">
          {t('calc.empty')}
        </p>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <h4 className="text-[9px] text-poke-text-muted uppercase tracking-wide">
              {t('calc.matchupTitle', {
                species: localizeSpecies(attacker.species, dl),
                opponent:
                  source === 'opponent'
                    ? oppSummary?.opponent_name ?? t('calc.opponent')
                    : t('calc.topThreats'),
              })}
            </h4>
            {loading && (
              <span className="text-[9px] text-poke-text-muted animate-pulse">{t('calc.calculating')}</span>
            )}
          </div>

          {/* Defender source toggle (plan mode) */}
          {isPlanWithMatch && (
            <div className="flex gap-1 mb-1.5">
              {(
                [
                  ['meta', t('calc.sourceMeta')],
                  ['opponent', t('calc.sourceOpponent')],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setSource(id)}
                  className={[
                    'px-1.5 py-0.5 text-[10px] rounded border transition-colors',
                    source === id
                      ? 'bg-poke-blue/20 border-poke-blue/60 text-poke-blue'
                      : 'border-poke-border text-poke-text-muted hover:text-poke-text-secondary',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {isProjected && (
            <p className="text-[9px] text-poke-text-muted mb-1.5">
              {t('calc.projected', {
                species: localizeSpecies(attacker.species, dl),
                moves: usageMoves.map((m) => localizeMove(m, dl)).join(', '),
              })}
            </p>
          )}

          {defendersLoading ? (
            <p className="text-[10px] text-poke-text-muted text-center py-2">{t('calc.loadingThreats')}</p>
          ) : defenders.length === 0 ? (
            <p className="text-[10px] text-poke-text-muted text-center py-2">
              {source === 'opponent'
                ? t('calc.noOpponentData')
                : t('calc.noUsageData', { format: state.format })}
            </p>
          ) : calcMoves.length === 0 ? (
            <p className="text-[10px] text-poke-text-muted text-center py-2">
              {t('calc.pickMoves', { species: localizeSpecies(attacker.species, dl) })}
            </p>
          ) : (
            <div className="space-y-1">
              {defenders.map((threat, i) => {
                const result = calcResults?.[i];
                // Best move = highest max damage (guard against empty move_results)
                const moveResults = result?.move_results ?? [];
                const bestMove =
                  moveResults.length > 0
                    ? moveResults.reduce((best, r) =>
                        r.damage.max_pct > best.damage.max_pct ? r : best,
                      )
                    : undefined;
                // Structured KO info from the calc API (PK-5); the English `ko_chance` is the en text and the source of the "after" items.
                const ko = bestMove?.ko ?? null;
                const koLevel: KoLevel = toKoLevel(ko);
                const koText = formatKo(ko, locale, bestMove?.ko_chance);

                return (
                  <div
                    key={threat.species}
                    className="flex items-center gap-2 py-1 border-b border-poke-border/30 last:border-0"
                  >
                    <PokemonSprite name={threat.species} size={24} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-poke-text-primary truncate">
                          {localizeSpecies(threat.species, dl)}
                        </span>
                        <div className="flex gap-0.5">
                          {(threat.types ?? []).map((t) => (
                            <TypeBadge
                              key={t}
                              type={t}
                              className="!text-[7px] !px-0.5 !py-0 !min-w-[2rem]"
                            />
                          ))}
                        </div>
                      </div>
                      {bestMove && (
                        <span className="text-[10px] text-poke-text-muted truncate">
                          {localizeMove(bestMove.move, dl)} —{' '}
                          {t('calc.damageRange', {
                            min: bestMove.damage.min_pct,
                            max: bestMove.damage.max_pct,
                          })}
                        </span>
                      )}
                    </div>
                    {bestMove && (
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0 ${KO_COLORS[koLevel]}`}
                        title={koText || undefined}
                      >
                        {koLevel === 'guaranteed'
                          ? koToken(ko?.n ?? 1)
                          : koLevel === 'likely'
                            ? t('calc.ko.likely')
                            : koLevel === 'possible'
                              ? t('calc.ko.possible')
                              : bestMove.damage.max_pct > 0
                                ? f.percentOf(bestMove.damage.max_pct, 1)
                                : '—'}
                      </span>
                    )}
                    {!bestMove && loading && (
                      <span className="text-[9px] text-poke-text-muted">…</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
