'use client';

import { useCallback, useDeferredValue, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Keyboard } from 'lucide-react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Skeleton from '@/components/ui/Skeleton';
import { useDataLocale, useLocale, useT } from '@/i18n/client';
import { rulesetStudioPickerMessages } from '@/i18n/messages/ruleset-studio/picker';
import { wikiMessages } from '@/i18n/messages/wiki';
import type { CatalogEntry, CatalogScope } from '@/lib/pkmn/catalog-index';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';
import { stateLookup, type EntryState } from '@/lib/ruleset-kit/entry-state';
import type { CategoryRules, RulesetCategory } from '@/lib/ruleset-kit/types';
import type { PresetList } from '@/lib/pkmn/preset-rules';
import { WIKI_ITEM_CATEGORY_KEYS } from '@/lib/wiki/item-category';
import { needsConfirmation, resolveTargets, type BulkAction, type BulkScope } from '@/lib/ruleset-studio/editor/picker/bulk';
import { isSpeciesIndex } from '@/lib/ruleset-studio/editor/picker/entry-index';
import { reduceKey, type NavContext, type NavState } from '@/lib/ruleset-studio/editor/picker/keyboard';
import {
  GAP,
  buildRows,
  cellWidthOf,
  columnsFor,
  roomFor,
  defaultDensity,
  positionsOf,
  rowHeightFor,
  type Density,
} from '@/lib/ruleset-studio/editor/picker/layout';
import { EMPTY_SELECTION, hiddenCount, isSelected, selectAll, selectRange, toggleSelected } from '@/lib/ruleset-studio/editor/picker/selection';
import {
  EMPTY_FILTERS,
  UNTIERED,
  activeFilterCount,
  buildView,
  hasAnyFilter,
  queryDecidesOrder,
  tierOf,
  tierRank,
  type HeaderItem,
  type PickerFilters,
  type ViewContext,
} from '@/lib/ruleset-studio/editor/picker/view';
import BulkBar from './BulkBar';
import DetailBar from './DetailBar';
import { KIND_OF, displayName, displayNameOf } from '@/lib/ruleset-studio/editor/picker/display';
import EntryList from './EntryList';
import EntryOption from './EntryOption';
import EntryTable from './EntryTable';
import FacetPanel from './FacetPanel';
import PickerToolbar from './PickerToolbar';
import { useEntryIndex, useEntryText } from './usePickerData';
import { useElementSize, useMediaQuery, usePickerPrefs } from './usePickerPrefs';

export interface PickerHistory {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export interface EntryPickerProps {
  category: RulesetCategory;
  /** The document's own changes for the category. */
  rules: CategoryRules;
  /** The base preset's list for the category (null for a blank base). */
  base: PresetList | null;
  gen: number;
  scope: CatalogScope;
  doubles: boolean;
  /** The Champions preset whose roster the rows extend for. */
  presetId: string | null;
  history: PickerHistory;
  /** The picker asks the editor to apply an action to ids; forme expansion and the confirmation are done here. */
  onAct: (action: BulkAction, ids: readonly string[]) => void;
}

const NO_ENTRIES: readonly CatalogEntry[] = [];
const BLOCK_STATES: readonly EntryState[] = ['preset_banned', 'you_banned', 'you_unbanned', 'legal'];
const ALLOW_STATES: readonly EntryState[] = ['allowed', 'not_allowed'];

interface PendingAction {
  action: BulkAction;
  ids: string[];
}

/**
 * The entry picker: a searchable, filterable, virtualized list of every Pokémon, move, item or ability of the ruleset's
 * generation, with sprites and icons, the state of each entry under the document as a chip, one-click ban and unban,
 * multi-select with Shift and Ctrl, bulk actions on the selection or on everything the filters show, undo and redo, and
 * a full keyboard model on the listbox. Three densities share one data pipeline: cards, compact lines and a plain
 * paginated table (the accessible default under reduced motion or more contrast).
 *
 * The component owns only view state (search, facets, sort, density, selection, the active entry); the document is the
 * editor's. It emits `onAct(action, ids)` and the editor applies it through the kit's operations and records the history.
 */
export default function EntryPicker({ category, rules, base, gen, scope, doubles, presetId, history, onAct }: EntryPickerProps) {
  const t = useT(rulesetStudioPickerMessages);
  const tWiki = useT(wikiMessages);
  const locale = useLocale();
  const dataLocale = useDataLocale();
  const kind = KIND_OF[category];
  const listId = useId();

  const { state: indexState, retry } = useEntryIndex({ kind, gen, scope, preset: presetId });
  const index = indexState.status === 'ready' ? indexState.index : null;
  const text = useEntryText(index !== null && kind !== 'species' ? { kind, gen, scope, lang: locale, preset: presetId } : null);

  const prefs = usePickerPrefs();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const moreContrast = useMediaQuery('(prefers-contrast: more)');
  const sort = prefs.sortFor(kind);

  const [filters, setFilters] = useState<PickerFilters>(EMPTY_FILTERS);
  const deferredFilters = useDeferredValue(filters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [nav, setNav] = useState<NavState>({ active: -1, selection: EMPTY_SELECTION });
  const [listFocused, setListFocused] = useState(false);
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { ref: wrapRef, width } = useElementSize<HTMLDivElement>();

  const allowlist = rules.allow !== null;
  const lookup = useMemo(() => stateLookup(rules, base), [rules, base]);
  const ctx = useMemo<ViewContext | null>(
    () => (index === null ? null : { index, doubles, national: scope === 'national', stateOf: lookup.stateOf }),
    [index, doubles, scope, lookup],
  );
  const view = useMemo(() => (ctx === null ? null : buildView(deferredFilters, sort, ctx)), [ctx, deferredFilters, sort]);

  const entries = useMemo(() => view?.entries ?? NO_ENTRIES, [view]);
  const order = useMemo(() => entries.map((entry) => entry.id), [entries]);
  const density: Density = prefs.density ?? (width === 0 ? 'grid' : defaultDensity({ width, resultCount: entries.length, reducedMotion, moreContrast }));
  const listDensity = density === 'table' ? 'grid' : density;
  const columns = columnsFor(width, kind, density);
  const room = roomFor(cellWidthOf(width, columns));
  const rows = useMemo(() => (view === null ? [] : buildRows(view.items, columns)), [view, columns]);
  const positions = useMemo(() => positionsOf(rows), [rows]);

  const active = entries.length === 0 ? -1 : Math.min(nav.active, entries.length - 1);
  const activeEntry: CatalogEntry | null = active >= 0 ? entries[active] : null;
  const selection = nav.selection;
  const visible = useMemo(() => new Set(order), [order]);
  const optionId = (id: string) => `${listId}-opt-${id}`;
  const descriptions = text?.text ?? null;

  const tagOf = useCallback(
    (entry: CatalogEntry): string => {
      if (entry.kind === 'species') {
        const tier = tierOf(entry, doubles, scope === 'national');
        return tier === UNTIERED ? t('list.tierUntiered') : tier;
      }
      return entry.kind === 'items' ? tWiki.dynamic(`itemCategory.${WIKI_ITEM_CATEGORY_KEYS[entry.category]}`) : '';
    },
    [doubles, scope, t, tWiki],
  );

  // ── Acting on entries ─────────────────────────────────────────────────────────

  const speciesIndex = index !== null && isSpeciesIndex(index) ? index : null;
  const requestAct = useCallback(
    (action: BulkAction, ids: readonly string[], scopeOfAction: BulkScope = 'selection') => {
      const targets = resolveTargets({
        scope: scopeOfAction === 'filtered' ? 'filtered' : 'selection',
        entryId: null,
        selectedIds: ids,
        filteredIds: ids,
        includeFormes: prefs.includeFormes,
        speciesIndex,
      });
      if (targets.length === 0) return;
      if (needsConfirmation(targets.length)) setPending({ action, ids: targets });
      else onAct(action, targets);
    },
    [onAct, prefs.includeFormes, speciesIndex],
  );

  const filteredAct = (action: BulkAction, scopeOfAction: BulkScope) => {
    if (scopeOfAction === 'filtered') requestAct(action, order, 'filtered');
    else requestAct(action, [...selection.ids], 'selection');
  };

  const runCommand = (command: NonNullable<ReturnType<typeof reduceKey>['command']>) => {
    switch (command.type) {
      case 'toggle': return requestAct('toggle', command.ids);
      case 'unban': return requestAct('unban', command.ids);
      case 'reset': return requestAct('reset', command.ids);
      case 'allow': return requestAct('allow', command.ids);
      case 'focus_search': return searchRef.current?.focus();
      case 'clear_search': return setFilters((current) => ({ ...current, query: '' }));
      case 'undo': return history.onUndo();
      case 'redo': return history.onRedo();
    }
  };

  // ── Keyboard and pointer ──────────────────────────────────────────────────────

  const navContext = (): NavContext => ({
    rows,
    positions,
    order,
    pageRows: Math.max(1, Math.floor(((scrollRef.current?.clientHeight ?? 480) - 16) / (rowHeightFor(kind, listDensity) + GAP))),
    allowlist,
    hasQuery: filters.query !== '',
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const result = reduceKey(nav, { key: event.key, shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey, alt: event.altKey }, navContext());
    if (!result.handled) return;
    event.preventDefault();
    setNav(result.nav);
    if (result.command !== null) runCommand(result.command);
  };

  const onPick = useCallback(
    (entryIndex: number, event: MouseEvent<HTMLDivElement>) => {
      const entry = entries[entryIndex];
      if (entry === undefined) return;
      const pick = (event.target as HTMLElement).closest('[data-pick]')?.getAttribute('data-pick');
      scrollRef.current?.focus({ preventScroll: true });
      if (pick === 'toggle') {
        setNav((current) => ({ ...current, active: entryIndex }));
        requestAct('toggle', [entry.id]);
        return;
      }
      if (pick === 'select' || event.ctrlKey || event.metaKey) {
        setNav((current) => ({ active: entryIndex, selection: toggleSelected(current.selection, entry.id) }));
      } else if (event.shiftKey) {
        setNav((current) => ({ active: entryIndex, selection: selectRange(current.selection, order, entry.id) }));
      } else {
        setNav((current) => ({ ...current, active: entryIndex }));
      }
    },
    [entries, order, requestAct],
  );

  const updateFilters = (next: PickerFilters) => {
    setFilters(next);
    setPage(1);
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  const tiers = useMemo(() => {
    if (speciesIndex === null) return [];
    const found = new Set(speciesIndex.entries.map((entry) => tierOf(entry, doubles, scope === 'national')));
    return [...found].sort((a, b) => tierRank(a) - tierRank(b));
  }, [speciesIndex, doubles, scope]);
  const gens = useMemo(() => (index === null ? [] : [...new Set(index.entries.map((entry) => entry.gen))].sort((a, b) => a - b)), [index]);
  const itemCategories = useMemo(
    () => (index === null ? [] : [...new Set(index.entries.flatMap((entry) => (entry.kind === 'items' ? [entry.category] : [])))]),
    [index],
  );

  if (indexState.status === 'loading') {
    return (
      <div role="status" className="space-y-2" aria-label={t('loading')}>
        <span className="sr-only">{t('loading')}</span>
        <Skeleton height="2.5rem" />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} height="6rem" />
          ))}
        </div>
      </div>
    );
  }
  if (indexState.status === 'error') {
    return (
      <Alert variant="error" className="flex flex-wrap items-center justify-between gap-2">
        <span>{t('error.title')}</span>
        <Button type="button" variant="secondary" size="sm" className="min-h-11 sm:min-h-0" onClick={retry}>
          {t('error.retry')}
        </Button>
      </Alert>
    );
  }
  if (view === null || ctx === null) return null;

  const narrowed = hasAnyFilter(filters);
  const filterCount = activeFilterCount(filters);
  const states = allowlist ? ALLOW_STATES : BLOCK_STATES;
  const activeOptionId = listFocused && activeEntry !== null ? optionId(activeEntry.id) : undefined;

  const headerLabel = (header: HeaderItem): string => {
    if (kind === 'species') return header.group === UNTIERED ? t('list.tierUntiered') : header.group;
    if (kind === 'moves') return localizeType(header.group, dataLocale);
    return header.group in WIKI_ITEM_CATEGORY_KEYS ? tWiki.dynamic(`itemCategory.${WIKI_ITEM_CATEGORY_KEYS[header.group as keyof typeof WIKI_ITEM_CATEGORY_KEYS]}`) : header.group;
  };

  const renderHeader = (header: HeaderItem) => (
    <div aria-hidden="true" className="flex h-full items-end gap-2 px-1 pb-1 text-xs font-semibold text-poke-text-secondary">
      <span>{headerLabel(header)}</span>
      <span className="tabular-nums text-poke-text-muted">{header.count}</span>
      <span className="mb-1.5 h-px flex-1 bg-poke-border" />
    </div>
  );

  const renderCell = (entryIndex: number) => {
    const entry = entries[entryIndex];
    if (entry === undefined) return null;
    return (
      <EntryOption
        entry={entry}
        state={lookup.stateOf(entry.id)}
        density={listDensity}
        room={room}
        selected={isSelected(selection, entry.id)}
        active={entryIndex === active}
        listFocused={listFocused}
        id={optionId(entry.id)}
        position={entryIndex + 1}
        setSize={entries.length}
        index={entryIndex}
        name={displayName(entry, dataLocale)}
        tag={tagOf(entry)}
        description={descriptions?.[entry.id]}
        allowlist={allowlist}
        onPick={onPick}
      />
    );
  };

  const activeBaseName =
    activeEntry !== null && activeEntry.kind === 'species' && activeEntry.baseId !== null
      ? displayNameOf('species', index?.byId.get(activeEntry.baseId)?.name ?? activeEntry.baseId, dataLocale)
      : null;

  const confirm = pending;
  return (
    <div className="space-y-3">
      <PickerToolbar
        category={category}
        kind={kind}
        searchRef={searchRef}
        query={filters.query}
        onQuery={(query) => updateFilters({ ...filters, query })}
        sort={sort}
        onSort={(next) => prefs.setSort(kind, next)}
        queryDecidesOrder={queryDecidesOrder(filters)}
        density={density}
        onDensity={prefs.setDensity}
        filtersOpen={filtersOpen}
        onFiltersOpen={setFiltersOpen}
        filterCount={filterCount}
        includeFormes={prefs.includeFormes}
        onIncludeFormes={prefs.setIncludeFormes}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={history.onUndo}
        onRedo={history.onRedo}
        onSearchEscape={() => scrollRef.current?.focus()}
      />

      {filtersOpen && <FacetPanel kind={kind} filters={filters} onChange={updateFilters} states={states} tiers={tiers} gens={gens} itemCategories={itemCategories} />}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-poke-text-secondary">
        <p role="status">{t('filters.results', { count: entries.length, total: view.total })}</p>
        {narrowed && (
          <button
            type="button"
            onClick={() => updateFilters(EMPTY_FILTERS)}
            className="min-h-9 rounded-poke-md px-2 font-semibold text-poke-blue hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-poke-focus"
          >
            {t('filters.clear')}
          </button>
        )}
      </div>

      <div ref={wrapRef}>
        {entries.length === 0 ? (
          <div className="rounded-poke-md border border-dashed border-poke-border bg-poke-surface p-6 text-center text-sm text-poke-text-secondary">
            <p>{view.total === 0 ? t('empty.noEntries') : t('empty.none')}</p>
            {narrowed && (
              <Button type="button" variant="secondary" size="sm" className="mt-3 min-h-11 sm:min-h-0" onClick={() => updateFilters(EMPTY_FILTERS)}>
                {t('empty.clear')}
              </Button>
            )}
          </div>
        ) : density === 'table' ? (
          <EntryTable
            category={category}
            entries={entries}
            stateOf={lookup.stateOf}
            descriptions={descriptions}
            tagOf={tagOf}
            selection={selection}
            page={page}
            onPage={setPage}
            allowlist={allowlist}
            onToggleSelected={(id) => setNav((current) => ({ ...current, selection: toggleSelected(current.selection, id) }))}
            onSelectPage={(ids, selected) =>
              setNav((current) => {
                const next = new Set(current.selection.ids);
                for (const id of ids) {
                  if (selected) next.add(id);
                  else next.delete(id);
                }
                return { ...current, selection: { ids: next, anchor: current.selection.anchor } };
              })
            }
            onAct={(id) => requestAct('toggle', [id])}
          />
        ) : (
          <EntryList
            scrollRef={scrollRef}
            rows={rows}
            positions={positions}
            columns={columns}
            kind={kind}
            density={listDensity}
            activeIndex={active}
            listId={listId}
            label={t(`list.label.${category}`, { count: entries.length })}
            activeOptionId={activeOptionId}
            onKeyDown={onKeyDown}
            onFocus={() => {
              setListFocused(true);
              setNav((current) => (current.active < 0 ? { ...current, active: 0 } : current));
            }}
            onBlur={() => setListFocused(false)}
            renderCell={renderCell}
            renderHeader={renderHeader}
          />
        )}
      </div>

      <BulkBar
        selectedCount={selection.ids.size}
        hiddenCount={hiddenCount(selection, visible)}
        filteredCount={entries.length}
        narrowed={narrowed}
        allowlist={allowlist}
        onAct={filteredAct}
        onClear={() => setNav((current) => ({ ...current, selection: EMPTY_SELECTION }))}
        onSelectAll={() => setNav((current) => ({ ...current, selection: selectAll(order) }))}
      />

      <DetailBar
        entry={activeEntry}
        state={activeEntry === null ? null : lookup.stateOf(activeEntry.id)}
        name={activeEntry === null ? '' : displayName(activeEntry, dataLocale)}
        tier={activeEntry === null ? '' : tagOf(activeEntry)}
        description={activeEntry === null ? undefined : descriptions?.[activeEntry.id]}
        descriptionFallback={activeEntry !== null && text?.fallback.has(activeEntry.id) === true}
        allowlist={allowlist}
        baseName={activeBaseName}
        onAct={(action) => {
          if (activeEntry === null) return;
          // The bar acts on the one entry, with the family when "include all formes" is on.
          requestAct(action, [activeEntry.id]);
        }}
      />

      <details className="rounded-poke-md border border-poke-border bg-poke-surface text-sm text-poke-text-secondary">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 font-semibold text-poke-text-primary sm:min-h-9">
          <Keyboard className="h-4 w-4" aria-hidden="true" />
          {t('kb.title')}
        </summary>
        <ul className="space-y-1 px-3 pb-3">
          <li>{t('kb.move')}</li>
          <li>{t('kb.select')}</li>
          <li>{t('kb.act')}</li>
          <li>{t('kb.misc')}</li>
        </ul>
      </details>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (confirm !== null) onAct(confirm.action, confirm.ids);
          setPending(null);
        }}
        title={t('bulk.confirmTitle', { count: confirm?.ids.length ?? 0 })}
        message={t('bulk.confirmBody')}
        confirmLabel={t('bulk.confirm')}
        confirmVariant="primary"
      />
    </div>
  );
}
