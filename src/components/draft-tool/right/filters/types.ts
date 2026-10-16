/** Props every filter section shares (draft-frontend §5.5 `right/filters/*`). */
import type { Dispatch } from 'react';
import type { Locale } from '@/i18n/config';
import type { FinderAction, FinderViewState } from '@/lib/draft-finder/filter-types';
import type { NameResolver } from '@/lib/draft-finder/names-port';
import type { PreparedIndex } from '@/lib/draft-finder/prepare';

export interface FilterSectionProps {
  view: FinderViewState;
  dispatch: Dispatch<FinderAction>;
  ix: PreparedIndex;
  names: NameResolver;
  /** The data locale (Pokémon names). */
  dl: Locale;
}

export const SECTION_HEADING = 'mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--draft-ink-2,var(--poke-text-secondary))]';

export const FOCUS_RING =
  'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--poke-focus)]';

/** A toggle pill (type, move, ability options): 44 px touch target on phones, 32 px from `md` up. */
export function pillClass(pressed: boolean): string {
  return [
    'inline-flex min-h-[44px] md:min-h-[32px] items-center gap-1 rounded-full border px-2.5 text-xs font-semibold',
    pressed
      ? 'border-[var(--draft-accent,var(--poke-accent))] bg-[var(--draft-accent,var(--poke-accent))] text-[var(--poke-surface)]'
      : 'border-[var(--draft-border,var(--poke-border))] bg-[var(--draft-surface,var(--poke-surface))] text-[var(--draft-ink,var(--poke-text-primary))]',
    FOCUS_RING,
  ].join(' ');
}
