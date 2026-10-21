'use client';

/**
 * Active filter chips (draft-frontend §5.5 `ActiveFilterChips`, SPEC:316-322): Showdown style
 * `Ground × │ Rapid Spin × │ Recovery × │ ≤15 P ×`, then "Clear all filters" and the match count across
 * all tabs (FR-8). This row is where the count sits next to the filters; while the filter sheet is open its
 * footer repeats the same count as the action label ("Show 48 lines"). Always rendered, with a "No filters"
 * placeholder when nothing is set, so the wall below never jumps when the first chip appears or the last one
 * goes. Labels are built at render time from the chip's ids and English names (`finder-labels.ts`), so a
 * language switch re-renders them.
 *
 * Only the chip list scrolls sideways; "Clear all filters" and the count stay outside the scroller, so they
 * never scroll out of view with many chips. On phones every chip button and "Clear all" is 44 px tall.
 */
import { useT } from '@/i18n/client';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import type { FilterChip } from '@/lib/draft-finder/chips';
import type { NameResolver } from '@/lib/draft-finder/names-port';
import { cn } from '@/lib/utils/cn';
import { chipLabel, useFinderLabelContext } from './finder-labels';

export interface ActiveFilterChipsProps {
  chips: FilterChip[];
  /** Lines matching across all tabs. */
  count: number;
  onRemove(chipId: string): void;
  onClearAll(): void;
  names?: NameResolver;
  className?: string;
}

export default function ActiveFilterChips({ chips, count, onRemove, onClearAll, names, className }: ActiveFilterChipsProps) {
  const t = useT(draftFinderMessages);
  const ctx = useFinderLabelContext(names);
  const empty = chips.length === 0;

  return (
    <div
      role="group"
      aria-label={t('chips.label')}
      className={cn('flex min-h-[2.75rem] items-center gap-2 px-3 py-1 text-sm md:min-h-[2.25rem] md:py-1.5', className)}
    >
      {empty ? (
        <span className="shrink-0 text-[var(--draft-ink-2,var(--poke-text-secondary))]">{t('chips.none')}</span>
      ) : (
        <>
          <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain">
            <ul className="flex w-max items-center">
              {chips.map((chip) => {
                const label = chipLabel(chip.labelParts, ctx);
                return (
                  <li
                    key={chip.id}
                    className="border-r border-[var(--draft-border,var(--poke-border))] px-1.5 first:pl-0 last:border-r-0"
                  >
                    <button
                      type="button"
                      onClick={() => onRemove(chip.id)}
                      aria-label={t('chips.remove', { label })}
                      title={label}
                      className="inline-flex min-h-[44px] max-w-[14rem] items-center gap-1 rounded px-1 text-[var(--draft-ink,var(--poke-text-primary))] outline-none hover:bg-[var(--draft-elevated,var(--poke-elevated))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--poke-focus)] md:min-h-0"
                    >
                      <span className="truncate">{label}</span>
                      <span aria-hidden="true" className="text-[var(--draft-ink-2,var(--poke-text-secondary))]">
                        ×
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <button
            type="button"
            onClick={onClearAll}
            className="min-h-[44px] shrink-0 whitespace-nowrap rounded px-1.5 text-[var(--draft-accent,var(--poke-accent))] underline-offset-2 outline-none hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--poke-focus)] md:min-h-0"
          >
            {t('chips.clearAll')}
          </button>
        </>
      )}
      <span className="ml-auto shrink-0 whitespace-nowrap text-[var(--draft-ink-2,var(--poke-text-secondary))]">
        {t('chips.count', { count })}
      </span>
    </div>
  );
}
