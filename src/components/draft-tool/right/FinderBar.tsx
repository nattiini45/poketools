'use client';

/**
 * The finder bar above the wall (draft-frontend §5.5 `FinderBar`, §5.3, SPEC:211-232): bilingual search
 * (debounced 120 ms into `setText`), the stage mode ("On the same Pokémon" / "Anywhere in the line", FR-6),
 * the Filters button ("Filters (n)" with the number of active filters; it opens the filter sheet), the sort
 * select with its Base/Final stage switch and "Show drafted" (FR-7).
 *
 * The stage switch picks whose stats the stat sorts and BST read (`sortStage`). It is always rendered so the
 * bar does not jump, and disabled while the sort is not a stat sort. The select and the switch share one
 * wrapper, so they wrap onto the next row together.
 *
 * The count of matching lines is not here: `ActiveFilterChips` (always rendered under this bar) shows it once.
 */
import { useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent } from 'react';
import SegmentedControl from '@/components/draft-tool/shared/SegmentedControl';
import { useT } from '@/i18n/client';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { activeFilterCount } from '@/lib/draft-finder/filter-groups';
import {
  hasActiveFilters,
  SORT_STAGES,
  STAGE_MODES,
  type FinderAction,
  type FinderFilters,
  type FinderViewState,
  type SortKey,
  type StatKey,
} from '@/lib/draft-finder/filter-types';
import type { NameResolver } from '@/lib/draft-finder/names-port';
import { isStatSort } from '@/lib/draft-finder/sort';
import { cn } from '@/lib/utils/cn';
import { statLabel, useFinderLabelContext } from './finder-labels';
import { FOCUS_RING } from './filters/types';

export const SEARCH_DEBOUNCE_MS = 120;

export interface FinderBarProps {
  view: FinderViewState;
  dispatch: Dispatch<FinderAction>;
  /** The search index is loaded; until then the Filters button is a skeleton. */
  indexReady: boolean;
  /** The id of the filter sheet the Filters button opens. */
  filterPanelId?: string;
  /** The Filters button's own id (`filterTriggerId(filterPanelId)`): the sheet returns focus there. */
  filterTriggerId?: string;
  names?: NameResolver;
  className?: string;
}

/**
 * True when a reducer change to the filters must drop the typed-but-uncommitted search text: an outside
 * text change (our own commit included), or the filters being cleared to empty ("Clear all"). The second
 * case matters when the search was empty: Clear all then leaves `text` at '' and only the cleared chips
 * show the clear. Removing the very last chip within the debounce window counts as a clear too.
 */
export function dropsPendingText(prev: FinderFilters, next: FinderFilters): boolean {
  if (prev === next) return false;
  return prev.text !== next.text || !hasActiveFilters(next);
}

/** The debounced search-text commit of the finder bar (pure; the component owns one). */
export interface TextCommitter {
  /** Commit `value` after the debounce, replacing any pending commit. */
  schedule(value: string): void;
  /** Commit `value` now (Enter), dropping any pending commit. */
  flush(value: string): void;
  /** Drop the pending commit, if any. */
  cancel(): void;
  /** The reducer's filters changed; drops the pending commit when `dropsPendingText` says so. */
  filtersChanged(prev: FinderFilters, next: FinderFilters): void;
}

export function createTextCommitter(commit: (value: string) => void, delayMs: number = SEARCH_DEBOUNCE_MS): TextCommitter {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    schedule(value) {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        commit(value);
      }, delayMs);
    },
    flush(value) {
      cancel();
      commit(value);
    },
    cancel,
    filtersChanged(prev, next) {
      if (dropsPendingText(prev, next)) cancel();
    },
  };
}

const BASE_SORTS = ['default', 'alpha', 'favorites'] as const satisfies readonly SortKey[];
/** The stat sorts of `SortKey` (read at the chosen sort stage, §4.7 rule 4); HP is not a sort. */
const STAT_SORTS = ['spe', 'atk', 'def', 'spa', 'spd', 'bst'] as const satisfies readonly (Extract<SortKey, StatKey> | 'bst')[];

export default function FinderBar({
  view,
  dispatch,
  indexReady,
  filterPanelId = 'draft-filter-panel',
  filterTriggerId = `${filterPanelId}-trigger`,
  names,
  className,
}: FinderBarProps) {
  const t = useT(draftFinderMessages);
  const tg = useT(glossaryMessages);
  const ctx = useFinderLabelContext(names);

  // The input is local so typing stays instant; the reducer gets the text after the debounce. An outside
  // change (Clear all) resets the input.
  const [text, setText] = useState(view.filters.text);
  const [syncedFilters, setSyncedFilters] = useState(view.filters);
  if (view.filters !== syncedFilters) {
    setSyncedFilters(view.filters);
    if (dropsPendingText(syncedFilters, view.filters)) setText(view.filters.text);
  }
  // `dispatch` (useReducer) is stable, so this is created once.
  const committer = useMemo(() => createTextCommitter((value) => dispatch({ type: 'setText', text: value })), [dispatch]);
  useEffect(() => () => committer.cancel(), [committer]);
  // An outside change (Clear all within the debounce window) cancels the pending commit, so the stale
  // typed text cannot come back 120 ms later.
  const prevFilters = useRef(view.filters);
  useEffect(() => {
    committer.filtersChanged(prevFilters.current, view.filters);
    prevFilters.current = view.filters;
  }, [committer, view.filters]);
  const onTextChange = (value: string) => {
    setText(value);
    committer.schedule(value);
  };
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') committer.flush(text);
  };

  const activeCount = activeFilterCount(view.filters);
  const filtersLabel = tg('state.filters');
  const sortOptions: { key: SortKey; label: string }[] = [
    ...BASE_SORTS.map((key) => ({ key, label: t(`sort.${key}`) })),
    ...STAT_SORTS.map((key) => ({ key, label: statLabel(key, ctx, 'long') })),
  ];

  return (
    <div className={cn('flex flex-wrap items-center gap-2 px-3 py-2', className)}>
      {/* A real width from 768 px (16rem basis, grows into the free space): with `flex: 1` and a 0 basis the
          shrink-0 controls beside it squeezed the field to a few letters. The other controls wrap instead. */}
      <input
        type="search"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={onSearchKeyDown}
        aria-label={t('search.label')}
        placeholder={t('search.placeholder')}
        autoComplete="off"
        spellCheck={false}
        className={cn(
          'min-h-[44px] min-w-0 basis-full rounded-poke-md border border-[var(--draft-border,var(--poke-border))] bg-[var(--draft-surface,var(--poke-surface))] px-3 py-2 text-sm text-[var(--draft-ink,var(--poke-text-primary))] placeholder:text-poke-text-muted md:min-h-0 md:flex-[1_1_16rem]',
          FOCUS_RING,
        )}
      />

      <SegmentedControl
        value={view.stageMode}
        onChange={(mode) => dispatch({ type: 'setStageMode', mode })}
        ariaLabel={t('mode.label')}
        options={STAGE_MODES.map((mode) => ({ value: mode, label: mode === 'same_stage' ? t('mode.same') : t('mode.anywhere') }))}
      />

      <button
        id={filterTriggerId}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={view.filterPanelOpen}
        // Only while the sheet is rendered: a closed Radix dialog has no element with this id.
        aria-controls={view.filterPanelOpen ? filterPanelId : undefined}
        disabled={!indexReady}
        onClick={() => dispatch({ type: 'setFilterPanel', open: !view.filterPanelOpen })}
        title={indexReady ? undefined : t('loadingIndex')}
        className={cn(
          'min-h-[44px] shrink-0 rounded-poke-md border px-3 text-sm font-semibold md:min-h-0 md:py-1.5',
          view.filterPanelOpen || activeCount > 0
            ? 'border-[var(--draft-accent,var(--poke-accent))] text-[var(--draft-ink,var(--poke-text-primary))]'
            : 'border-[var(--draft-border,var(--poke-border))] text-[var(--draft-ink,var(--poke-text-primary))]',
          !indexReady && 'cursor-wait opacity-60 motion-safe:animate-pulse',
          FOCUS_RING,
        )}
      >
        {activeCount > 0 ? t('filters.button', { label: filtersLabel, count: activeCount }) : filtersLabel}
        {!indexReady && <span className="sr-only">{t('filters.loading')}</span>}
      </button>

      <div className="inline-flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5 text-sm text-[var(--draft-ink-2,var(--poke-text-secondary))]">
          <span>{t('sort.label')}</span>
          <select
            value={view.sort}
            onChange={(e) => dispatch({ type: 'setSort', sort: e.target.value as SortKey })}
            className={cn(
              'min-h-[44px] rounded-poke-md border border-[var(--draft-border,var(--poke-border))] bg-[var(--draft-surface,var(--poke-surface))] px-2 text-sm text-[var(--draft-ink,var(--poke-text-primary))] md:min-h-0 md:py-1',
              FOCUS_RING,
            )}
          >
            {sortOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <span className="inline-flex items-center gap-1.5 text-sm text-[var(--draft-ink-2,var(--poke-text-secondary))]">
          <span aria-hidden="true">{t('sort.stage.label')}</span>
          <SegmentedControl
            value={view.sortStage}
            onChange={(stage) => dispatch({ type: 'setSortStage', stage })}
            ariaLabel={t('sort.stage.label')}
            disabled={!isStatSort(view.sort)}
            options={SORT_STAGES.map((stage) => ({ value: stage, label: t(`sort.stage.${stage}`) }))}
          />
        </span>
      </div>

      <label className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-1.5 text-sm text-[var(--draft-ink,var(--poke-text-primary))] md:min-h-0">
        <input
          type="checkbox"
          checked={view.showDrafted}
          onChange={(e) => dispatch({ type: 'setShowDrafted', on: e.target.checked })}
          className="h-4 w-4 accent-[var(--draft-accent,var(--poke-accent))]"
        />
        <span>{tg('state.showDrafted')}</span>
      </label>
    </div>
  );
}
