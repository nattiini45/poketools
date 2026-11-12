import type { ReactNode } from 'react';
import SkewChip from '@/components/ui/SkewChip';

interface LeagueWorkspaceHeaderProps {
  name: string;
  /** Format and ruleset as text (and the archived marker). */
  subtitle: string;
  /** The test-league chip's label; absent for a real league. */
  testLabel?: string;
  /** The status segmented control (with its blocked reason). */
  status: ReactNode;
  /** The primary action; shown here from `md` up, in the page's sticky bar below. */
  action?: ReactNode;
}

/**
 * The league workspace header (redesign A5): the league's name in the display face behind the amber slash, format and
 * ruleset as text, the status control and the one primary action. Everything wraps: nothing here widens the
 * page at phone width, and German labels only make the right-hand group taller.
 */
export default function LeagueWorkspaceHeader({ name, subtitle, testLabel, status, action }: LeagueWorkspaceHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4" data-admin-league-header>
      <div className="min-w-0 flex-1 basis-72">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-0.5 h-8 w-2 shrink-0 rounded-[2px] bg-accent-fill [transform:skewX(var(--skew))]" />
          <h1 className="min-w-0 break-words font-heading text-display text-fg">{name}</h1>
          {testLabel && (
            <SkewChip tone="tier-1" className="mt-2 shrink-0">
              {testLabel}
            </SkewChip>
          )}
        </div>
        <p className="mt-1.5 pl-5 text-body text-fg-muted">{subtitle}</p>
      </div>
      <div className="flex min-w-0 max-w-full flex-wrap items-start gap-x-4 gap-y-3 md:justify-end">
        {status}
        {action && <div className="hidden md:block">{action}</div>}
      </div>
    </header>
  );
}
