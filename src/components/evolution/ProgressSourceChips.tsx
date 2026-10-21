/**
 * Evolution progress by source (draft-frontend §6.3, §8.3): the self-earned
 * KOs, then one chip per other non-zero source (transferred, Draft Kill
 * Token, Comeback, Cosmo). Fixes the "merged KOs" surfaces: only
 * `real_kills` is ever labelled KOs.
 *
 * Presentational and hook-free, so server components, client components and
 * canvas callers can all use it: labels come in as props, built with
 * `progressChipLabels(t)` from `@/lib/draft-ui/progress-labels`.
 */
import { cn } from '@/lib/utils/cn';
import type { ProgressSources } from '@/lib/draft-ui/progress-display';
import type { ProgressChipLabels } from '@/lib/draft-ui/progress-labels';

export interface ProgressSourceChipsProps {
  sources: ProgressSources;
  compact?: boolean;
  labels: ProgressChipLabels;
  className?: string;
}

type ChipSource = Exclude<keyof ProgressSources, 'selfEarnedKills'>;

const CHIPS: readonly { source: ChipSource; label: (l: ProgressChipLabels, n: number) => string }[] = [
  { source: 'transferred', label: (l, n) => l.transferred(n) },
  { source: 'draftKillToken', label: (l, n) => l.draftKill(n) },
  { source: 'comebackToken', label: (l, n) => l.comeback(n) },
  { source: 'cosmoToken', label: (l, n) => l.cosmo(n) },
];

export default function ProgressSourceChips({ sources, compact = false, labels, className }: ProgressSourceChipsProps) {
  const chips = CHIPS.filter(({ source }) => sources[source] !== 0);
  return (
    <span
      role="group"
      aria-label={labels.group}
      className={cn('inline-flex flex-wrap items-center', compact ? 'gap-1 text-xs' : 'gap-1.5 text-sm', className)}
    >
      <span className="font-semibold tabular-nums text-poke-text-primary">{labels.kos(sources.selfEarnedKills)}</span>
      {chips.map(({ source, label }) => (
        <span
          key={source}
          data-source={source}
          className={cn(
            'inline-flex items-center whitespace-nowrap rounded-full border border-poke-border bg-poke-elevated tabular-nums text-poke-text-secondary',
            compact ? 'px-1.5 py-px' : 'px-2 py-0.5',
          )}
        >
          {label(labels, sources[source])}
        </span>
      ))}
    </span>
  );
}
