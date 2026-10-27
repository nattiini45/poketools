'use client';

/**
 * One collapsible group of the filter sheet (disclosure pattern): an `h3` whose button toggles the group,
 * shows the group's active-filter count and an optional one-line summary (e.g. "Spe ≥ 80 · BST ≥ 500"),
 * plus a per-group "Reset" next to it while the group has something to clear. Headers wrap instead of
 * truncating (German runs ~30% longer). The body renders only while open; its state lives in the finder
 * view state, so collapsing loses nothing.
 */
import { useId, type ReactNode } from 'react';
import { useT } from '@/i18n/client';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import { cn } from '@/lib/utils/cn';
import { FOCUS_RING } from '@/components/draft-tool/shared/focus';

export interface FilterGroupProps {
  title: string;
  /** Active filters in this group (chips). */
  count: number;
  /** Short text under the title while collapsed or open (e.g. the stat thresholds). */
  summary?: string | null;
  open: boolean;
  onToggle(): void;
  /** Shown while the group has anything to clear. */
  resettable: boolean;
  onReset(): void;
  children: ReactNode;
}

export default function FilterGroup({ title, count, summary, open, onToggle, resettable, onReset, children }: FilterGroupProps) {
  const t = useT(draftFinderMessages);
  const bodyId = useId();
  return (
    <section className="border-b border-[var(--draft-border,var(--poke-border))] last:border-b-0">
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={onToggle}
            className={cn(
              'flex min-h-[44px] w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded py-2 text-left text-[var(--draft-ink,var(--poke-text-primary))]',
              FOCUS_RING,
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'inline-block w-4 text-center text-[var(--draft-ink-2,var(--poke-text-secondary))] motion-safe:transition-transform',
                open && 'rotate-90',
              )}
            >
              ▸
            </span>
            <span className="text-sm font-semibold">{title}</span>
            {count > 0 ? (
              <>
                <span
                  aria-hidden="true"
                  className="rounded-full bg-[var(--draft-accent-fill,var(--poke-accent))] px-1.5 text-xs font-semibold tabular-nums text-[var(--poke-surface)]"
                >
                  {count}
                </span>
                <span className="sr-only">{`, ${t('filters.groupActive', { count })}`}</span>
              </>
            ) : null}
            {summary ? (
              <span className="basis-full pl-6 text-xs text-[var(--draft-ink-2,var(--poke-text-secondary))]">{summary}</span>
            ) : null}
          </button>
        </h3>
        {resettable ? (
          <button
            type="button"
            onClick={onReset}
            aria-label={t('filters.resetGroupLabel', { group: title })}
            className={cn(
              'min-h-[44px] shrink-0 rounded px-2 text-xs font-semibold text-[var(--draft-accent,var(--poke-accent))] underline-offset-2 hover:underline',
              FOCUS_RING,
            )}
          >
            {t('filters.resetGroup')}
          </button>
        ) : null}
      </div>
      {/* No display class while hidden: Tailwind's `flex` would beat the `[hidden]` rule. */}
      <div id={bodyId} hidden={!open} className={open ? 'flex flex-col gap-5 pb-4 pt-1' : undefined}>
        {open ? children : null}
      </div>
    </section>
  );
}
