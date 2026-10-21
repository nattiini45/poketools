'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import TypeSprite from '@/components/shared/TypeSprite';
import CategoryIcon from '@/components/shared/CategoryIcon';
import { useDataLocale, useLocale, useT } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { localizeMove, moveSearchKeys } from '@/lib/pkmn/i18n/names/moves';
import { localizeMoveCategory, localizeType } from '@/lib/pkmn/i18n/names/misc';
import { compareDisplayNames, matchRank, NO_MATCH } from '@/lib/pkmn/i18n/search';
import type { MoveCategory } from '@/lib/pkmn/i18n/types';
import { useEditorContext } from '../editor/EditorContext';
import { useSpeciesData, type SpeciesMoveEntry } from '../hooks/useSpeciesData';
import { useUsageDetail } from '../hooks/useUsageDetail';
import { TYPE_NAMES } from '../constants';
import DescFallbackTag from './DescFallbackTag';
import { formatUsagePct } from './usagePercent';

type SortField = 'name' | 'power' | 'accuracy' | 'pp' | 'usage';
type SortDir = 'asc' | 'desc';

/** English keys (filter values); only the rendered label is localized. */
const CATEGORIES: readonly MoveCategory[] = ['Physical', 'Special', 'Status'];

/** A learnset row; `shortDescLang` is present once the moves request carries `?lang=` (pkmn-l10n §3.6). */
type MoveRow = SpeciesMoveEntry & { shortDescLang?: Locale };

interface MovePickerProps {
  species: string;
  moveIndex: number;
  currentMoves: string[];
  onSelect: (moveName: string) => void;
  onClose: () => void;
}

/**
 * MovePicker — full learnset list shown when a move slot is clicked.
 *
 * Columns: type sprite, category icon, name, description, BP, accuracy, PP,
 * and usage% for the current meta. Filterable by text, category, and type;
 * every column sortable. Usage data from /api/usage-stats/[pokemon].
 */
export default function MovePicker({
  species,
  moveIndex,
  currentMoves,
  onSelect,
  onClose,
}: MovePickerProps) {
  const { state } = useEditorContext();
  const { data, loading } = useSpeciesData(species, state.generation);
  const usageDetail = useUsageDetail(species, state.format, state.seasonId);
  const t = useT(teambuilderIntelMessages);
  const locale = useLocale();
  const dl = useDataLocale();

  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('usage');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const moveUsage = useMemo<Record<string, number>>(
    () => usageDetail?.moves ?? {},
    [usageDetail],
  );

  const displayResults = useMemo(() => {
    let moves: readonly MoveRow[] = data?.moves ?? [];

    if (query.length > 0) {
      // Matches English and German names whatever the locale ("kehrtwende" finds U-turn)
      moves = moves.filter((m) => matchRank(query, moveSearchKeys(m.name)) !== NO_MATCH);
    }
    if (categoryFilter) {
      moves = moves.filter((m) => m.category === categoryFilter);
    }
    if (typeFilter) {
      moves = moves.filter((m) => m.type === typeFilter);
    }

    return [...moves].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = compareDisplayNames(localizeMove(a.name, dl), localizeMove(b.name, dl), dl);
          break;
        case 'power':
          cmp = (a.basePower ?? 0) - (b.basePower ?? 0);
          break;
        case 'accuracy': {
          const accA = a.accuracy === true ? 101 : (a.accuracy ?? 0);
          const accB = b.accuracy === true ? 101 : (b.accuracy ?? 0);
          cmp = accA - accB;
          break;
        }
        case 'pp':
          cmp = (a.pp ?? 0) - (b.pp ?? 0);
          break;
        case 'usage':
          cmp = (moveUsage[a.name] ?? -1) - (moveUsage[b.name] ?? -1);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, query, categoryFilter, typeFilter, sortField, sortDir, moveUsage, dl]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'name' ? 'asc' : 'desc');
    }
  };

  const sortArrow = (field: SortField) => {
    if (sortField !== field) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  return (
    <div className="flex flex-col border border-poke-border rounded-lg overflow-hidden bg-poke-elevated">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-poke-border bg-poke-surface">
        <h4 className="text-xs font-semibold text-poke-text-primary">
          {t('movePicker.title', { n: moveIndex + 1 })}
        </h4>
        <button
          type="button"
          className="text-xs text-poke-text-muted hover:text-poke-text-secondary transition-colors"
          onClick={onClose}
        >
          {t('common.done')}
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-poke-border">
        <input
          ref={inputRef}
          type="text"
          className="w-full bg-poke-surface border border-poke-border rounded px-2.5 py-1.5 text-xs text-poke-text-primary placeholder:text-poke-text-muted focus:ring-1 focus:ring-poke-focus/40 focus:border-poke-focus/40 transition-all outline-none"
          placeholder={t('movePicker.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && displayResults.length > 0) {
              const first = displayResults.find((m) => !currentMoves.includes(m.name));
              if (first) onSelect(first.name);
            }
          }}
        />
      </div>

      {/* Filter bar */}
      <div className="px-3 py-1.5 border-b border-poke-border space-y-1.5">
        <div className="flex items-center gap-1.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                categoryFilter === cat
                  ? 'bg-poke-blue/20 text-poke-blue ring-1 ring-poke-blue/30'
                  : 'bg-poke-surface text-poke-text-muted hover:text-poke-text-secondary'
              }`}
              onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
            >
              <CategoryIcon category={cat} size={13} />
              {localizeMoveCategory(cat, dl)}
            </button>
          ))}
          <select
            className="ml-auto text-[10px] bg-poke-surface border border-poke-border rounded px-1.5 py-0.5 text-poke-text-secondary focus:ring-1 focus:ring-poke-focus/40 outline-none"
            value={typeFilter ?? ''}
            onChange={(e) => setTypeFilter(e.target.value || null)}
            aria-label={t('movePicker.filterByType')}
          >
            <option value="">{t('movePicker.allTypes')}</option>
            {TYPE_NAMES.map((type) => (
              <option key={type} value={type}>
                {localizeType(type, dl)}
              </option>
            ))}
          </select>
        </div>

        {/* Sort controls aligned to result columns */}
        <div className="flex items-center gap-1.5 text-[9px] text-poke-text-muted">
          <span className="w-8 shrink-0" aria-hidden="true" />
          <button
            type="button"
            className={`min-w-[4rem] text-left rounded px-1 py-0.5 transition-colors ${
              sortField === 'name'
                ? 'bg-poke-blue/20 text-poke-blue font-semibold'
                : 'hover:text-poke-text-secondary'
            }`}
            onClick={() => handleSort('name')}
          >
            {t('common.name')}{sortArrow('name')}
          </button>
          <span className="flex-1" />
          {(
            [
              ['power', t('movePicker.power'), 'w-7'],
              ['accuracy', t('movePicker.accuracy'), 'w-8'],
              ['pp', t('movePicker.pp'), 'w-6'],
              ['usage', t('common.usePct'), 'w-11'],
            ] as [SortField, string, string][]
          ).map(([field, label, widthClass]) => (
            <button
              key={field}
              type="button"
              className={`${widthClass} rounded px-0.5 py-0.5 text-right transition-colors ${
                sortField === field
                  ? 'bg-poke-blue/20 text-poke-blue font-semibold'
                  : 'hover:text-poke-text-secondary'
              }`}
              onClick={() => handleSort(field)}
            >
              {label}
              {sortArrow(field)}
            </button>
          ))}
        </div>
      </div>

      {/* Results list */}
      <div className="max-h-64 overflow-y-auto">
        {loading ? (
          <div className="p-3 text-center text-xs text-poke-text-muted">{t('movePicker.loading')}</div>
        ) : displayResults.length === 0 ? (
          <div className="p-3 text-center text-xs text-poke-text-muted">
            {t('movePicker.empty')}
          </div>
        ) : (
          displayResults.map((move) => {
            const isUsed = currentMoves.includes(move.name);
            const pct = moveUsage[move.name];
            const displayName = localizeMove(move.name, dl);

            return (
              <button
                key={move.name}
                type="button"
                className={`w-full flex items-center gap-1.5 px-3 py-1.5 text-left transition-colors ${
                  isUsed ? 'bg-poke-blue/10 opacity-60' : 'hover:bg-poke-surface'
                }`}
                onClick={() => !isUsed && onSelect(move.name)}
                disabled={isUsed}
                title={move.shortDesc || displayName}
              >
                {move.type ? (
                  <TypeSprite type={move.type} size={14} className="shrink-0" />
                ) : (
                  <span className="w-7 shrink-0" />
                )}
                {move.category ? (
                  <CategoryIcon category={move.category} size={14} className="shrink-0" />
                ) : (
                  <span className="w-3.5 shrink-0" />
                )}
                <span className="text-xs text-poke-text-primary shrink-0">
                  {displayName}
                  {isUsed && <span className="ml-1 text-poke-blue text-[9px]">✓</span>}
                </span>
                {move.shortDesc ? (
                  <span className="text-[9px] text-poke-text-muted flex-1 truncate ml-1 hidden sm:inline">
                    {move.shortDesc}
                    <DescFallbackTag descLang={move.shortDescLang} />
                  </span>
                ) : (
                  <span className="flex-1" />
                )}
                <span className="sm:hidden flex-1" />
                <span
                  className="text-[10px] text-poke-text-muted shrink-0 w-7 text-right tabular-nums"
                  title={t('movePicker.powerTitle')}
                >
                  {move.basePower ? move.basePower : ''}
                </span>
                <span
                  className="text-[10px] text-poke-text-muted shrink-0 w-8 text-right tabular-nums"
                  title={t('movePicker.accuracyTitle')}
                >
                  {move.accuracy === true
                    ? '—'
                    : move.accuracy != null
                      ? formatUsagePct(move.accuracy / 100, locale, 0)
                      : ''}
                </span>
                <span
                  className="text-[10px] text-poke-text-muted shrink-0 w-6 text-right tabular-nums"
                  title={t('movePicker.ppTitle')}
                >
                  {move.pp ?? ''}
                </span>
                <span
                  className="text-[10px] shrink-0 w-11 text-right tabular-nums text-poke-text-secondary"
                  title={t('common.usage')}
                >
                  {pct !== undefined ? formatUsagePct(pct, locale) : ''}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
