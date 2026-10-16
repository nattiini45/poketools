'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { PointBuyListEntry } from '@/types/point-buy';
import { PRICE_GROUPS, type PriceGroup } from '@/types/point-buy';
import type { TeamRole } from '@/types/format-rules';
import { TEAM_ROLE_CATEGORIES } from '@/types/format-rules';
import PokemonSprite from '@/components/shared/PokemonSprite';
import { useDataLocale, useT } from '@/i18n/client';
import { enumLabel } from '@/i18n/content/enum-label';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { draftLegacyMessages } from '@/i18n/messages/draft/legacy';
import { draftLegacyEvolutionMessages } from '@/i18n/messages/draft/legacy/evolution';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';
import PointBuyDetailCard from '@/components/evolution/PointBuyDetailCard';
import Table, { type Column, type TableRowExtraProps } from '@/components/ui/Table';
import { cn } from '@/lib/utils/cn';
import {
  DEFAULT_POINT_BUY_FILTERS,
  PRICE_GROUP_RANGES,
  filterPointBuyEntries,
  parsePointBuyFilters,
  pointBuyFiltersToParams,
  type PointBuyFilters,
  type SpecialRuleFilter,
} from '@/lib/evolution/point-buy-display';

interface PointBuyTableProps {
  entries: PointBuyListEntry[];
  typesBySpecies: Record<string, string[]>;
  rolesBySpecies: Record<string, TeamRole[]>;
  bannedMoves: string[];
  /** Distinct Pokémon types across all lines (for filter dropdown) */
  availableTypes: string[];
}

const PRICE_GROUP_COLORS: Record<PriceGroup, string> = {
  premium: 'bg-red-900/30 text-red-400',
  hoch: 'bg-orange-900/30 text-orange-400',
  mittel: 'bg-blue-900/30 text-blue-400',
  guenstig: 'bg-green-900/30 text-green-400',
  budget: 'bg-gray-800/30 text-gray-400',
};

/** Special-rule filter options; labels in `draft/legacy/evolution.pointBuy.ruleFilter`. */
const SPECIAL_RULE_OPTIONS: readonly SpecialRuleFilter[] = ['scatterbug', 'no_cocoon_rule', 'cosmog', 'no_redraft', 'has_text'];

function PointBuyTableInner({
  entries,
  typesBySpecies,
  rolesBySpecies,
  bannedMoves,
  availableTypes,
}: PointBuyTableProps) {
  const t = useT(draftLegacyEvolutionMessages);
  const tLegacy = useT(draftLegacyMessages);
  const tCommon = useT(commonMessages);
  const tGlossary = useT(glossaryMessages);
  const tEnums = useT(enumMessages);
  const dataLocale = useDataLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = useMemo(
    () => parsePointBuyFilters(searchParams),
    [searchParams],
  );

  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const updateFilters = useCallback(
    (patch: Partial<PointBuyFilters>) => {
      const next = { ...filters, ...patch };
      const params = pointBuyFiltersToParams(next);
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [filters, router],
  );

  const filtered = useMemo(
    () => filterPointBuyEntries(entries, filters, typesBySpecies, rolesBySpecies),
    [entries, filters, typesBySpecies, rolesBySpecies],
  );

  const pointBuyColumns = useMemo((): Column<PointBuyListEntry>[] => [
    {
      key: 'line',
      header: '#',
      sortable: true,
      sortValue: (entry) => entry.line_number,
      render: (entry) => <span className="text-poke-text-secondary">{entry.line_number}</span>,
    },
    {
      key: 'pokemon',
      header: t('pointBuy.columns.pokemon'),
      sortable: true,
      sortValue: (entry) => localizeSpecies(entry.base_pokemon, dataLocale),
      render: (entry) => (
        <div className="flex items-center gap-2">
          <PokemonSprite name={entry.base_pokemon} size={32} />
          <div className="min-w-0">
            <span className="font-medium">{localizeSpecies(entry.base_pokemon, dataLocale)}</span>
            <span className="ml-1 text-xs text-poke-text-secondary">
              → {localizeSpecies(entry.stage2_pokemon, dataLocale)}
              {entry.stage3_pokemon && ` → ${localizeSpecies(entry.stage3_pokemon, dataLocale)}`}
            </span>
            {(entry.special_rules || entry.special_rules_text) && (
              <span className="ml-1 text-xs text-yellow-500" title={t('pointBuy.specialRules')}>★</span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'price',
      header: tGlossary('price.price'),
      align: 'center',
      sortable: true,
      sortValue: (entry) => entry.price,
      render: (entry) => <span className="font-semibold">{entry.price}</span>,
    },
    {
      key: 'killsS2',
      header: t('pointBuy.columns.killsS2'),
      align: 'center',
      sortable: true,
      sortValue: (entry) => entry.kills_to_stage2,
      render: (entry) => entry.kills_to_stage2,
    },
    {
      key: 'killsS3',
      header: t('pointBuy.columns.killsS3'),
      align: 'center',
      sortable: true,
      sortValue: (entry) => entry.additional_kills_to_stage3 ?? -1,
      render: (entry) => entry.additional_kills_to_stage3 ?? '—',
    },
    {
      key: 'early',
      header: t('pointBuy.early'),
      align: 'center',
      render: (entry) => entry.early_rating ?? '—',
    },
    {
      key: 'mid',
      header: t('pointBuy.mid'),
      align: 'center',
      render: (entry) => entry.mid_rating ?? '—',
    },
    {
      key: 'late',
      header: t('pointBuy.late'),
      align: 'center',
      render: (entry) => entry.late_rating ?? '—',
    },
    {
      key: 'group',
      header: t('pointBuy.columns.group'),
      sortable: true,
      sortValue: (entry) => entry.price_group,
      render: (entry) => (
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${PRICE_GROUP_COLORS[entry.price_group]}`}>
          {enumLabel(tEnums, 'priceGroup', entry.price_group)}
        </span>
      ),
    },
  ], [t, tGlossary, tEnums, dataLocale]);

  const activeEntry = useMemo(() => {
    const id = pinnedId ?? (isMobile ? null : hoveredId);
    if (!id) return null;
    return entries.find((e) => e.id === id) ?? null;
  }, [pinnedId, hoveredId, isMobile, entries]);

  const distinctKillsS2 = useMemo(
    () => [...new Set(entries.map((e) => e.kills_to_stage2))].sort((a, b) => a - b),
    [entries],
  );
  const distinctKillsS3 = useMemo(
    () => [...new Set(entries.map((e) => e.additional_kills_to_stage3).filter((v): v is number => v !== null))].sort((a, b) => a - b),
    [entries],
  );
  /** Base species of the first line carrying each species-named special rule. */
  const ruleLineBase = useMemo(
    () => ({
      cosmog: entries.find((e) => e.special_rules?.cosmog)?.base_pokemon ?? null,
      scatterbug: entries.find((e) => e.special_rules?.scatterbug)?.base_pokemon ?? null,
    }),
    [entries],
  );
  const distinctRatings = useMemo(() => {
    const vals = new Set<number>();
    for (const e of entries) {
      if (e.early_rating !== null) vals.add(e.early_rating);
      if (e.mid_rating !== null) vals.add(e.mid_rating);
      if (e.late_rating !== null) vals.add(e.late_rating);
    }
    return [...vals].sort((a, b) => a - b);
  }, [entries]);

  const clearHoverTimer = () => {
    if (hoverCloseTimer.current) {
      clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = null;
    }
  };

  const scheduleHoverClose = () => {
    clearHoverTimer();
    if (pinnedId) return;
    hoverCloseTimer.current = setTimeout(() => setHoveredId(null), 200);
  };

  const closeDetail = useCallback(() => {
    setPinnedId(null);
    setHoveredId(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDetail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeDetail]);

  useEffect(() => {
    if (!activeEntry || isMobile) return;
    const onPointerDown = (e: PointerEvent) => {
      if (cardRef.current?.contains(e.target as Node)) return;
      if (pinnedId) closeDetail();
      else setHoveredId(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [activeEntry, isMobile, pinnedId, closeDetail]);

  const openMobile = (entry: PointBuyListEntry) => {
    setPinnedId(entry.id);
  };

  const handleRowEnter = (id: string) => {
    if (isMobile || pinnedId) return;
    clearHoverTimer();
    setHoveredId(id);
  };

  const getPointBuyRowProps = (entry: PointBuyListEntry): TableRowExtraProps => ({
    className: cn(
      (pinnedId === entry.id || hoveredId === entry.id) && 'bg-poke-elevated/60',
    ),
    onMouseEnter: () => handleRowEnter(entry.id),
    onMouseLeave: scheduleHoverClose,
    onClick: () => {
      if (isMobile) openMobile(entry);
      else setPinnedId((prev) => (prev === entry.id ? null : entry.id));
    },
    tabIndex: 0,
    onKeyDown: (e) => {
      if (e.key === 'Enter') {
        if (isMobile) openMobile(entry);
        else setPinnedId(entry.id);
      }
    },
    role: 'button',
    'aria-label': t('pointBuy.viewDetails', { name: localizeSpecies(entry.base_pokemon, dataLocale) }),
    'aria-pressed': pinnedId === entry.id,
  });

  return (
    <div className="relative">
      {/* Filters */}
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          <input
            type="search"
            placeholder={t('pointBuy.searchPlaceholder')}
            value={filters.search}
            onChange={(e) => updateFilters({ search: e.target.value })}
            className="min-w-[12rem] flex-1 rounded-lg border border-poke-border bg-poke-elevated px-3 py-1.5 text-sm text-poke-text placeholder:text-poke-text-secondary focus:border-blue-500 focus:outline-none"
            aria-label={t('pointBuy.searchAria')}
          />
          <select
            value={filters.priceGroup}
            onChange={(e) => updateFilters({ priceGroup: e.target.value })}
            className="rounded-lg border border-poke-border bg-poke-elevated px-3 py-1.5 text-sm text-poke-text focus:border-blue-500 focus:outline-none"
            aria-label={t('pointBuy.filterPriceGroup')}
          >
            <option value="">{t('pointBuy.allPriceGroups')}</option>
            {PRICE_GROUPS.map((group) => (
              <option key={group} value={group}>
                {tLegacy('priceGroupRange', {
                  group: enumLabel(tEnums, 'priceGroup', group),
                  min: PRICE_GROUP_RANGES[group][0],
                  max: PRICE_GROUP_RANGES[group][1],
                })}
              </option>
            ))}
          </select>
          <select
            value={filters.type}
            onChange={(e) => updateFilters({ type: e.target.value })}
            className="rounded-lg border border-poke-border bg-poke-elevated px-3 py-1.5 text-sm text-poke-text focus:border-blue-500 focus:outline-none"
            aria-label={t('pointBuy.filterType')}
          >
            <option value="">{t('pointBuy.allTypes')}</option>
            {availableTypes.map((type) => (
              <option key={type} value={type}>{localizeType(type, dataLocale)}</option>
            ))}
          </select>
          <select
            value={filters.teamRole}
            onChange={(e) => updateFilters({ teamRole: e.target.value })}
            className="rounded-lg border border-poke-border bg-poke-elevated px-3 py-1.5 text-sm text-poke-text focus:border-blue-500 focus:outline-none"
            aria-label={t('pointBuy.filterTeamRole')}
          >
            <option value="">{t('pointBuy.allTeamRoles')}</option>
            {TEAM_ROLE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{tLegacy(`teamRole.${cat}`)}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-2">
          <FilterNumberSelect
            label={t('pointBuy.priceMin')}
            value={filters.priceMin}
            options={[8, 10, 13, 18, 23, 27]}
            onChange={(v) => updateFilters({ priceMin: v })}
          />
          <FilterNumberSelect
            label={t('pointBuy.priceMax')}
            value={filters.priceMax}
            options={[12, 17, 22, 26, 30]}
            onChange={(v) => updateFilters({ priceMax: v })}
          />
          <FilterNumberSelect
            label={t('pointBuy.columns.killsS2')}
            value={filters.killsS2}
            options={distinctKillsS2}
            onChange={(v) => updateFilters({ killsS2: v })}
          />
          <FilterNumberSelect
            label={t('pointBuy.killsS3Plus')}
            value={filters.killsS3}
            options={distinctKillsS3}
            onChange={(v) => updateFilters({ killsS3: v })}
          />
          <FilterNumberSelect
            label={t('pointBuy.early')}
            value={filters.early}
            options={distinctRatings}
            onChange={(v) => updateFilters({ early: v })}
          />
          <FilterNumberSelect
            label={t('pointBuy.mid')}
            value={filters.mid}
            options={distinctRatings}
            onChange={(v) => updateFilters({ mid: v })}
          />
          <FilterNumberSelect
            label={t('pointBuy.late')}
            value={filters.late}
            options={distinctRatings}
            onChange={(v) => updateFilters({ late: v })}
          />
          <select
            value={filters.specialRule}
            onChange={(e) => updateFilters({ specialRule: e.target.value as PointBuyFilters['specialRule'] })}
            className="rounded-lg border border-poke-border bg-poke-elevated px-2 py-1 text-xs text-poke-text focus:border-blue-500 focus:outline-none"
            aria-label={t('pointBuy.filterSpecialRules')}
          >
            <option value="">{t('pointBuy.specialRules')}</option>
            {SPECIAL_RULE_OPTIONS.map((rule) => {
              // The species-named rules are labelled with the line that carries them (no hard-coded names).
              if (rule === 'cosmog' || rule === 'scatterbug') {
                const base = ruleLineBase[rule];
                if (!base) return null;
                const species = localizeSpecies(base, dataLocale);
                return (
                  <option key={rule} value={rule}>
                    {rule === 'cosmog' ? species : t('pointBuy.ruleFilter.scatterbug', { species })}
                  </option>
                );
              }
              return (
                <option key={rule} value={rule}>
                  {t(`pointBuy.ruleFilter.${rule}`)}
                </option>
              );
            })}
          </select>
          <button
            type="button"
            onClick={() => router.replace('?', { scroll: false })}
            className="rounded-lg border border-poke-border px-2 py-1 text-xs text-poke-text-secondary hover:bg-poke-elevated"
          >
            {tCommon('actions.clearFilters')}
          </button>
          <span className="self-center text-xs text-poke-text-secondary">
            {t('pointBuy.lineCount', { shown: filtered.length, total: entries.length })}
          </span>
        </div>
      </div>

      {/* Table */}
      <Table
        columns={pointBuyColumns}
        data={filtered}
        keyExtractor={(entry) => entry.id}
        getRowProps={getPointBuyRowProps}
        emptyMessage={t('pointBuy.empty')}
      />

      {/* Desktop: pinned/hover floating card */}
      {activeEntry && !isMobile && (
        <div
          ref={cardRef}
          className="fixed bottom-4 right-4 z-40 max-h-[85vh] overflow-y-auto"
          onMouseEnter={clearHoverTimer}
          onMouseLeave={scheduleHoverClose}
        >
          <PointBuyDetailCard
            entry={activeEntry}
            typesBySpecies={typesBySpecies}
            rolesBySpecies={rolesBySpecies}
            bannedMoves={bannedMoves}
            onClose={closeDetail}
            inline
          />
          {pinnedId && (
            <p className="mt-1 text-center text-[10px] text-poke-text-muted">{t('pointBuy.pinnedHint')}</p>
          )}
        </div>
      )}

      {/* Mobile: modal drawer */}
      {activeEntry && isMobile && pinnedId && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
          onClick={closeDetail}
          role="presentation"
        >
          <div onClick={(e) => e.stopPropagation()}>
            <PointBuyDetailCard
              entry={activeEntry}
              typesBySpecies={typesBySpecies}
              rolesBySpecies={rolesBySpecies}
              bannedMoves={bannedMoves}
              onClose={closeDetail}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function FilterNumberSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number | null;
  options: number[];
  onChange: (v: number | null) => void;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className="rounded-lg border border-poke-border bg-poke-elevated px-2 py-1 text-xs text-poke-text focus:border-blue-500 focus:outline-none"
      aria-label={label}
    >
      <option value="">{label}</option>
      {options.map((n) => (
        <option key={n} value={n}>{n}</option>
      ))}
    </select>
  );
}

export default function PointBuyTable(props: PointBuyTableProps) {
  const t = useT(draftLegacyEvolutionMessages);
  return (
    <Suspense fallback={<div className="text-sm text-poke-text-secondary">{t('pointBuy.loadingList')}</div>}>
      <PointBuyTableInner {...props} />
    </Suspense>
  );
}

export { DEFAULT_POINT_BUY_FILTERS };
