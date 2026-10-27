'use client';

/** Type filter: the 18 types as toggles plus "Any" / "Require all" (draft-frontend §4.4, FR-5). */
import TypeBadge from '@/components/shared/TypeBadge';
import { useT } from '@/i18n/client';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import type { TypeId } from '@/lib/draft-finder/index-types';
import { TYPES } from '@/lib/pkmn/type-chart';
import { cn } from '@/lib/utils/cn';
import MatchToggle from './MatchToggle';
import { SECTION_HEADING, type FilterSectionProps } from './types';
import { FOCUS_RING } from '@/components/draft-tool/shared/focus';

export const ALL_TYPES: readonly TypeId[] = TYPES;

export default function TypeFilter({ view, dispatch }: FilterSectionProps) {
  const t = useT(draftFinderMessages);
  const heading = t('filters.type');
  const selected = view.filters.types.ids;
  return (
    <section aria-label={heading}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className={cn(SECTION_HEADING, 'mb-0')}>{heading}</h4>
        <MatchToggle
          label={heading}
          value={view.filters.types.match}
          onChange={(match) => dispatch({ type: 'setTypeMatch', match })}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ALL_TYPES.map((type) => {
          const pressed = selected.includes(type);
          return (
            <button
              key={type}
              type="button"
              aria-pressed={pressed}
              onClick={() => dispatch({ type: 'toggleType', id: type })}
              className={cn(
                'rounded-full',
                pressed
                  ? 'ring-2 ring-[var(--draft-accent,var(--poke-accent))] ring-offset-1'
                  : 'opacity-60 hover:opacity-100',
                FOCUS_RING,
              )}
            >
              <TypeBadge type={type} />
            </button>
          );
        })}
      </div>
    </section>
  );
}
