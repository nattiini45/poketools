import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export type SkewChipTone = 'neutral' | 'accent' | 'live' | 'win' | 'loss' | 'tier-1' | 'tier-2' | 'tier-3' | 'tier-4';

const TONE: Record<SkewChipTone, string> = {
  neutral: 'bg-elevated text-fg-muted',
  accent: 'bg-accent-subtle text-accent-ink',
  live: 'bg-win-bg text-live',
  win: 'bg-win-bg text-win',
  loss: 'bg-loss-bg text-loss',
  'tier-1': 'bg-tier-1 text-tier-ink',
  'tier-2': 'bg-tier-2 text-tier-ink',
  'tier-3': 'bg-tier-3 text-tier-ink',
  'tier-4': 'bg-tier-4 text-tier-ink',
};

interface SkewChipProps {
  tone?: SkewChipTone;
  children: ReactNode;
  className?: string;
}

/** A small skewed plate for status chips and score or stat plates (docs/design.md, "Skewed plates"). */
export default function SkewChip({ tone = 'neutral', children, className }: SkewChipProps) {
  const [fill, ink] = TONE[tone].split(' ');
  return (
    <span className={cn('skew-plate px-2 py-0.5 text-caption font-[550] tabular-nums', ink, className)}>
      <span aria-hidden="true" className={cn('skew-plate-bg', fill)} />
      <span>{children}</span>
    </span>
  );
}
