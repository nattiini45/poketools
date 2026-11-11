import type { ReactNode } from 'react';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewChip from '@/components/ui/SkewChip';
import { cn } from '@/lib/utils/cn';
import type { MatchStatus } from '@/types/match';
import MatchStatusChip from './MatchStatusChip';
import VersusPortrait from './VersusPortrait';

interface VersusSide {
  name: string;
  avatarUrl?: string | null;
}

export interface MatchVersusHeaderProps {
  /** The page title, rendered as the page's h1. */
  title: string;
  status: MatchStatus;
  players: [VersusSide, VersusSide];
  /** The side the viewer plays on, when they play in this match. */
  viewerSide?: 0 | 1 | null;
  /** Games won per side. With it the centre of the arena is a scoreboard instead of the bare "VS". */
  score?: [number, number] | null;
  /** The side reported or confirmed as the winner. */
  winnerSide?: 0 | 1 | null;
  /** Short facts beside the status chip (the ruleset of the match). */
  meta?: ReactNode;
  /** Already translated: the page's server component owns the namespace. */
  labels: { versus: string; you: string; winner: string; score?: string };
}

const PLATE_EDGE = ['border-l-4 border-l-tier-1', 'border-r-4 border-r-tier-3'] as const;

/**
 * The versus header that opens the player's match pages (submit, confirm, match prep): the page title with the
 * vs-seeker icon and the status chip, then the two trainers facing each other across a diagonal slab, name plates in
 * the character-select style and a pixel "VS" (or the score of the reported games).
 */
export default function MatchVersusHeader({ title, status, players, viewerSide = null, score = null, winnerSide = null, meta, labels }: MatchVersusHeaderProps) {
  const side = (index: 0 | 1) => {
    const mirrored = index === 1;
    return (
      <div className={cn('flex min-w-0 flex-col items-center gap-2 sm:flex-row sm:gap-3', mirrored && 'sm:flex-row-reverse')}>
        <VersusPortrait name={players[index].name} avatarUrl={players[index].avatarUrl} side={index} />
        <div className={cn('flex min-w-0 max-w-full flex-col items-center gap-1.5', mirrored ? 'sm:items-end' : 'sm:items-start')}>
          <span className="skew-plate max-w-full px-3 py-1.5 text-fg">
            <span aria-hidden="true" className={cn('skew-plate-bg border border-hairline-strong bg-surface', PLATE_EDGE[index])} />
            <span className="max-w-full text-center text-body font-[550] [overflow-wrap:anywhere] sm:overflow-hidden sm:text-ellipsis sm:whitespace-nowrap sm:font-heading sm:text-title sm:font-normal">{players[index].name}</span>
          </span>
          {(viewerSide === index || winnerSide === index) && (
            <span className="flex flex-wrap justify-center gap-1.5">
              {viewerSide === index && <SkewChip tone="accent">{labels.you}</SkewChip>}
              {winnerSide === index && <SkewChip tone="win">{labels.winner}</SkewChip>}
            </span>
          )}
        </div>
      </div>
    );
  };

  const scorePlate = (index: 0 | 1) => {
    const decided = score !== null && score[0] !== score[1];
    const leads = decided && score[index] > score[1 - index];
    return (
      <span className={cn('skew-plate px-3 py-1 font-heading text-display tabular-nums sm:px-4 sm:py-1.5 sm:text-[2.5rem]/[3rem]', !decided ? 'text-fg' : leads ? 'text-win' : 'text-loss')}>
        <span aria-hidden="true" className={cn('skew-plate-bg', !decided ? 'border border-hairline-strong bg-surface' : leads ? 'bg-win-bg' : 'bg-loss-bg')} />
        <span>{score?.[index]}</span>
      </span>
    );
  };

  // The "VS" sits on the amber slash as its own plate, so the slash never runs through the letters.
  const versus = (size: string) => (
    <span className={cn('skew-plate px-2 py-0.5 font-heading text-tier-ink sm:px-3', size)}>
      <span aria-hidden="true" className="skew-plate-bg bg-accent-fill" />
      <span>{labels.versus}</span>
    </span>
  );

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <ItemIcon item="vs-seeker" />
          <h1 className="min-w-0 font-heading text-title text-fg sm:text-display">{title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-body text-fg-muted">
          {meta}
          <MatchStatusChip status={status} />
        </div>
      </div>

      <div className="relative isolate overflow-hidden rounded-poke-lg border border-hairline bg-sunken">
        {/* The far half of the arena: a slab cut on the plates' diagonal, edged by the amber slash. */}
        <div aria-hidden="true" className="absolute inset-y-0 left-1/2 -right-12 -z-10 border-l-4 border-accent-fill bg-elevated [transform:skewX(var(--skew))]" />
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 px-3 py-5 sm:gap-x-4 sm:px-6 sm:py-7">
          {side(0)}
          {score !== null ? (
            <div className="flex items-center gap-2 sm:gap-3">
              {labels.score && <span className="sr-only">{labels.score}</span>}
              <span aria-hidden={labels.score ? 'true' : undefined} className="flex items-center gap-2 sm:gap-3">
                {scorePlate(0)}
                {versus('text-title')}
                {scorePlate(1)}
              </span>
            </div>
          ) : (
            versus('text-display sm:text-[2.5rem]/[3rem]')
          )}
          {side(1)}
        </div>
      </div>
    </header>
  );
}
