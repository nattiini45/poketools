'use client';

/**
 * Active filter chips (draft-frontend §5.5 `ActiveFilterChips`, SPEC:316-322): Showdown style
 * `Ground × │ Rapid Spin × │ Recovery × │ ≤15 P ×`, then "Clear all filters" and the match count across
 * all tabs (FR-8). Renders nothing without chips. Labels are built at render time from the chip's ids and
 * English names (`finder-labels.ts`), so a language switch re-renders them.
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
  if (chips.length === 0) return null;

  return (
    <div
      role="group"
      aria-label={t('chips.label')}
      className={cn('flex items-center gap-2 overflow-x-auto px-3 py-1.5 text-sm', className)}
    >
      <ul className="flex shrink-0 items-center">
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
                className="inline-flex max-w-[14rem] items-center gap-1 rounded px-1 text-[var(--draft-ink,var(--poke-text-primary))] outline-none hover:bg-[var(--draft-elevated,var(--poke-elevated))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--poke-focus)]"
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
      <button
        type="button"
        onClick={onClearAll}
        className="shrink-0 whitespace-nowrap rounded px-1.5 text-[var(--draft-accent,var(--poke-accent))] underline-offset-2 outline-none hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--poke-focus)]"
      >
        {t('chips.clearAll')}
      </button>
      <span className="shrink-0 whitespace-nowrap text-[var(--draft-ink-2,var(--poke-text-secondary))]">
        {t('chips.count', { count })}
      </span>
    </div>
  );
}
