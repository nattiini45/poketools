'use client';

import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import type { AdminMatchRow } from '@/lib/supabase/queries/matches';
import { matchRowActions, type AdminMatchViewer } from '@/lib/admin/match-row-actions';
import { autoConfirmCountdown, matchScore, replayCount } from '@/components/admin/match-list-view';
import MatchStatusBadge from '@/components/match/MatchStatusBadge';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import { getButtonClasses } from '@/components/ui/Button';
import { useLocale, useT } from '@/i18n/client';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { LocalTime, useMinuteClock } from '@/i18n/LocalTime';
import { shellMessages } from '@/i18n/messages/shell';

/**
 * One row of the admin match list. The title link carries a stretched hit area
 * (`after:inset-0` on the `relative` card), so the whole row opens the admin match page; the
 * secondary links sit above it (`relative z-10`) as siblings, never inside the primary anchor.
 * `backQuery` is the list's canonical query string: the match page returns to it. With `selection` the row
 * starts with a checkbox (a sibling of the title link, above its stretched hit area) and a selected row is outlined.
 * Submit Result and View Prep open player-dashboard pages that admit only some viewers, so they show only where
 * `matchRowActions` says the viewer can use them (none without a `viewer`).
 */
export function MatchListRow({
  row,
  backQuery,
  selection,
  viewer = null,
}: {
  row: AdminMatchRow;
  backQuery: string;
  viewer?: AdminMatchViewer | null;
  selection?: { checked: boolean; onChange: (checked: boolean) => void };
}) {
  const t = useT(shellMessages);
  const locale = useLocale();
  const now = useMinuteClock();

  const actions = matchRowActions(row, viewer);
  const href = `/admin/matches/${row.id}${backQuery ? `?back=${encodeURIComponent(backQuery)}` : ''}`;
  const publicHref = `/tournaments/${row.tournament_id}/matches/${row.id}`;

  const score = matchScore(row);
  const replays = replayCount(row.games);
  const countdown = autoConfirmCountdown(row, now);
  const roundLabel = row.round_name
    ? translateEngineLabel('round', row.round_name, locale)
    : row.round_number > 0
      ? t('admin.matches.roundNumber', { number: row.round_number })
      : null;

  // Line two: only the parts that exist, with a separator between neighbours (never a dangling dot).
  const details: { key: string; node: ReactNode }[] = [];
  details.push({
    key: 'phase',
    node: row.season_name
      ? t('admin.matches.leaguePhase', { league: row.season_name, phase: row.tournament_name })
      : row.tournament_name,
  });
  if (roundLabel) details.push({ key: 'round', node: roundLabel });
  if (row.best_of > 0) details.push({ key: 'bestOf', node: t('admin.matches.row.bestOf', { count: row.best_of }) });
  if (row.scheduled_at) {
    details.push({ key: 'scheduled', node: <LocalTime value={row.scheduled_at} preset="weekdayDateTime" /> });
  }
  if (replays > 0) details.push({ key: 'replays', node: t('admin.matches.row.replays', { count: replays }) });
  if (countdown) {
    details.push({
      key: 'autoConfirm',
      node:
        countdown.kind === 'hours'
          ? t('admin.matches.row.autoConfirmsIn', { hours: countdown.hours })
          : countdown.kind === 'underHour'
            ? t('admin.matches.row.autoConfirmsSoon')
            : t('admin.matches.row.autoConfirmDue'),
    });
  }

  return (
    <Card
      variant="outlined"
      padding="sm"
      className={`group relative transition-colors hover:border-poke-border-focus focus-within:border-poke-border-focus${
        selection?.checked ? ' border-poke-border-focus ring-1 ring-poke-border-focus' : ''
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0 max-w-full">
          {selection && (
            <label className="relative z-10 -my-1 -ml-1.5 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center">
              <input
                type="checkbox"
                checked={selection.checked}
                onChange={(event) => selection.onChange(event.target.checked)}
                aria-label={t('admin.matches.bulk.selectRow', { player1: row.player_1_name, player2: row.player_2_name })}
                className="relative z-10 h-4 w-4 cursor-pointer rounded-poke-sm border-poke-border accent-poke-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-poke-border-focus"
              />
            </label>
          )}
          <Link
            href={href}
            className="font-heading font-medium text-sm text-poke-text-primary max-w-full truncate group-hover:text-poke-accent transition-colors focus-visible:outline-none after:absolute after:inset-0 after:rounded-poke-lg focus-visible:after:ring-2 focus-visible:after:ring-poke-border-focus"
          >
            {t('admin.matches.versus', { player1: row.player_1_name, player2: row.player_2_name })}
          </Link>
          {score && (
            <span className="text-xs font-heading font-semibold text-poke-text-secondary shrink-0">
              {t('admin.matches.row.score', { p1: score.p1, p2: score.p2 })}
            </span>
          )}
          {row.winner_name && (
            <span className="text-xs text-poke-green">{t('admin.matches.winner', { name: row.winner_name })}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {row.season_is_test && (
            <Badge variant="purple" size="xs">
              {t('admin.matches.row.testBadge')}
            </Badge>
          )}
          {row.archived && (
            <Badge variant="gray" size="xs">
              {t('admin.matches.row.archivedBadge')}
            </Badge>
          )}
          <MatchStatusBadge status={row.status} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <p className="text-[11px] text-poke-text-muted min-w-0">
          {details.map((part, index) => (
            <Fragment key={part.key}>
              {index > 0 && (
                <span aria-hidden="true" className="mx-1">
                  ·
                </span>
              )}
              {part.node}
            </Fragment>
          ))}
        </p>
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          {actions.submitResult && (
            <Link href={`/dashboard/submit/${row.id}`} className={`${getButtonClasses('secondary', 'sm')} relative z-10`}>
              {t('admin.matches.submitResult')}
            </Link>
          )}
          {actions.viewPrep && (
            <Link href={`/dashboard/match-prep/${row.id}`} className={`${getButtonClasses('ghost', 'sm')} relative z-10`}>
              {t('admin.matches.viewPrep')}
            </Link>
          )}
          <Link
            href={publicHref}
            title={t('admin.matches.row.publicPage')}
            aria-label={t('admin.matches.row.publicPageLabel', { player1: row.player_1_name, player2: row.player_2_name })}
            className={`${getButtonClasses('ghost', 'sm')} relative z-10`}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 6H18m0 0v4.5M18 6l-7.5 7.5M10.5 6H6.75A2.25 2.25 0 0 0 4.5 8.25v9A2.25 2.25 0 0 0 6.75 19.5h9a2.25 2.25 0 0 0 2.25-2.25V13.5"
              />
            </svg>
          </Link>
        </div>
      </div>
    </Card>
  );
}

export default MatchListRow;
