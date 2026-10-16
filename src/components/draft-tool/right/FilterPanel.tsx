'use client';

/**
 * The filter panel (draft-frontend §5.5 `FilterPanel`, SPEC:240-312): Type, Moves, Abilities, Base stats,
 * Maximum price, Utility and Advanced. Desktop: a panel anchored over the top of the wall (max 70vh,
 * scrolls; the parent is `position: relative`). Phone: a full-screen modal sheet (`aria-modal`, Tab stays
 * inside). Escape or the close button closes it and focus returns to the Filters button; filters apply
 * live (no "apply" step), so closing never loses a selection.
 *
 * Rendered only once the search index is loaded (`ix`); while it loads the Filters button is disabled.
 */
import { useEffect, useRef, useSyncExternalStore, type Dispatch, type KeyboardEvent } from 'react';
import { useT } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import type { FinderAction, FinderViewState } from '@/lib/draft-finder/filter-types';
import type { NameResolver } from '@/lib/draft-finder/names-port';
import type { PreparedIndex } from '@/lib/draft-finder/prepare';
import { cn } from '@/lib/utils/cn';
import AbilityFilter from './filters/AbilityFilter';
import DefenseFilter from './filters/DefenseFilter';
import MoveFilter from './filters/MoveFilter';
import PriceFilter from './filters/PriceFilter';
import StatFilter from './filters/StatFilter';
import TypeFilter from './filters/TypeFilter';
import { FOCUS_RING } from './filters/types';
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
  /** Must match `FinderBar`'s `filterPanelId`. */
  id?: string;
  className?: string;
}

/** Matches Tailwind's `md` breakpoint: below it the panel is a full-screen modal sheet. */
const PHONE_QUERY = '(max-width: 767.98px)';

function subscribePhone(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia(PHONE_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab / Shift+Tab inside `container` (wraps at both ends). */
function trapTab(event: KeyboardEvent<HTMLDivElement>, container: HTMLElement): void {
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export default function FilterPanel({
  view,
  dispatch,
  ix,
  names,
  dl,
  banned,
  id = 'draft-filter-panel',
  className,
}: FilterPanelProps) {
  const t = useT(draftFinderMessages);
  const panelRef = useRef<HTMLDivElement>(null);
  const open = view.filterPanelOpen;
  const phone = useIsPhone();

  useEffect(() => {
    if (!open) return;
    // The element that opened the panel (the Filters button); focus goes back to it on close.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => {
      // Only when focus was lost with the panel (close button, Escape): a click elsewhere keeps its focus.
      const active = document.activeElement;
      if (opener?.isConnected && (active === null || active === document.body)) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  const close = () => dispatch({ type: 'setFilterPanel', open: false });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    // Phone: the full-screen sheet is modal, so Tab cycles inside it.
    if (event.key === 'Tab' && phone && panelRef.current) trapTab(event, panelRef.current);
  };
  const section = { view, dispatch, ix, names, dl };

  return (
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-modal={phone || undefined}
      aria-label={t('filters.panelLabel')}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn(
        'fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[var(--draft-surface,var(--poke-surface))] p-4 outline-none',
        'md:absolute md:inset-x-3 md:bottom-auto md:top-2 md:max-h-[70vh] md:rounded-poke-lg md:border md:border-[var(--draft-border,var(--poke-border))] md:shadow-poke-lg',
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-[var(--draft-ink,var(--poke-text-primary))]">{t('filters.panelLabel')}</h2>
        <button
          type="button"
          onClick={close}
          aria-label={t('filters.close')}
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-full text-lg text-[var(--draft-ink-2,var(--poke-text-secondary))] hover:bg-[var(--draft-elevated,var(--poke-elevated))] md:h-8 md:w-8',
            FOCUS_RING,
          )}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="flex flex-col gap-5">
        {/* Phone: the type toggles (TypeBadge buttons) get a 44 px touch target. */}
        <div className="[&_button[aria-pressed]]:min-h-[44px] [&_button[aria-pressed]]:min-w-[44px] md:[&_button[aria-pressed]]:min-h-0 md:[&_button[aria-pressed]]:min-w-0">
          <TypeFilter {...section} />
        </div>
        <MoveFilter {...section} />
        <AbilityFilter {...section} />
        <StatFilter {...section} />
        <PriceFilter {...section} />
        <UtilityFilter {...section} banned={banned} />
        <DefenseFilter {...section} />
      </div>
    </div>
  );
}
