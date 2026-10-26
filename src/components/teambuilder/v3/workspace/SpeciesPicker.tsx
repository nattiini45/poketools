'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import TypeSprite from '@/components/shared/TypeSprite';
import BudgetMeter from '../browser/BudgetMeter';
import { useDataLocale, useLocale, useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { localizeStat, localizeType } from '@/lib/pkmn/i18n/names/misc';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { useEditorContext } from '../editor/EditorContext';
import { TYPE_NAMES } from '../constants';
import type { UsageListItem } from '@/types/usage';
import {
  buildSpeciesListView,
  applySortClick,
  type SortKey,
  type SortCriterion,
  type StatKey,
} from './speciesListView';
import { formatUsagePct } from './usagePercent';

/** Stat columns; header labels come from `localizeStat` (short form, long form as the tooltip). */
const STAT_COLUMNS: readonly StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

// Shared column widths so the header row and the data cells stay aligned.
// Narrow on mobile (the whole table stays visible, Showdown-style), roomier ≥ sm.
const TIER_COL = 'w-7 sm:w-10';
const STAT_COL = 'w-6 sm:w-9';
const BST_COL = 'w-7 sm:w-10';
const PICK_COL = 'w-9 sm:w-14';

interface SpeciesPickerProps {
  /** Called with the chosen species name */
  onSelect: (species: string) => void;
  /** Shown only when provided (e.g. when changing an existing species) */
  onCancel?: () => void;
}

// Merged usage+dex list cached per `format:gen:seasonId`
const listCache = new Map<string, UsageListItem[]>();

/**
 * Ruleset legality overrides (lowercased names), cached per ruleset id. The id is a pinned VERSION (immutable), so a cached
 * entry never goes stale.
 */
interface RulesetOverrides {
  extraBans: Set<string>;
  additions: Set<string>;
  /** The only legal species when the ruleset's Pokémon list is an allowlist; null otherwise. */
  allowOnly: Set<string> | null;
}
const rulesetOverrideCache = new Map<string, RulesetOverrides>();

async function loadRulesetOverrides(
  rulesetId: string,
  signal: AbortSignal,
): Promise<RulesetOverrides> {
  const res = await fetch(`/api/rulesets/${rulesetId}`, { signal })
    .then((r) => r.json())
    .catch(() => null);
  const ruleset = res?.success ? res.data : null;
  return {
    extraBans: new Set<string>(
      (ruleset?.bans?.pokemon ?? []).map((n: string) => n.toLowerCase()),
    ),
    additions: new Set<string>(
      (ruleset?.additions?.pokemon ?? []).map((n: string) => n.toLowerCase()),
    ),
    allowOnly: Array.isArray(ruleset?.allow?.pokemon)
      ? new Set<string>(ruleset.allow.pokemon.map((n: string) => n.toLowerCase()))
      : null,
  };
}

async function loadList(
  format: string,
  generation: number,
  seasonId: string | null,
  signal: AbortSignal,
): Promise<UsageListItem[]> {
  const usageParams = new URLSearchParams({ format, limit: '200' });
  if (seasonId) usageParams.set('season_id', seasonId);

  const dexParams = new URLSearchParams({
    type: 'pokemon',
    rich: '1',
    list: '1',
    gen: String(generation),
    format,
  });

  const [usageRes, dexRes] = await Promise.all([
    fetch(`/api/usage-stats?${usageParams}`, { signal })
      .then((r) => r.json())
      .catch(() => null),
    fetch(`/api/pkmn/search?${dexParams}`, { signal })
      .then((r) => r.json())
      .catch(() => null),
  ]);

  type DexItem = {
    name: string;
    types?: string[];
    baseStats?: UsageListItem['base_stats'];
    tier?: string | null;
    legal?: boolean;
  };
  const dexRaw: DexItem[] = dexRes?.success ? (dexRes.data ?? []) : [];

  const dex: UsageListItem[] = dexRaw.map((p) => ({
    pokemon_name: p.name,
    types: p.types ?? [],
    usage_pct: 0,
    sprite_id: '',
    source: 'meta' as const,
    base_stats: p.baseStats,
    tier: p.tier ?? null,
    legal: p.legal ?? true,
  }));

  // Tier/legal lookup so usage items (which lack it) can be enriched by name.
  const tierByName = new Map<string, { tier: string | null; legal: boolean }>();
  for (const p of dexRaw) {
    tierByName.set(p.name.toLowerCase(), { tier: p.tier ?? null, legal: p.legal ?? true });
  }

  const usageRaw: UsageListItem[] = usageRes?.success ? (usageRes.data?.pokemon ?? []) : [];
  // Join tier/legal onto usage items; unmatched usage rows stay visible (legal: true).
  const usage: UsageListItem[] = usageRaw.map((p) => {
    const meta = tierByName.get(p.pokemon_name.toLowerCase());
    return { ...p, tier: meta?.tier ?? null, legal: meta?.legal ?? true };
  });

  // Usage-tracked Pokémon first (already sorted by pick%), then remaining dex
  const usageNames = new Set(usage.map((p) => p.pokemon_name.toLowerCase()));
  const dexOnly = dex.filter((p) => !usageNames.has(p.pokemon_name.toLowerCase()));
  return [...usage, ...dexOnly];
}

/**
 * SpeciesPicker — full-pane Pokémon chooser shown when filling or changing a slot.
 *
 * Shows the meta's usage-tracked Pokémon with Pick% immediately (before any
 * input), with the remaining dex merged below. Filterable by name and type,
 * sortable by tier, individual stats, BST, or Pick% — each click/tap stacks a
 * criterion (up to 3); "Clear sort" resets. Outside draft mode the list hides Pokémon that are illegal in the
 * selected format (ruleset-bound teams refine this with the ruleset's own
 * bans, additions or allowlist), and each row shows its tier. An optional "Group: Tier" toggle
 * partitions the list into sticky tier sections, sorting within each group. In
 * draft mode the list is constrained to the season's pool with point costs and
 * taken-status.
 *
 * Responsive: the full stat table stays visible at every width — the tier, six
 * stat, BST and Pick%/Cost columns just narrow on mobile (Showdown-style) rather
 * than collapsing, so every value is readable and every header tappable to sort.
 */
export default function SpeciesPicker({ onSelect, onCancel }: SpeciesPickerProps) {
  const { state } = useEditorContext();
  const t = useT(teambuilderIntelMessages);
  const locale = useLocale();
  const dl = useDataLocale();
  const cacheKey = `${state.format}:${state.generation}:${state.seasonId ?? ''}`;

  const [query, setQuery] = useState('');
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  const [sortCriteria, setSortCriteria] = useState<SortCriterion[]>([]);
  const [groupByTier, setGroupByTier] = useState(false);
  const [showTaken, setShowTaken] = useState(false);

  const [pokemonList, setPokemonList] = useState<UsageListItem[]>(
    () => listCache.get(cacheKey) ?? [],
  );
  const [loading, setLoading] = useState<boolean>(() => !listCache.has(cacheKey));
  const [trackedKey, setTrackedKey] = useState(cacheKey);

  // Adjust state during render on format/season change
  if (cacheKey !== trackedKey) {
    setTrackedKey(cacheKey);
    setPokemonList(listCache.get(cacheKey) ?? []);
    setLoading(!listCache.has(cacheKey));
  }

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Load merged usage+dex list once per format/gen/season
  useEffect(() => {
    if (listCache.has(cacheKey)) return;
    const controller = new AbortController();
    loadList(state.format, state.generation, state.seasonId, controller.signal)
      .then((list) => {
        listCache.set(cacheKey, list);
        setPokemonList(list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [cacheKey, state.format, state.generation, state.seasonId]);

  // ── Ruleset legality overrides (bans/additions on top of base format) ──
  // Mirrors the list-cache pattern: sync state is adjusted during render on
  // ruleset change; the effect only performs the async fetch when uncached.
  const overridesFor = (id: string | null) =>
    id ? rulesetOverrideCache.get(id) ?? null : null;
  const [rulesetOverrides, setRulesetOverrides] = useState<RulesetOverrides | null>(
    () => overridesFor(state.rulesetId),
  );
  const [trackedRulesetId, setTrackedRulesetId] = useState(state.rulesetId);
  if (state.rulesetId !== trackedRulesetId) {
    setTrackedRulesetId(state.rulesetId);
    setRulesetOverrides(overridesFor(state.rulesetId));
  }
  useEffect(() => {
    const id = state.rulesetId;
    if (!id || rulesetOverrideCache.has(id)) return;
    const controller = new AbortController();
    loadRulesetOverrides(id, controller.signal)
      .then((overrides) => {
        rulesetOverrideCache.set(id, overrides);
        setRulesetOverrides(overrides);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [state.rulesetId]);

  // ── Draft constraints ────────────────────────────────────────────────
  const draft = state.isDraftLeague ? state.draft : null;
  const poolCosts = useMemo(() => {
    if (!draft) return null;
    const map = new Map<string, number | null>();
    for (const e of draft.entries) {
      map.set(e.pokemon_name.toLowerCase(), e.point_cost ?? draft.defaultPointCost);
    }
    return map;
  }, [draft]);
  const takenSet = useMemo(
    () => new Set((draft?.takenPokemon ?? []).map((n) => n.toLowerCase())),
    [draft],
  );
  /** Our own drafted picks — always selectable, marked "your pick" */
  const rosterSet = useMemo(
    () => new Set((draft?.roster ?? []).map((n) => n.toLowerCase())),
    [draft],
  );

  const teamSpecies = useMemo(
    () =>
      new Set(
        state.team
          .filter((s): s is NonNullable<typeof s> => s !== null && !!s.species)
          .map((s) => s.species.toLowerCase()),
      ),
    [state.team],
  );

  // ── Filter + sort + group pipeline (pure module; full dex is preloaded) ──
  // Apply the format legality filter unless in draft mode (the pool governs
  // availability there). Ruleset-bound teams DO filter — the base-format `legal`
  // flag is refined by the ruleset's own bans/additions below.
  const applyLegality = !draft;
  const extraBans = rulesetOverrides?.extraBans;
  const additions = rulesetOverrides?.additions;
  const allowOnly = rulesetOverrides?.allowOnly;
  const view = useMemo(
    () =>
      buildSpeciesListView(pokemonList, {
        query,
        typeFilters,
        sortCriteria,
        groupByTier,
        applyLegality,
        extraBans,
        additions,
        allowOnly,
        poolCosts,
        showTaken,
        takenSet,
        rosterSet,
        teamSpecies,
      }, dl),
    [
      pokemonList, poolCosts, takenSet, rosterSet, teamSpecies, showTaken,
      query, typeFilters, sortCriteria, groupByTier, applyLegality, extraBans, additions, allowOnly, dl,
    ],
  );
  const sorted = view.items;

  // Each click/tap builds the sort stack (cycle desc→asc→off, or append). Same
  // model on desktop and mobile — no shift key. "Clear sort" resets.
  const handleSort = (key: SortKey) => {
    setSortCriteria((prev) => applySortClick(prev, key));
  };

  const isSorted = (key: SortKey) => sortCriteria.some((c) => c.key === key);

  const sortIndicator = (key: SortKey) => {
    const idx = sortCriteria.findIndex((c) => c.key === key);
    if (idx === -1) return null;
    const { dir } = sortCriteria[idx];
    // Show a priority number only when multiple criteria are stacked.
    const prefix = sortCriteria.length > 1 ? idx + 1 : '';
    return (
      <span className="ml-0.5 text-poke-blue">
        {prefix}
        {dir === 'desc' ? '▾' : '▴'}
      </span>
    );
  };

  const toggleTypeFilter = (type: string) => {
    setTypeFilters((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  };

  const hasUsageData = pokemonList.some((p) => p.usage_pct > 0);

  const renderRow = (pokemon: UsageListItem) => {
    const lower = pokemon.pokemon_name.toLowerCase();
    const onTeam = teamSpecies.has(lower);
    const isOwnPick = !!draft && rosterSet.has(lower);
    const taken = !!draft && takenSet.has(lower) && !isOwnPick && !onTeam;
    const cost = poolCosts?.get(lower);
    const bst = pokemon.base_stats
      ? Object.values(pokemon.base_stats).reduce((s, v) => s + v, 0)
      : null;

    return (
      <button
        key={pokemon.pokemon_name}
        type="button"
        className={`w-full flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2 text-left transition-colors ${
          onTeam || taken ? 'opacity-40 cursor-not-allowed' : 'hover:bg-poke-surface'
        }`}
        onClick={() => !onTeam && !taken && onSelect(pokemon.pokemon_name)}
        disabled={onTeam || taken}
      >
        <PokemonSprite name={pokemon.pokemon_name} size={32} className="shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-xs sm:text-sm text-poke-text-primary block truncate">
            {localizeSpecies(pokemon.pokemon_name, dl)}
            {onTeam && (
              <span className="ml-1.5 text-[9px] text-poke-blue">{t('speciesPicker.onTeam')}</span>
            )}
            {isOwnPick && !onTeam && (
              <span className="ml-1.5 text-[9px] text-green-500">{t('speciesPicker.yourPick')}</span>
            )}
            {taken && (
              <span className="ml-1.5 text-[9px] text-poke-text-muted">{t('speciesPicker.taken')}</span>
            )}
          </span>
          <div className="flex gap-1 mt-0.5">
            {pokemon.types?.map((t) => (
              <TypeSprite key={t} type={t} size={16} />
            ))}
          </div>
        </div>
        <div className="flex items-center shrink-0 text-[9px] sm:text-[11px] tabular-nums">
          <span className={`${TIER_COL} text-center text-poke-text-muted`}>
            {pokemon.tier ?? '—'}
          </span>
          {STAT_COLUMNS.map((key) => (
            <span key={key} className={`${STAT_COL} text-center text-poke-text-muted`}>
              {pokemon.base_stats?.[key] ?? '—'}
            </span>
          ))}
          <span className={`${BST_COL} text-center text-poke-text-secondary font-medium`}>
            {bst ?? '—'}
          </span>
          <span className={`${PICK_COL} text-right text-poke-text-muted`}>
            {draft
              ? cost != null
                ? t('speciesPicker.costValue', { cost })
                : '—'
              : pokemon.usage_pct > 0
                ? formatUsagePct(pokemon.usage_pct, locale)
                : '—'}
          </span>
        </div>
      </button>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Budget meter (draft mode) */}
      {draft && <BudgetMeter />}

      {/* No-meta-data banner */}
      {!loading && pokemonList.length > 0 && !hasUsageData && (
        <div className="px-4 py-1.5 text-[10px] text-yellow-600 dark:text-yellow-500 bg-yellow-500/10 border-b border-poke-border shrink-0">
          {t('speciesPicker.noUsageData', { format: state.format })}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-poke-border shrink-0">
        <h3 className="font-heading font-semibold text-poke-text-primary text-sm">
          {t('speciesPicker.title')}
        </h3>
        <div className="flex items-center gap-3">
          {draft && (
            <button
              type="button"
              onClick={() => setShowTaken((v) => !v)}
              className={`text-[10px] transition-colors ${
                showTaken ? 'text-poke-blue' : 'text-poke-text-muted hover:text-poke-text-secondary'
              }`}
            >
              {showTaken ? t('speciesPicker.hideTaken') : t('speciesPicker.showTaken')}
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              className="text-xs text-poke-text-muted hover:text-poke-text-secondary transition-colors"
              onClick={onCancel}
            >
              {t('common.cancel')}
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="px-4 py-2 border-b border-poke-border shrink-0">
        <input
          ref={inputRef}
          type="text"
          className="w-full bg-poke-surface border border-poke-border rounded-lg px-3 py-2 text-sm text-poke-text-primary placeholder:text-poke-text-muted focus:ring-1 focus:ring-poke-focus/40 focus:border-poke-focus/40 transition-all outline-none"
          placeholder={t('speciesPicker.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && sorted.length > 0) onSelect(sorted[0].pokemon_name);
            if (e.key === 'Escape' && onCancel) onCancel();
          }}
        />
      </div>

      {/* Type filters */}
      <div className="px-4 py-2 border-b border-poke-border shrink-0">
        <div className="flex flex-wrap gap-1">
          {TYPE_NAMES.map((type) => {
            const isActive = typeFilters.includes(type);
            return (
              <button
                key={type}
                type="button"
                className={`inline-flex items-center rounded transition-all ${
                  isActive
                    ? 'ring-1 ring-poke-blue/40 bg-poke-blue/15'
                    : 'opacity-40 hover:opacity-75'
                }`}
                onClick={() => toggleTypeFilter(type)}
                aria-pressed={isActive}
                aria-label={t('speciesPicker.filterByType', { type: localizeType(type, dl) })}
              >
                <TypeSprite type={type} size={18} />
              </button>
            );
          })}
          {typeFilters.length > 0 && (
            <button
              type="button"
              className="text-[10px] text-poke-text-muted hover:text-poke-text-secondary px-1.5 transition-colors"
              onClick={() => setTypeFilters([])}
            >
              {t('common.clear')}
            </button>
          )}
        </div>
      </div>

      {/* Controls: tier grouping + clear sort (its own row so it fits mobile) */}
      <div className="flex items-center gap-3 px-2 sm:px-4 py-1.5 border-b border-poke-border shrink-0">
        <button
          type="button"
          onClick={() => setGroupByTier((v) => !v)}
          aria-pressed={groupByTier}
          className={`text-[10px] transition-colors ${
            groupByTier ? 'text-poke-blue' : 'text-poke-text-muted hover:text-poke-text-secondary'
          }`}
        >
          {t('speciesPicker.groupByTier')}
        </button>
        <div className="flex-1" />
        {sortCriteria.length > 0 && (
          <button
            type="button"
            onClick={() => setSortCriteria([])}
            className="text-[10px] text-poke-text-muted hover:text-poke-text-secondary transition-colors"
          >
            {t('speciesPicker.clearSort')}
          </button>
        )}
      </div>

      {/* Column headers — tap any column to build the sort stack (all breakpoints) */}
      <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-1 border-b border-poke-border bg-poke-surface/50 text-[9px] sm:text-[10px] font-medium text-poke-text-muted select-none shrink-0">
        <div className="shrink-0" style={{ width: 32 }} />
        <div className="flex-1 min-w-0" />
        <div className="flex items-center shrink-0">
          <button
            type="button"
            className={`${TIER_COL} text-center transition-colors hover:text-poke-text-secondary ${
              isSorted('tier') ? 'text-poke-blue' : ''
            }`}
            onClick={() => handleSort('tier')}
          >
            {t('speciesPicker.tier')}{sortIndicator('tier')}
          </button>
          {STAT_COLUMNS.map((key) => (
            <button
              key={key}
              type="button"
              className={`${STAT_COL} text-center whitespace-nowrap transition-colors hover:text-poke-text-secondary ${
                isSorted(key) ? 'text-poke-blue' : ''
              }`}
              onClick={() => handleSort(key)}
              title={localizeStat(key, dl, 'long')}
            >
              {localizeStat(key, dl, 'short')}
              {sortIndicator(key)}
            </button>
          ))}
          <button
            type="button"
            className={`${BST_COL} text-center transition-colors hover:text-poke-text-secondary ${
              isSorted('bst') ? 'text-poke-blue' : ''
            }`}
            onClick={() => handleSort('bst')}
          >
            {t('speciesPicker.bst')}{sortIndicator('bst')}
          </button>
          <button
            type="button"
            className={`${PICK_COL} text-right transition-colors hover:text-poke-text-secondary ${
              isSorted('pick') ? 'text-poke-blue' : ''
            }`}
            onClick={() => handleSort('pick')}
          >
            {draft ? t('speciesPicker.cost') : t('speciesPicker.pickPct')}
            {sortIndicator('pick')}
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-sm text-poke-text-muted">{t('common.loading')}</div>
        ) : sorted.length === 0 ? (
          <div className="p-4 text-center text-sm text-poke-text-muted">{t('speciesPicker.empty')}</div>
        ) : view.groups ? (
          view.groups.map((group) => (
            <div key={group.tier ?? '__untiered'}>
              {/* Sticky tier header — opaque bg so rows don't ghost through */}
              <div className="sticky top-0 z-10 bg-poke-surface border-b border-poke-border px-2 sm:px-4 py-1 text-[10px] font-semibold text-poke-text-secondary">
                {group.label}{' '}
                <span className="text-poke-text-muted">({group.items.length})</span>
              </div>
              {group.items.map(renderRow)}
            </div>
          ))
        ) : (
          sorted.map(renderRow)
        )}
      </div>
    </div>
  );
}
