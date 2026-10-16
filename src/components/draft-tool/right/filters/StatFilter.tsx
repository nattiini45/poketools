'use client';

/** Base-stat thresholds (`>=`) for the six stats and BST (draft-frontend §4.4; each is its own criterion). */
import { useT } from '@/i18n/client';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import { STAT_KEYS, type StatKey } from '@/lib/draft-finder/filter-types';
import { cn } from '@/lib/utils/cn';
import { FOCUS_RING, SECTION_HEADING, type FilterSectionProps } from './types';

const FIELDS: readonly (StatKey | 'bst')[] = [...STAT_KEYS, 'bst'];
/** Input bounds: a single base stat is at most 255; a BST stays under 1000. */
const MAX: Record<'stat' | 'bst', number> = { stat: 255, bst: 999 };

/** '' → null (no threshold); otherwise a whole number clamped to [1, max]. Pure. */
export function parseStatInput(raw: string, max: number): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Math.round(Number(trimmed));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, max);
}

export default function StatFilter({ view, dispatch, names, dl }: FilterSectionProps) {
  const t = useT(draftFinderMessages);
  const heading = t('filters.stats');
  return (
    <section aria-label={heading}>
      <h3 className={SECTION_HEADING}>{heading}</h3>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {FIELDS.map((stat) => {
          const short = stat === 'bst' ? t('sort.bst') : names.stat(stat, dl, 'short');
          const long = stat === 'bst' ? t('sort.bst') : names.stat(stat, dl, 'long');
          const max = stat === 'bst' ? MAX.bst : MAX.stat;
          const value = view.filters.stats[stat];
          return (
            <label key={stat} className="flex flex-col gap-1 text-xs text-[var(--draft-ink-2,var(--poke-text-secondary))]">
              <span aria-hidden="true">{short} ≥</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={max}
                step={5}
                value={value ?? ''}
                placeholder={t('stats.placeholder')}
                aria-label={t('stats.minLabel', { stat: long })}
                onChange={(e) => dispatch({ type: 'setStat', stat, value: parseStatInput(e.target.value, max) })}
                className={cn(
                  'w-full rounded-poke-md border border-[var(--draft-border,var(--poke-border))] bg-[var(--draft-surface,var(--poke-surface))] px-2 py-1 text-sm tabular-nums text-[var(--draft-ink,var(--poke-text-primary))]',
                  FOCUS_RING,
                )}
              />
            </label>
          );
        })}
      </div>
    </section>
  );
}
