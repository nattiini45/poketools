'use client';

import { useState, useEffect, useMemo } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import { useDataLocale, useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { localizeNature, localizeStat } from '@/lib/pkmn/i18n/names/misc';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { useEditorContext } from '../editor/EditorContext';
import { useIntelSubject } from '../hooks/useIntelSubject';
import { NATURE_DATA } from '../constants';
import type { SpeedTiersResponse, SpeedCalcResponse } from '@/types/speed';
import type { StatSpread } from '@/types/team';

const NATURE_EFFECTS = Object.fromEntries(
  NATURE_DATA
    .filter(([, plus]) => plus !== '')
    .map(([name, plus, minus]) => [name, { plus, minus }]),
) as Record<string, { plus: string; minus: string }>;

function calcSpeed(baseSpe: number, ev: number, iv: number, level: number, nature: string): number {
  const n = NATURE_EFFECTS[nature];
  const multiplier = n ? (n.plus === 'spe' ? 1.1 : n.minus === 'spe' ? 0.9 : 1) : 1;
  return Math.floor(
    (Math.floor(((2 * baseSpe + iv + Math.floor(ev / 4)) * level) / 100) + 5) * multiplier,
  );
}

/**
 * The structured configuration of a row; the label ("252+ Spe · Jolly · Scarf · base 130")
 * is built at render in the viewer's language. `pending` = base speed not loaded yet ("…").
 */
interface SpeedConfig {
  pending?: boolean;
  ev: string;
  /** '+' (boosting nature), '−' (hindering) or '' */
  mark: string;
  /** Canonical English nature name, or '' */
  nature: string;
  /** Canonical English item name, or '' */
  item: string;
  baseSpe: number;
}

/** One row in the merged speed list */
interface SpeedRow {
  key: string;
  species: string;
  speed: number;
  config: SpeedConfig;
  kind: 'team' | 'benchmark';
  isScarf: boolean;
}

const tiersCache = new Map<string, SpeedTiersResponse>();
// Base-speed lookup cache, keyed by `species:gen`
const baseSpeCache = new Map<string, number>();

export default function SpeedTab() {
  const { state, dispatch } = useEditorContext();
  const subject = useIntelSubject();
  const t = useT(teambuilderIntelMessages);
  const tb = useT(teambuilderMessages);
  const dl = useDataLocale();

  const [tiers, setTiers] = useState<SpeedTiersResponse | null>(
    () => tiersCache.get(state.format) ?? null,
  );
  const [loading, setLoading] = useState<boolean>(() => !tiersCache.has(state.format));
  const [trackedFormat, setTrackedFormat] = useState(state.format);
  // Bumped after a base-speed fetch resolves so the derived map re-reads the cache
  const [baseSpeedVersion, setBaseSpeedVersion] = useState(0);

  // Outspeed solver state — reset during render when target or subject changes
  const target = state.speedCalcTarget;
  const solverKey = target
    ? `${target.species}:${target.speed}:${subject.set?.species ?? ''}:${subject.set?.item ?? ''}:${subject.set?.level ?? 100}`
    : null;
  const [solver, setSolver] = useState<SpeedCalcResponse | null>(null);
  const [solverLoading, setSolverLoading] = useState(false);
  const [trackedSolverKey, setTrackedSolverKey] = useState(solverKey);
  if (solverKey !== trackedSolverKey) {
    setTrackedSolverKey(solverKey);
    setSolver(null);
    setSolverLoading(!!solverKey && !!subject.set?.species);
  }

  // Adjust tier state during render on format change (avoids setState in effect body)
  if (state.format !== trackedFormat) {
    setTrackedFormat(state.format);
    setTiers(tiersCache.get(state.format) ?? null);
    setLoading(!tiersCache.has(state.format));
  }

  // Fetch speed tiers for this format
  useEffect(() => {
    if (tiersCache.has(state.format)) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ format: state.format, limit: '30', include_scarf: 'true' });
    if (state.seasonId) params.set('season_id', state.seasonId);

    fetch(`/api/pkmn/speed-tiers?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => {
        if (j.success) {
          tiersCache.set(state.format, j.data);
          setTiers(j.data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [state.format, state.seasonId]);

  // Team species (memoized list)
  const teamSpecies = useMemo(
    () =>
      state.team
        .filter((s): s is NonNullable<typeof s> => s !== null && !!s.species)
        .map((s) => s.species),
    [state.team],
  );

  // Fetch base speeds for any team species not already cached (single batch call)
  useEffect(() => {
    const gen = state.generation;
    const missing = teamSpecies.filter((sp) => !baseSpeCache.has(`${sp}:${gen}`));
    if (missing.length === 0) return;

    const controller = new AbortController();
    const names = missing.slice(0, 12).join(',');
    fetch(`/api/pkmn/species-info?names=${encodeURIComponent(names)}&gen=${gen}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (!j.success || !Array.isArray(j.data)) return;
        for (const info of j.data as { name: string; baseStats: StatSpread }[]) {
          baseSpeCache.set(`${info.name}:${gen}`, info.baseStats?.spe ?? 0);
        }
        setBaseSpeedVersion((v) => v + 1);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [teamSpecies, state.generation]);

  // Run the outspeed solver when a target is set
  useEffect(() => {
    if (!target || !subject.set?.species) return;
    const controller = new AbortController();

    fetch('/api/pkmn/speed-calc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        species: subject.set.species,
        target_speed: target.speed,
        generation: state.generation,
        level: subject.set.level ?? 100,
        item: subject.set.item || undefined,
        ability: subject.set.ability || undefined,
      }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setSolver(j.data);
      })
      .catch(() => {})
      .finally(() => setSolverLoading(false));
    return () => controller.abort();
    // solverKey encodes target+subject; the request body reads the same values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solverKey, state.generation]);

  // ── Merged rows: team members + meta benchmarks, sorted by speed desc ──
  const rows = useMemo<SpeedRow[]>(() => {
    const gen = state.generation;
    const out: SpeedRow[] = [];

    for (const set of state.team) {
      if (!set?.species) continue;
      const baseSpe = baseSpeCache.get(`${set.species}:${gen}`);
      if (baseSpe === undefined) {
        out.push({
          key: `team-${set.species}`,
          species: set.species,
          speed: -1,
          config: { pending: true, ev: '', mark: '', nature: '', item: '', baseSpe: 0 },
          kind: 'team',
          isScarf: set.item === 'Choice Scarf',
        });
        continue;
      }
      const ev = set.evs?.spe ?? 0;
      const iv = set.ivs?.spe ?? 31;
      const level = set.level ?? 100;
      const nature = set.nature ?? '';
      const isScarf = set.item === 'Choice Scarf';
      let speed = calcSpeed(baseSpe, ev, iv, level, nature);
      if (isScarf) speed = Math.floor(speed * 1.5);

      const natureFx = NATURE_EFFECTS[nature];
      const natureMark =
        natureFx?.plus === 'spe' ? '+' : natureFx?.minus === 'spe' ? '−' : '';

      out.push({
        key: `team-${set.species}`,
        species: set.species,
        speed,
        // Team rows show only the Scarf among items (other items do not change speed here)
        config: { ev: String(ev), mark: natureMark, nature, item: isScarf ? 'Choice Scarf' : '', baseSpe },
        kind: 'team',
        isScarf,
      });
    }

    for (const b of tiers?.benchmarks ?? []) {
      const evPart = b.evs === 252 ? '252' : b.evs === 0 ? '0' : String(b.evs);
      const natureMark = b.nature === 'positive' ? '+' : '';

      out.push({
        key: `bench-${b.species}-${b.label}`,
        species: b.species,
        speed: b.speed,
        config: { ev: evPart, mark: natureMark, nature: '', item: b.item ?? '', baseSpe: b.baseSpe },
        kind: 'benchmark',
        isScarf: b.item === 'Choice Scarf',
      });
    }

    return out.sort((a, b) => b.speed - a.speed);
    // baseSpeedVersion re-reads the module cache after fetches resolve
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.team, state.generation, tiers, baseSpeedVersion]);

  const maxSpeed = useMemo(
    () => Math.max(1, ...rows.map((r) => r.speed)),
    [rows],
  );

  if (loading) {
    return (
      <div className="text-[11px] text-poke-text-muted text-center py-6">
        {t('speed.loading')}
      </div>
    );
  }

  /** "252+ Spe · Jolly · Scarf · base 130", localized at render. */
  const configLabel = (c: SpeedConfig): string => {
    if (c.pending) return '…';
    const parts = [`${c.ev}${c.mark} ${localizeStat('spe', dl, 'short')}`];
    if (c.nature) parts.push(localizeNature(c.nature, dl));
    if (c.item) parts.push(c.item === 'Choice Scarf' ? t('speed.scarf') : localizeItem(c.item, dl));
    parts.push(t('speed.base', { n: c.baseSpe }));
    return parts.join(' · ');
  };

  // The target's label in the current language (the stored label is only a fallback)
  const targetRow = target
    ? rows.find((r) => r.kind === 'benchmark' && r.species === target.species && r.speed === target.speed)
    : undefined;
  const targetLabel = targetRow ? configLabel(targetRow.config) : (target?.label ?? '');

  const hasBenchmarks = (tiers?.benchmarks.length ?? 0) > 0;

  return (
    <div className="space-y-3">
      {/* Outspeed solver panel */}
      {target && (
        <div className="border border-poke-blue/40 bg-poke-blue/5 rounded-lg p-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-medium text-poke-text-primary">
              {subject.set?.species
                ? t.rich('speed.outspeedWith', {
                    target: localizeSpecies(target.species, dl),
                    speed: target.speed,
                    species: localizeSpecies(subject.set.species, dl),
                    muted: (chunks) => <span className="text-poke-text-muted">{chunks}</span>,
                  })
                : t('speed.outspeed', {
                    target: localizeSpecies(target.species, dl),
                    speed: target.speed,
                  })}
            </span>
            <button
              onClick={() => dispatch({ type: 'SET_SPEED_TARGET', target: null })}
              className="text-[9px] text-poke-text-muted hover:text-poke-text-primary transition-colors"
              aria-label={t('speed.clearTarget')}
            >
              ✕
            </button>
          </div>
          <p className="text-[9px] text-poke-text-muted mb-1.5">{targetLabel}</p>

          {!subject.set?.species ? (
            <p className="text-[10px] text-poke-text-muted">{t('speed.addPokemon')}</p>
          ) : solverLoading ? (
            <p className="text-[10px] text-poke-text-muted animate-pulse">{t('speed.solving')}</p>
          ) : solver?.impossible ? (
            <p className="text-[10px] text-orange-400">
              {/* The route's English `note` is derived the same way: Choice Scarf already held or not. */}
              {tb(
                subject.set.item?.toLowerCase() === 'choice scarf'
                  ? 'speed.impossibleEvenScarf'
                  : 'speed.impossibleTryScarf',
                { item: localizeItem('Choice Scarf', dl) },
              )}
            </p>
          ) : solver && solver.solutions.length > 0 ? (
            <div className="space-y-1">
              {solver.solutions.slice(0, 3).map((sol) => (
                <div
                  key={`${sol.nature}-${sol.ev}`}
                  className="flex items-center gap-2 text-[10px]"
                >
                  <span className="text-poke-text-primary flex-1">
                    {t('speed.solution', {
                      nature: localizeNature(sol.nature, dl),
                      ev: sol.ev,
                      stat: localizeStat('spe', dl, 'short'),
                      speed: sol.resulting_speed,
                    })}
                  </span>
                  {!state.locked && subject.slot !== null && (
                    <button
                      onClick={() => {
                        const set = subject.set!;
                        dispatch({
                          type: 'UPDATE_SLOT',
                          slot: subject.slot!,
                          patch: {
                            nature: sol.nature,
                            evs: { ...set.evs, spe: sol.ev },
                          },
                        });
                      }}
                      className="px-1.5 py-0.5 text-[9px] bg-poke-blue/15 text-poke-blue rounded hover:bg-poke-blue/25 transition-colors shrink-0"
                    >
                      {t('common.apply')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Merged speed list */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="text-[9px] text-poke-text-muted uppercase tracking-wide">
            {t('speed.title')}
          </h4>
          <span className="text-[8px] text-poke-text-muted">
            {t('speed.hint')}
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="text-[10px] text-poke-text-muted text-center py-2">
            {t('speed.empty')}
          </p>
        ) : (
          <div className="space-y-0.5 max-h-[420px] overflow-y-auto">
            {rows.map((row) => {
              const barWidth = row.speed > 0 ? Math.min(100, (row.speed / maxSpeed) * 100) : 0;
              const isTeam = row.kind === 'team';
              const isTarget =
                !isTeam && target?.species === row.species && target?.speed === row.speed;
              const config = configLabel(row.config);
              const speciesName = localizeSpecies(row.species, dl);

              const content = (
                <>
                  <PokemonSprite name={row.species} size={20} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span
                        className={`text-[10px] truncate ${
                          isTeam
                            ? 'text-poke-text-primary font-medium'
                            : 'text-poke-text-secondary'
                        }`}
                      >
                        {speciesName}
                      </span>
                      <span className="text-[8px] text-poke-text-muted truncate shrink-0">
                        {config}
                      </span>
                    </div>
                    <div className="h-1.5 bg-poke-border rounded-full overflow-hidden mt-0.5">
                      <div
                        className={`h-full rounded-full ${
                          isTeam
                            ? row.isScarf
                              ? 'bg-orange-400'
                              : 'bg-green-500'
                            : isTarget
                              ? 'bg-poke-blue'
                              : 'bg-poke-border-strong'
                        }`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-mono w-8 text-right shrink-0 ${
                      isTeam ? 'text-poke-text-primary' : 'text-poke-text-muted'
                    }`}
                  >
                    {row.speed >= 0 ? row.speed : '—'}
                  </span>
                </>
              );

              if (isTeam) {
                return (
                  <div
                    key={row.key}
                    className="flex items-center gap-2 py-0.5 px-1 rounded bg-poke-surface/60"
                  >
                    {content}
                  </div>
                );
              }

              return (
                <button
                  key={row.key}
                  onClick={() =>
                    dispatch({
                      type: 'SET_SPEED_TARGET',
                      target: isTarget
                        ? null
                        : { species: row.species, speed: row.speed, label: config },
                    })
                  }
                  className={[
                    'w-full flex items-center gap-2 py-0.5 px-1 rounded text-left transition-colors',
                    isTarget ? 'bg-poke-blue/15' : 'hover:bg-poke-muted',
                  ].join(' ')}
                  title={t('speed.solveTitle', { species: speciesName, speed: row.speed })}
                >
                  {content}
                </button>
              );
            })}
          </div>
        )}

        {!hasBenchmarks && rows.length > 0 && (
          <p className="text-[9px] text-poke-text-muted mt-2 text-center">
            {t('speed.noUsageData', { format: state.format })}
          </p>
        )}
      </div>
    </div>
  );
}
