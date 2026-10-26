'use client';

/**
 * The filter sheet (draft-frontend §5.5 `FilterPanel`, SPEC:240-312; owner feedback 2026-10-18: the anchored
 * panel was cluttered and clipped). A portalled Radix dialog: from 768 px a side sheet on the left (max-w-md),
 * so the wall on the right stays in view and updates live behind it; on phones it fills the screen.
 *
 * - Sticky header (title, close) and footer ("Show N lines", the live `matchingAllTabs` count, in the draft
 *   accent; "Clear all filters" as a text link while anything is set); only the middle scrolls.
 * - Five collapsible groups (`FilterGroup`), each with its active count and a per-group reset:
 *   Pokémon (type + maximum price), Moves and abilities, Base stats (header summary), Utility (nested
 *   categories), Defensive matchups (formerly "Advanced"). Until the viewer toggles a group, Pokémon and
 *   every group with an active filter are open (`openFilterGroups`).
 * - Group open state, utility expanders, the defensive relation and the picker queries live in the finder
 *   view state (`filterSheet`), so closing and reopening the sheet keeps them.
 * - Filters apply live (no "apply" step), so closing never loses a selection. Radix provides the focus
 *   trap, Escape, `aria-modal` and focus return; focus goes back to the Filters button (`triggerId`) even
 *   when the browser did not focus it on click.
 * - Portalled content falls outside the screen root, so it carries `styles.tokens` for the draft tokens.
 *
 * Rendered only once the search index is loaded (`ix`); while it loads the Filters button is disabled.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { Dispatch, ReactNode } from 'react';
import { useT } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import { activeFilterCount, filterGroupCounts, openFilterGroups, resetGroupFilters } from '@/lib/draft-finder/filter-groups';
import {
  FILTER_GROUP_KEYS,
  STAT_KEYS,
  type FilterGroupKey,
  type FinderAction,
  type FinderFilters,
  type FinderViewState,
  type StatKey,
} from '@/lib/draft-finder/filter-types';
import type { NameResolver } from '@/lib/draft-finder/names-port';
import type { PreparedIndex } from '@/lib/draft-finder/prepare';
import { cn } from '@/lib/utils/cn';
import styles from '../draft-tool.module.css';
import AbilityFilter from './filters/AbilityFilter';
import DefenseFilter from './filters/DefenseFilter';
import FilterGroup from './filters/FilterGroup';
import MoveFilter from './filters/MoveFilter';
import PriceFilter from './filters/PriceFilter';
import StatFilter from './filters/StatFilter';
import TypeFilter from './filters/TypeFilter';
import { type FilterSectionProps } from './filters/types';
import { FOCUS_RING } from '@/components/draft-tool/shared/focus';
import UtilityFilter from './filters/UtilityFilter';

export interface FilterPanelProps {
  view: FinderViewState;
  dispatch: Dispatch<FinderAction>;
  ix: PreparedIndex;
  names: NameResolver;
  /** The data locale (Pokémon names). */
  dl: Locale;
  /** The season's banned move ids (`catalog.bannedMoves`). */
  banned: ReadonlySet<string>;
  /** Lines matching across all tabs (`finder.matchingAllTabs`): the footer's "Show N lines". */
  count: number;
  /** Must match `FinderBar`'s `filterPanelId`. */
  id?: string;
  /** The Filters button's id (`filterTriggerId(id)`); focus returns there on close. */
  triggerId?: string;
}

/** The id of the Filters button that opens the sheet with id `panelId`. */
export function filterTriggerId(panelId: string): string {
  return `${panelId}-trigger`;
}

const STAT_FIELDS: readonly (StatKey | 'bst')[] = [...STAT_KEYS, 'bst'];

export default function FilterPanel(props: FilterPanelProps) {
  const { view, dispatch, id = 'draft-filter-panel', triggerId = filterTriggerId(id) } = props;
  const t = useT(draftFinderMessages);
  const close = () => dispatch({ type: 'setFilterPanel', open: false });

  return (
    <Dialog.Root open={view.filterPanelOpen} onOpenChange={(next) => (next ? undefined : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-poke-inverse/20" />
        <Dialog.Content
          id={id}
          onCloseAutoFocus={(event) => {
            const trigger = document.getElementById(triggerId);
            if (!trigger) return;
            event.preventDefault();
            trigger.focus();
          }}
          // `.tokens`, not `.root`: the root's `position: relative` would beat Tailwind's `fixed`.
          className={cn(
            styles.tokens,
            styles.filterSheet,
            'fixed inset-0 z-50 flex flex-col bg-[var(--draft-surface,var(--poke-surface))] text-[var(--draft-ink,var(--poke-text-primary))] outline-none',
            'md:inset-y-0 md:left-0 md:right-auto md:w-full md:max-w-md md:border-r md:border-[var(--draft-border,var(--poke-border))] md:shadow-poke-lg',
          )}
        >
          <FilterSheetBody {...props} onClose={close} closeLabel={t('filters.close')} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface FilterSheetBodyProps extends FilterPanelProps {
  onClose(): void;
  closeLabel: string;
}

/** "Spe ≥ 80 · BST ≥ 500" for the Base stats header; null without thresholds. */
function statSummary(f: FinderFilters, label: (stat: StatKey | 'bst') => string, line: (stat: string, n: number) => string): string | null {
  const parts = STAT_FIELDS.flatMap((stat) => {
    const n = f.stats[stat];
    return n === undefined ? [] : [line(label(stat), n)];
  });
  return parts.length === 0 ? null : parts.join(' · ');
}

/** Header, groups and footer of the sheet (inside `Dialog.Content`; exported for the render tests). */
export function FilterSheetBody({ view, dispatch, ix, names, dl, banned, count, onClose, closeLabel }: FilterSheetBodyProps) {
  const t = useT(draftFinderMessages);
  const f = view.filters;
  const counts = filterGroupCounts(f);
  const open = new Set(openFilterGroups(view.filterSheet, f));
  const anyActive = activeFilterCount(f) > 0;
  const section: FilterSectionProps = { view, dispatch, ix, names, dl };
  const summary = statSummary(
    f,
    (stat) => (stat === 'bst' ? t('sort.bst') : names.stat(stat, dl, 'short')),
    (stat, n) => t('chips.stat', { stat, n }),
  );

  const group = (key: FilterGroupKey, body: ReactNode, extra?: { summary?: string | null }) => (
    <FilterGroup
      key={key}
      title={t(`filters.groups.${key}`)}
      count={counts[key]}
      summary={extra?.summary}
      open={open.has(key)}
      onToggle={() => dispatch({ type: 'toggleFilterGroup', group: key })}
      resettable={resetGroupFilters(f, key) !== f}
      onReset={() => dispatch({ type: 'resetFilterGroup', group: key })}
    >
      {body}
    </FilterGroup>
  );
  const bodies: Record<FilterGroupKey, ReactNode> = {
    pokemon: (
      <>
        {/* Phone: the type toggles (TypeBadge buttons) get a 44 px touch target. */}
        <div className="[&_button[aria-pressed]]:min-h-[44px] [&_button[aria-pressed]]:min-w-[44px] md:[&_button[aria-pressed]]:min-h-0 md:[&_button[aria-pressed]]:min-w-0">
          <TypeFilter {...section} />
        </div>
        <PriceFilter {...section} />
      </>
    ),
    movesAbilities: (
      <>
        <MoveFilter {...section} />
        <AbilityFilter {...section} />
      </>
    ),
    stats: <StatFilter {...section} />,
    utility: <UtilityFilter {...section} banned={banned} />,
    defense: (
      <div className="[&_button[aria-pressed]]:min-h-[44px] [&_button[aria-pressed]]:min-w-[44px] md:[&_button[aria-pressed]]:min-h-0 md:[&_button[aria-pressed]]:min-w-0">
        <DefenseFilter {...section} />
      </div>
    ),
  };

  return (
    <>
      <div className="flex flex-none items-center justify-between gap-2 border-b border-[var(--draft-border,var(--poke-border))] px-4 py-2">
        <Dialog.Title className="text-base font-bold">{t('filters.panelLabel')}</Dialog.Title>
        <Dialog.Close
          aria-label={closeLabel}
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--draft-ink-2,var(--poke-text-secondary))] hover:bg-[var(--draft-elevated,var(--poke-elevated))] hover:text-[var(--draft-ink,var(--poke-text-primary))]',
            FOCUS_RING,
          )}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </Dialog.Close>
      </div>
      <Dialog.Description className="sr-only">{t('filters.description')}</Dialog.Description>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
        {FILTER_GROUP_KEYS.map((key) => group(key, bodies[key], key === 'stats' ? { summary } : undefined))}
      </div>

      <div className="flex flex-none flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-[var(--draft-border,var(--poke-border))] px-4 py-3">
        {anyActive ? (
          <button
            type="button"
            onClick={() => dispatch({ type: 'clearAll' })}
            className={cn(
              'min-h-[44px] rounded px-1 text-sm text-[var(--draft-accent,var(--poke-accent))] underline-offset-2 hover:underline',
              FOCUS_RING,
            )}
          >
            {t('chips.clearAll')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className={cn(
            'ml-auto min-h-[44px] rounded-poke-md bg-[var(--draft-accent,var(--poke-accent))] px-4 text-sm font-semibold text-[var(--poke-surface)] hover:brightness-110',
            FOCUS_RING,
          )}
        >
          {t('filters.showLines', { count })}
        </button>
      </div>
    </>
  );
}
