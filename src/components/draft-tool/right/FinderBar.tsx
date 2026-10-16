'use client';

/**
 * The finder bar above the wall (draft-frontend §5.5 `FinderBar`, §5.3, SPEC:211-232): bilingual search
 * (debounced 120 ms into `setText`), the stage mode ("On the same Pokémon" / "Anywhere in the line", FR-6),
 * the Filters button, the sort select and "Show drafted" (FR-7).
 *
 * The count of matching lines shows here only while no filter chip is active; with chips,
 * `ActiveFilterChips` carries it.
 */
import { useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent } from 'react';
import { useT } from '@/i18n/client';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import { glossaryMessages } from '@/i18n/messages/glossary';
import {
  hasActiveFilters,
  type FinderAction,
  type FinderFilters,
  type FinderViewState,
  type SortKey,
  type StageMode,
  type StatKey,
} from '@/lib/draft-finder/filter-types';
import type { NameResolver } from '@/lib/draft-finder/names-port';
import { cn } from '@/lib/utils/cn';
import { statLabel, useFinderLabelContext } from './finder-labels';

export const SEARCH_DEBOUNCE_MS = 120;

export interface FinderBarProps {
  view: FinderViewState;
  dispatch: Dispatch<FinderAction>;
  /** Lines matching across all tabs (FR-8). */
  count: number;
  /** The search index is loaded; until then the Filters button is a skeleton. */
  indexReady: boolean;
  /** The id of the filter panel the Filters button opens. */
  filterPanelId?: string;
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

const STAGE_MODES: readonly StageMode[] = ['same_stage', 'anywhere'];
const BASE_SORTS: readonly SortKey[] = ['default', 'alpha', 'favorites'];
/** The stat sorts of `SortKey` (final stage, §4.7 rule 4); HP is not a sort. */
const STAT_SORTS: readonly Extract<SortKey, StatKey>[] = ['spe', 'atk', 'def', 'spa', 'spd'];

const FOCUS_RING =
  'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--poke-focus)]';

export default function FinderBar({
  view,
  dispatch,
  count,
  indexReady,
  filterPanelId = 'draft-filter-panel',
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

  const modeRefs = useRef(new Map<StageMode, HTMLButtonElement>());
  const onModeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const next = view.stageMode === 'same_stage' ? 'anywhere' : 'same_stage';
    dispatch({ type: 'setStageMode', mode: next });
    modeRefs.current.get(next)?.focus();
  };

  const chipFiltersActive = hasActiveFilters({ ...view.filters, text: '' });
  const sortOptions: { key: SortKey; label: string }[] = [
    ...BASE_SORTS.map((key) => ({ key, label: t(`sort.${key as 'default' | 'alpha' | 'favorites'}`) })),
    ...STAT_SORTS.map((key) => ({ key, label: t('sort.stat', { stat: statLabel(key, ctx, 'long') }) })),
    { key: 'bst', label: t('sort.stat', { stat: t('sort.bst') }) },
  ];

  return (
    <div className={cn('flex flex-wrap items-center gap-2 px-3 py-2', className)}>
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
          'min-w-0 basis-full rounded-poke-md border border-[var(--draft-border,var(--poke-border))] bg-[var(--draft-surface,var(--poke-surface))] px-3 py-2 text-sm text-[var(--draft-ink,var(--poke-text-primary))] placeholder:text-poke-text-muted md:basis-auto md:flex-1',
          FOCUS_RING,
        )}
      />

      <div
        role="radiogroup"
        aria-label={t('mode.label')}
        onKeyDown={onModeKeyDown}
        className="inline-flex shrink-0 overflow-hidden rounded-poke-md border border-[var(--draft-border,var(--poke-border))]"
      >
        {STAGE_MODES.map((mode) => {
          const checked = view.stageMode === mode;
          return (
            <button
              key={mode}
              ref={(el) => {
                if (el) modeRefs.current.set(mode, el);
                else modeRefs.current.delete(mode);
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => dispatch({ type: 'setStageMode', mode })}
              className={cn(
                'min-h-[44px] px-3 text-xs font-semibold md:min-h-0 md:py-1.5',
                checked
                  ? 'bg-[var(--draft-accent,var(--poke-accent))] text-[var(--poke-surface)]'
                  : 'bg-[var(--draft-surface,var(--poke-surface))] text-[var(--draft-ink-2,var(--poke-text-secondary))]',
                FOCUS_RING,
              )}
            >
              {mode === 'same_stage' ? t('mode.same') : t('mode.anywhere')}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        aria-expanded={view.filterPanelOpen}
        aria-controls={filterPanelId}
        disabled={!indexReady}
        onClick={() => dispatch({ type: 'setFilterPanel', open: !view.filterPanelOpen })}
        title={indexReady ? undefined : t('loadingIndex')}
        className={cn(
          'min-h-[44px] shrink-0 rounded-poke-md border px-3 text-sm font-semibold md:min-h-0 md:py-1.5',
          view.filterPanelOpen || chipFiltersActive
            ? 'border-[var(--draft-accent,var(--poke-accent))] text-[var(--draft-ink,var(--poke-text-primary))]'
            : 'border-[var(--draft-border,var(--poke-border))] text-[var(--draft-ink,var(--poke-text-primary))]',
          !indexReady && 'animate-pulse cursor-wait opacity-60',
          FOCUS_RING,
        )}
      >
        {tg('state.filters')} <span aria-hidden="true">▾</span>
        {!indexReady && <span className="sr-only">{t('filters.loading')}</span>}
      </button>

      <label className="inline-flex shrink-0 items-center gap-1.5 text-sm text-[var(--draft-ink-2,var(--poke-text-secondary))]">
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

      <label className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-1.5 text-sm text-[var(--draft-ink,var(--poke-text-primary))] md:min-h-0">
        <input
          type="checkbox"
          checked={view.showDrafted}
          onChange={(e) => dispatch({ type: 'setShowDrafted', on: e.target.checked })}
          className="h-4 w-4 accent-[var(--draft-accent,var(--poke-accent))]"
        />
        <span>{tg('state.showDrafted')}</span>
      </label>

      {!chipFiltersActive && (
        <span className="ml-auto shrink-0 text-sm text-[var(--draft-ink-2,var(--poke-text-secondary))]">
          {t('chips.count', { count })}
        </span>
      )}
    </div>
  );
}
