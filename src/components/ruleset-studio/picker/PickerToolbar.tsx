'use client';

import { useId, type KeyboardEvent, type RefObject } from 'react';
import { ArrowDown, ArrowUp, LayoutGrid, Redo2, Rows3, Search, SlidersHorizontal, Table2, Undo2, X } from 'lucide-react';
import { useT } from '@/i18n/client';
import { rulesetStudioPickerMessages } from '@/i18n/messages/ruleset-studio/picker';
import type { RulesetCategory } from '@/lib/ruleset-kit/types';
import { DENSITIES, type Density } from '@/lib/ruleset-studio/editor/picker/layout';
import { SORTS_BY_KIND, type SortKey, type SortSpec } from '@/lib/ruleset-studio/editor/picker/view';
import type { CatalogKind } from '@/lib/pkmn/catalog-index';
import { cn } from '@/lib/utils/cn';

interface PickerToolbarProps {
  category: RulesetCategory;
  kind: CatalogKind;
  searchRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (query: string) => void;
  sort: SortSpec;
  onSort: (sort: SortSpec) => void;
  /** A text query decides the order: the sort controls say so. */
  queryDecidesOrder: boolean;
  density: Density;
  onDensity: (density: Density) => void;
  filtersOpen: boolean;
  onFiltersOpen: (open: boolean) => void;
  filterCount: number;
  includeFormes: boolean;
  onIncludeFormes: (value: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Called when Escape is pressed in the search box with text in it (clears) or without (hands focus back to the list). */
  onSearchEscape: () => void;
}

const DENSITY_ICON = { grid: LayoutGrid, compact: Rows3, table: Table2 } as const;
const BUTTON = 'inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-poke-md border px-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9';

/**
 * The picker's control bar: search, sort, density, the filter toggle, undo and redo, and (for Pokémon) the "include all
 * formes" switch. The search box is a plain input; `/` in the list focuses it. The density control is a radio group with
 * the arrow-key behaviour of one.
 */
export default function PickerToolbar({
  category,
  kind,
  searchRef,
  query,
  onQuery,
  sort,
  onSort,
  queryDecidesOrder,
  density,
  onDensity,
  filtersOpen,
  onFiltersOpen,
  filterCount,
  includeFormes,
  onIncludeFormes,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSearchEscape,
}: PickerToolbarProps) {
  const t = useT(rulesetStudioPickerMessages);
  const searchId = useId();
  const sortId = useId();
  const formesId = useId();
  const sorts = SORTS_BY_KIND[kind];

  const onDensityKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = DENSITIES.indexOf(density);
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % DENSITIES.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + DENSITIES.length - 1) % DENSITIES.length;
    else return;
    event.preventDefault();
    onDensity(DENSITIES[next]);
    // The roving tab stop follows the selection.
    requestAnimationFrame(() => document.getElementById(`${searchId}-density-${DENSITIES[next]}`)?.focus());
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <label htmlFor={searchId} className="sr-only">
            {t(`search.label.${category}`)}
          </label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-poke-text-muted" aria-hidden="true" />
          <input
            id={searchId}
            ref={searchRef}
            type="search"
            value={query}
            placeholder={t('search.placeholder')}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                if (query !== '') onQuery('');
                else onSearchEscape();
              }
            }}
            className="h-11 w-full rounded-poke-md border border-poke-border bg-poke-surface pl-9 pr-9 text-sm text-poke-text-primary placeholder:text-poke-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-poke-focus sm:h-9 [&::-webkit-search-cancel-button]:hidden"
          />
          {query !== '' && (
            <button
              type="button"
              aria-label={t('search.clear')}
              onClick={() => {
                onQuery('');
                searchRef.current?.focus();
              }}
              className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-poke-md text-poke-text-muted hover:text-poke-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-poke-focus sm:h-7 sm:w-7"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        <button
          type="button"
          aria-expanded={filtersOpen}
          onClick={() => onFiltersOpen(!filtersOpen)}
          className={cn(BUTTON, filtersOpen || filterCount > 0 ? 'border-poke-accent bg-poke-accent-light text-poke-text-primary' : 'border-poke-border bg-poke-surface text-poke-text-secondary hover:bg-poke-muted')}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          {filterCount > 0 ? t('filters.toggleCount', { count: filterCount }) : t('filters.toggle')}
        </button>

        <div className="flex items-center gap-1">
          <button type="button" className={cn(BUTTON, 'w-11 border-poke-border bg-poke-surface text-poke-text-secondary hover:bg-poke-muted sm:w-9 sm:px-0')} disabled={!canUndo} onClick={onUndo} aria-label={t('history.undo')} aria-keyshortcuts="Control+Z Meta+Z">
            <Undo2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={cn(BUTTON, 'w-11 border-poke-border bg-poke-surface text-poke-text-secondary hover:bg-poke-muted sm:w-9 sm:px-0')} disabled={!canRedo} onClick={onRedo} aria-label={t('history.redo')} aria-keyshortcuts="Control+Shift+Z Control+Y Meta+Shift+Z">
            <Redo2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5">
          <label htmlFor={sortId} className="text-xs font-semibold text-poke-text-secondary">
            {t('sort.label')}
          </label>
          <select
            id={sortId}
            value={sort.key}
            disabled={queryDecidesOrder}
            onChange={(event) => onSort({ key: event.target.value as SortKey, direction: event.target.value === 'bst' || event.target.value === 'power' ? 'desc' : 'asc' })}
            className="h-11 rounded-poke-md border border-poke-border bg-poke-surface px-2 text-sm text-poke-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-poke-focus disabled:opacity-50 sm:h-9"
          >
            {sorts.map((key) => (
              <option key={key} value={key}>
                {t(`sort.${key}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={`${t('sort.direction')}: ${sort.direction === 'asc' ? t('sort.asc') : t('sort.desc')}`}
            disabled={queryDecidesOrder}
            onClick={() => onSort({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}
            className={cn(BUTTON, 'w-11 border-poke-border bg-poke-surface px-0 text-poke-text-secondary hover:bg-poke-muted sm:w-9')}
          >
            {sort.direction === 'asc' ? <ArrowUp className="h-4 w-4" aria-hidden="true" /> : <ArrowDown className="h-4 w-4" aria-hidden="true" />}
          </button>
          {queryDecidesOrder && <span className="hidden text-xs text-poke-text-muted lg:inline">{t('sort.byQuery')}</span>}
        </div>

        <div role="radiogroup" aria-label={t('density.label')} className="inline-flex overflow-hidden rounded-poke-md border border-poke-border">
          {DENSITIES.map((option) => {
            const Icon = DENSITY_ICON[option];
            const checked = option === density;
            return (
              <button
                key={option}
                id={`${searchId}-density-${option}`}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                title={option === 'table' ? t('density.tableHelp') : undefined}
                onClick={() => onDensity(option)}
                onKeyDown={onDensityKey}
                className={cn(
                  'inline-flex min-h-11 items-center gap-1.5 px-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-poke-focus sm:min-h-9',
                  checked ? 'bg-poke-accent text-poke-surface' : 'bg-poke-surface text-poke-text-secondary hover:bg-poke-muted',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">{t(`density.${option}`)}</span>
              </button>
            );
          })}
        </div>

        {kind === 'species' && (
          <label htmlFor={formesId} className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-poke-text-secondary sm:min-h-9" title={t('forme.includeHelp')}>
            <input id={formesId} type="checkbox" className="h-4 w-4 accent-poke-accent" checked={includeFormes} onChange={(event) => onIncludeFormes(event.target.checked)} />
            {t('forme.include')}
          </label>
        )}
      </div>
    </div>
  );
}
