'use client';

/** "Any" / "Require all" switch of the type and move filters (draft-frontend §4.4, §10.3 `match.*`). */
import { useT } from '@/i18n/client';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import { cn } from '@/lib/utils/cn';
import { FOCUS_RING } from './types';

export interface MatchToggleProps {
  value: 'any' | 'all';
  onChange(value: 'any' | 'all'): void;
  /** What the switch applies to (the section heading), for screen readers. */
  label: string;
}

const VALUES: readonly ('any' | 'all')[] = ['any', 'all'];

export default function MatchToggle({ value, onChange, label }: MatchToggleProps) {
  const t = useT(draftFinderMessages);
  return (
    <div
      role="radiogroup"
      aria-label={`${label} – ${t('match.label')}`}
      className="inline-flex overflow-hidden rounded-poke-md border border-[var(--draft-border,var(--poke-border))] text-xs"
      onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        e.currentTarget.querySelector<HTMLButtonElement>('[aria-checked="false"]')?.focus();
        onChange(value === 'any' ? 'all' : 'any');
      }}
    >
      {VALUES.map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          tabIndex={value === v ? 0 : -1}
          onClick={() => onChange(v)}
          className={cn(
            'min-h-[44px] px-2.5 py-1 font-semibold md:min-h-0',
            value === v
              ? 'bg-[var(--draft-accent,var(--poke-accent))] text-[var(--poke-surface)]'
              : 'bg-[var(--draft-surface,var(--poke-surface))] text-[var(--draft-ink-2,var(--poke-text-secondary))]',
            FOCUS_RING,
          )}
        >
          {v === 'any' ? t('match.any') : t('match.all')}
        </button>
      ))}
    </div>
  );
}
