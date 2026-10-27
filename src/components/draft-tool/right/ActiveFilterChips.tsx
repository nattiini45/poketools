'use client';

/**
 * Active filter chips (draft-frontend §5.5 `ActiveFilterChips`, SPEC:316-322): compact Showdown-style pills
 * (`Ground ⊗`, `Stealth Rock ⊗`, `≤15 P ⊗`) that wrap onto as many lines as they need, then "Clear all
 * filters" and the match count across all tabs (FR-8) in the same wrapping flow, the count right-aligned.
 * This row is where the count sits next to the filters; while the filter sheet is open its footer repeats
 * the same count as the action label ("Show 48 lines"). Always rendered, with a "No filters" placeholder
 * when nothing is set, so the wall below never jumps when the first chip appears or the last one goes.
 *
 * A pill shows the short label (a utility member is just its move or ability name); `title` and the remove
 * button's accessible name carry the full label with the category. Labels are built at render time from the
 * chip's ids and English names (`finder-labels.ts`), so a language switch re-renders them.
 *
 * Nothing scrolls sideways: a long filter list takes more lines instead, so no chip or "Clear all" hides out
 * of view. On phones the touch target is 44 px tall while the pill stays compact: the button is the target,
 * the pill inside it is the drawing.
 */
import { X } from 'lucide-react';
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
      className={cn('flex min-h-[2.75rem] flex-wrap items-center gap-x-1.5 px-3 py-0.5 text-sm md:min-h-[2.25rem]', className)}
    >
      {empty ? (
        <span className="text-[var(--draft-ink-2,var(--poke-text-secondary))]">{t('chips.none')}</span>
      ) : (
        <>
          {chips.map((chip) => {
            const full = chipLabel(chip.labelParts, ctx, 'full');
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => onRemove(chip.id)}
                aria-label={t('chips.remove', { label: full })}
                title={full}
                className="group inline-flex min-h-[44px] max-w-full items-center outline-none md:min-h-0 md:py-0.5"
              >
                <span className="inline-flex max-w-[14rem] items-center gap-1 rounded-full border border-[var(--draft-border,var(--poke-border))] bg-[var(--draft-elevated,var(--poke-elevated))] py-0.5 pl-2 pr-1.5 text-xs text-[var(--draft-ink,var(--poke-text-primary))] group-hover:border-[var(--draft-ink-2,var(--poke-text-secondary))] group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-[var(--poke-focus)]">
                  <span className="truncate">{chipLabel(chip.labelParts, ctx, 'short')}</span>
                  <X className="h-3 w-3 shrink-0 text-[var(--draft-ink-2,var(--poke-text-secondary))]" aria-hidden="true" />
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={onClearAll}
            className="min-h-[44px] whitespace-nowrap rounded px-1.5 text-xs text-[var(--draft-accent,var(--poke-accent))] underline-offset-2 outline-none hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--poke-focus)] md:min-h-0"
          >
            {t('chips.clearAll')}
          </button>
        </>
      )}
      <span className="ml-auto whitespace-nowrap pl-2 text-xs text-[var(--draft-ink-2,var(--poke-text-secondary))]">
        {t('chips.count', { count })}
      </span>
    </div>
  );
}
