'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import MatchStatusBadge from '@/components/match/MatchStatusBadge';
import { useFormatter, useT } from '@/i18n/client';
import { LocalTime, RelativeTime } from '@/i18n/LocalTime';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { adminMatchMessages } from '@/i18n/messages/admin-match';
import { commonMessages } from '@/i18n/messages/common';
import { isOverdue, type AdminMatchContext } from '@/lib/admin/match-detail';
import { buildMatchListSearch, EMPTY_MATCH_LIST_STATE } from '@/lib/admin/match-list';
import type { MatchStatus } from '@/types/match';

interface MatchContextHeaderProps {
  matchId: string;
  tournamentId: string;
  status: MatchStatus;
  scheduledAt: string | null;
  autoConfirmAt: string | null;
  player1Name: string;
  player2Name: string;
  context: AdminMatchContext;
  /** Epoch ms of the render, for the overdue check. */
  now: number;
  /**
   * The Matches list as the viewer left it (already validated, see `matchListBackHref`). Without it the link opens the
   * list filtered to the match's league.
   */
  listHref?: string;
}

/**
 * True when the round has no name of its own: it is empty or just repeats the number ("Round 2" for round 2), so
 * the header shows the number alone instead of "Round 2 · Round 2".
 */
export function isDefaultRoundName(roundNumber: number, roundName: string | null | undefined): boolean {
  const name = (roundName ?? '').trim();
  return name === '' || name.toLowerCase().replace(/\s+/g, ' ') === `round ${roundNumber}`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-heading text-poke-text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-poke-text-primary">{children}</dd>
    </div>
  );
}

/** Where the match sits (league, phase, round), its timing and who reported it, plus the links around it. */
export default function MatchContextHeader({
  matchId,
  tournamentId,
  status,
  scheduledAt,
  autoConfirmAt,
  player1Name,
  player2Name,
  context,
  now,
  listHref,
}: MatchContextHeaderProps) {
  const t = useT(adminMatchMessages);
  const tCore = useT(adminCoreMessages);
  const tCommon = useT(commonMessages);
  const formatter = useFormatter();
  const overdue = isOverdue(context.round_deadline, now, status);
  const matchesSearch = context.league_id
    ? buildMatchListSearch({ ...EMPTY_MATCH_LIST_STATE, league: context.league_id })
    : '';

  return (
    <Card variant="muted" padding="md">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        <Row label={t('header.league')}>{context.league_name ?? t('header.standalone')}</Row>
        <Row label={t('header.phase')}>{context.phase_name}</Row>
        <Row label={t('header.round')}>
          {isDefaultRoundName(context.round_number, context.round_name)
            ? t('header.roundNumberOnly', { number: context.round_number })
            : t('header.roundValue', { number: context.round_number, name: context.round_name })}
        </Row>
        <Row label={t('header.bestOf')}>{tCommon('bestOf', { count: context.best_of })}</Row>
        <Row label={t('header.players')}>
          {tCore('versus', { player1: player1Name, player2: player2Name })}
        </Row>
        <Row label={t('header.status')}>
          <MatchStatusBadge status={status} />
        </Row>
        <Row label={t('header.scheduled')}>
          {scheduledAt ? <LocalTime value={scheduledAt} preset="dateTimeYear" /> : t('header.notScheduled')}
        </Row>
        <Row label={t('header.deadline')}>
          {context.round_deadline ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <LocalTime value={context.round_deadline} preset="dateTimeYear" />
              {overdue && <Badge variant="red">{t('header.overdue')}</Badge>}
            </span>
          ) : (
            t('header.noDeadline')
          )}
        </Row>
        <Row label={t('header.submitter')}>{context.submitter_name ?? t('header.noSubmitter')}</Row>
        {status === 'pending_confirmation' && (
          <Row label={t('header.autoConfirm')}>
            {autoConfirmAt ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <LocalTime value={autoConfirmAt} preset="dateTimeYear" />
                <span className="text-poke-text-muted">
                  (<RelativeTime value={autoConfirmAt} />)
                </span>
              </span>
            ) : (
              t('header.noAutoConfirm')
            )}
          </Row>
        )}
      </dl>
      <p className="mt-3 text-xs text-poke-text-muted">{t('header.timeZoneHint', { zone: formatter.timeZone })}</p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm font-heading">
        <Link href={`/tournaments/${tournamentId}/matches/${matchId}`} className="text-poke-blue hover:underline">
          {t('header.publicPage')}
        </Link>
        <Link
          href={listHref ?? (matchesSearch ? `/admin/matches?${matchesSearch}` : '/admin/matches')}
          className="text-poke-blue hover:underline"
        >
          {t('header.matchesList')}
        </Link>
      </div>
    </Card>
  );
}
