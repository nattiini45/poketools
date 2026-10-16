'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { Player } from '@/types/player';
import type { MatchWithPlayers } from '@/types/match';
import type { Team } from '@/types/team';
import type { TournamentWithDetails } from '@/types/tournament';
import type { SeasonWithDetails } from '@/types/season';
import { motion, staggerContainer, staggerItem } from '@/components/shared/motion';
import MatchStatusBadge from '@/components/match/MatchStatusBadge';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Section from '@/components/ui/Section';
import Badge from '@/components/ui/Badge';
import { TablePagination } from '@/components/ui/Table';
import { useClientTable } from '@/lib/ui/use-client-table';
import RatingBadge from '@/components/gamification/RatingBadge';
import type { PlayerRating } from '@/types/rating';
import type { PlayerStreaks } from '@/types/streak';
import { compareMatchesByScheduledAt } from '@/lib/match/compare-scheduled-at';
import { useFormatter, useRequestTime, useT } from '@/i18n/client';
import type { Formatter } from '@/i18n/format';
import { enumLabel } from '@/i18n/content/enum-label';
import { commonMessages } from '@/i18n/messages/common';
import { dashboardMessages } from '@/i18n/messages/dashboard';
import { enumMessages } from '@/i18n/messages/enums';

export interface LeagueStandingSnapshot {
  leagueId: string;
  leagueName: string;
  snapshot: { rank: number; total: number; wins: number; losses: number } | null;
}

interface Props {
  playerId: string;
  playerName: string;
  avatarUrl?: string;
  customAvatarUrl?: string;
  initialPlayer: Player | null;
  initialMatches: MatchWithPlayers[];
  initialTeams: Team[];
  initialTournaments: TournamentWithDetails[];
  initialLeagues: SeasonWithDetails[];
  playerRating: PlayerRating | null;
  playerStreaks: PlayerStreaks | null;
  leagueStandings: LeagueStandingSnapshot[];
}

export type GreetingKey = 'morning' | 'afternoon' | 'evening';

/** Greeting by the hour of day (0-23): before 12 morning, before 18 afternoon, else evening. */
export function greetingKey(hour: number): GreetingKey {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/**
 * The hour of `at` in the formatter's zone (the viewer's browser zone after
 * hydration, the cookie / default zone on the server snapshot: rule T1).
 */
export function hourInZone(formatter: Formatter, at: number): number {
  const hour = Number.parseInt(formatter.instant(at, 'time').slice(0, 2), 10);
  return Number.isFinite(hour) ? hour : 12;
}

function statusVariant(status: string): 'green' | 'yellow' | 'accent' | 'gray' {
  switch (status) {
    case 'active': return 'green';
    case 'upcoming': return 'accent';
    case 'completed': return 'gray';
    default: return 'yellow';
  }
}

/** scheduled_at ASC with unscheduled matches last — mirrors getUpcomingMatches */
const compareScheduledAt = compareMatchesByScheduledAt;

export default function DashboardContent({
  playerId, playerName, avatarUrl, customAvatarUrl,
  initialPlayer: _initialPlayer,
  initialMatches,
  initialTeams,
  initialTournaments,
  initialLeagues,
  playerRating,
  playerStreaks,
  leagueStandings,
}: Props) {
  const t = useT(dashboardMessages);
  const tc = useT(commonMessages);
  const te = useT(enumMessages);
  const formatter = useFormatter();
  // The request time, not Date.now(): server render and hydration agree (rule T4).
  const requestTime = useRequestTime();
  const greeting = greetingKey(hourInZone(formatter, requestTime));
  const matches = initialMatches;
  const teams = initialTeams;
  const tournaments = initialTournaments;
  const leagues = initialLeagues;

  // Actionable: pending confirmation first, then scheduled|in_progress by scheduled_at
  const pendingConfirmation = matches.filter((m) => m.status === 'pending_confirmation');
  const upcomingPlayable = matches
    .filter((m) => m.status === 'scheduled' || m.status === 'in_progress')
    .sort(compareScheduledAt);
  const actionMatches = [...pendingConfirmation, ...upcomingPlayable];

  const recentMatches = matches.filter(
    m => m.status === 'completed' || m.status === 'disputed'
  );

  const completedMatches = matches.filter(m => m.status === 'completed');
  const wins = completedMatches.filter(m => m.winner_id === playerId).length;
  const losses = completedMatches.filter(
    m => m.winner_id !== null && m.winner_id !== playerId
  ).length;
  const winRate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;

  const standaloneTournaments = useMemo(
    () => tournaments.filter((t) => t.season_id === null),
    [tournaments],
  );
  const allTournaments = useMemo(
    () => [
      ...leagues.map((l) => ({ kind: 'league' as const, item: l })),
      ...standaloneTournaments.map((t) => ({ kind: 'tournament' as const, item: t })),
    ],
    [leagues, standaloneTournaments],
  );

  const tournamentsTable = useClientTable(allTournaments, []);
  const matchesTable = useClientTable(recentMatches, []);

  return (
    <motion.div
      className="space-y-6"
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      {/* ─── Greeting Banner ─── */}
      <motion.div variants={staggerItem}>
        <div className="relative overflow-hidden rounded-poke-xl bg-gradient-to-br from-poke-elevated via-poke-surface to-poke-muted border border-poke-border shadow-poke-md p-6 sm:p-8">
          <div className="flex items-center gap-4">
            <Link href="/dashboard/avatar" className="group relative" aria-label={t('editAvatar')}>
              <PlayerAvatar
                avatarUrl={customAvatarUrl}
                discordAvatarUrl={avatarUrl}
                name={playerName}
                size={56}
                className="shadow-poke-sm group-hover:ring-poke-accent transition-all"
              />
              <span aria-hidden="true" className="absolute -bottom-1 -right-1 w-5 h-5 bg-poke-elevated border border-poke-border rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">
                &#9998;
              </span>
            </Link>
            <div>
              <h1 className="text-2xl sm:text-3xl font-heading font-bold tracking-tight text-poke-text-primary">
                {t(`greeting.${greeting}`, { name: playerName })}
              </h1>
              <div aria-hidden="true" className="mt-2 h-0.5 w-12 rounded-full bg-poke-accent" />
              <p className="mt-2 text-sm text-poke-text-secondary">
                {t('intro')}
                {playerStreaks && playerStreaks.current_win_streak >= 3 && (
                  <span className="ml-2 font-heading font-semibold text-poke-green">
                    {t('winStreak', { n: playerStreaks.current_win_streak })}
                  </span>
                )}
              </p>
            </div>
            <Link href="/dashboard/settings" className="ml-auto shrink-0">
              <Button variant="ghost" size="sm">{t('settings')}</Button>
            </Link>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
            <div className="text-center">
              <p className="text-2xl font-heading font-bold text-poke-text-primary">{matches.length}</p>
              <p className="text-xs text-poke-text-muted font-heading uppercase tracking-wide">{t('stats.matches')}</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-heading font-bold text-poke-green">{formatter.percentOf(winRate, 0)}</p>
              <p className="text-xs text-poke-text-muted font-heading uppercase tracking-wide">{t('stats.winRate')}</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-heading font-bold text-poke-text-primary">{teams.length}</p>
              <p className="text-xs text-poke-text-muted font-heading uppercase tracking-wide">{t('stats.teams')}</p>
            </div>
            <div className="text-center flex flex-col items-center">
              {playerRating ? (
                <RatingBadge rating={playerRating.rating} rd={playerRating.rd} size="md" />
              ) : (
                <p className="text-sm text-poke-text-muted">—</p>
              )}
              <p className="text-xs text-poke-text-muted font-heading uppercase tracking-wide mt-1">
                {t('stats.rating')}
              </p>
            </div>
          </div>

          {/* Subtle decorative gradient */}
          <div className="absolute -top-20 -right-20 w-60 h-60 bg-poke-accent/5 rounded-full blur-3xl pointer-events-none" />
        </div>
      </motion.div>

      {/* ─── Now: what needs you today ─── */}
      <motion.div variants={staggerItem}>
        <div className="space-y-6">
          <Section
            title={t('now.title')}
            subtitle={actionMatches.length > 0 ? t('now.needAttention', { count: actionMatches.length }) : t('now.nothingNeeded')}
          >
              {actionMatches.length === 0 ? (
                <p className="text-sm text-poke-text-muted py-2">
                  {t('now.allCaughtUp')}
                </p>
              ) : (
                <div className="space-y-3">
                  {actionMatches.map((m) => {
                    const isP1 = m.player_1_id === playerId;
                    const opponentName = isP1 ? m.player_2_name : m.player_1_name;
                    const isUpcomingRound = m.round_status === 'pending';
                    const canAct =
                      !isUpcomingRound &&
                      (m.status === 'scheduled' || m.status === 'in_progress');
                    const canConfirm = m.status === 'pending_confirmation';
                    const scheduledLabel = m.scheduled_at ? formatter.instant(m.scheduled_at, 'dateTime') : null;
                    return (
                      <Card key={m.id} variant="outlined" padding="sm" hover>
                        <div className="flex items-center justify-between gap-3">
                          <Link
                            href={`/tournaments/${m.tournament_id}/matches/${m.id}`}
                            className="flex items-center gap-2 text-sm font-heading font-semibold text-poke-text-primary hover:text-poke-accent transition-colors truncate"
                          >
                            {t('now.versus', { name: opponentName ?? '' })}
                          </Link>
                          {isUpcomingRound && m.status === 'scheduled' ? (
                            <Badge variant="blue" size="sm">{t('now.upcoming')}</Badge>
                          ) : (
                            <MatchStatusBadge status={m.status} />
                          )}
                        </div>
                        {scheduledLabel && (
                          <p className="text-xs text-poke-text-muted mt-2">{t('now.scheduled', { date: scheduledLabel })}</p>
                        )}
                        <div className="flex flex-wrap gap-2 mt-2">
                          {/* Plan Team is always available */}
                          <Link href={`/dashboard/match-prep/${m.id}`}>
                            <Button variant="ghost" size="sm">{t('now.planTeam')}</Button>
                          </Link>
                          {canAct && (
                            <Link href={`/dashboard/submit/${m.id}`}>
                              <Button variant="secondary" size="sm">{t('now.submitResult')}</Button>
                            </Link>
                          )}
                          {canConfirm && (
                            <Link href={`/dashboard/confirm/${m.id}`}>
                              <Button variant="success" size="sm">{t('now.confirmResult')}</Button>
                            </Link>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
          </Section>

          {/* ─── My leagues & tournaments ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <Section
            title={t('leagues.title')}
            subtitle={t('leagues.standings', { count: leagueStandings.length })}
            action={
              <Link href="/leagues">
                <Button variant="ghost" size="sm">{t('leagues.allLeagues')}</Button>
              </Link>
            }
          >
            {leagueStandings.length === 0 ? (
              <p className="text-sm text-poke-text-muted py-2">{t('leagues.empty')}</p>
            ) : (
              <div className="space-y-3">
                {leagueStandings.map(({ leagueId, leagueName, snapshot }) => (
                  <Card key={leagueId} variant="outlined" padding="sm" hover>
                    <Link
                      href={`/leagues/${leagueId}`}
                      className="font-heading font-semibold text-poke-text-primary truncate block hover:text-poke-accent transition-colors"
                    >
                      {leagueName}
                    </Link>
                    {snapshot ? (
                      <p className="text-sm text-poke-text-secondary mt-1">
                        {t.rich('leagues.rank', {
                          rank: snapshot.rank,
                          total: snapshot.total,
                          wins: snapshot.wins,
                          losses: snapshot.losses,
                          strong: (chunks) => (
                            <span className="font-heading font-bold text-poke-text-primary">{chunks}</span>
                          ),
                          muted: (chunks) => <span className="text-poke-text-muted">{chunks}</span>,
                        })}
                      </p>
                    ) : (
                      <p className="text-xs text-poke-text-muted mt-1">
                        {t('leagues.statsSoon')}
                      </p>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </Section>

          <Section
            title={t('tournaments.title')}
            subtitle={t('tournaments.activeCount', { count: leagues.length + standaloneTournaments.length })}
          >
              {allTournaments.length === 0 ? (
                <p className="text-sm text-poke-text-muted py-2">
                  {t('tournaments.empty')}
                </p>
              ) : (
                <div className="space-y-3">
                  <TablePagination
                    page={tournamentsTable.page}
                    totalPages={tournamentsTable.totalPages}
                    perPage={tournamentsTable.perPage}
                    totalItems={tournamentsTable.totalItems}
                    onPageChange={tournamentsTable.setPage}
                    onPerPageChange={tournamentsTable.handlePerPageChange}
                  />
                  {tournamentsTable.pageRows.map((entry) =>
                    entry.kind === 'league' ? (
                      <Link key={entry.item.id} href={`/leagues/${entry.item.id}`}>
                        <Card variant="outlined" padding="sm" hover className="text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-heading font-semibold text-poke-text-primary truncate">
                              {entry.item.name}
                            </span>
                            <Badge variant={statusVariant(entry.item.status)} size="sm">
                              {enumLabel(te, 'seasonStatus', entry.item.status)}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-poke-text-muted">
                            <span>{enumLabel(te, 'formatType', entry.item.format_type)}</span>
                            <span>{tc('units.players', { count: entry.item.participant_count })}</span>
                          </div>
                        </Card>
                      </Link>
                    ) : (
                      <Link key={entry.item.id} href={`/tournaments/${entry.item.id}`}>
                        <Card variant="outlined" padding="sm" hover className="text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-heading font-semibold text-poke-text-primary truncate">
                              {entry.item.name}
                            </span>
                            <Badge variant={statusVariant(entry.item.status)} size="sm">
                              {enumLabel(te, 'tournamentStatus', entry.item.status)}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-poke-text-muted">
                            <span>{enumLabel(te, 'bracketType', entry.item.bracket_type)}</span>
                            <span>{tc('units.players', { count: entry.item.participant_count })}</span>
                          </div>
                        </Card>
                      </Link>
                    ),
                  )}
                </div>
              )}
          </Section>
          </div>

          {/* ─── History: collapsed by default ─── */}
          <Section
            title={t('history.title')}
            collapsible
            defaultCollapsed
            subtitle={t('history.summary', { count: teams.length, wins, losses })}
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <div>
              <h3 className="text-xs font-heading font-semibold uppercase tracking-wide text-poke-text-secondary mb-2">{t('history.recentMatches')}</h3>
              {recentMatches.length === 0 ? (
                <p className="text-sm text-poke-text-muted py-2">
                  {t('history.noCompleted')}
                </p>
              ) : (
                <div className="space-y-2">
                  <TablePagination
                    page={matchesTable.page}
                    totalPages={matchesTable.totalPages}
                    perPage={matchesTable.perPage}
                    totalItems={matchesTable.totalItems}
                    onPageChange={matchesTable.setPage}
                    onPerPageChange={matchesTable.handlePerPageChange}
                  />
                  {matchesTable.pageRows.map((m) => {
                    const isP1 = m.player_1_id === playerId;
                    const opponentName = isP1 ? m.player_2_name : m.player_1_name;
                    const won = m.winner_id === playerId;
                    const lost = m.winner_id && m.winner_id !== playerId;
                    return (
                      <Link
                        key={m.id}
                        href={`/tournaments/${m.tournament_id}/matches/${m.id}`}
                        className="flex items-center justify-between p-2 rounded-poke-md hover:bg-poke-elevated transition-colors text-sm"
                      >
                        <div className="flex items-center gap-2">
                          {won && <Badge variant="green" size="sm">{tc('record.winShort')}</Badge>}
                          {lost && <Badge variant="red" size="sm">{tc('record.lossShort')}</Badge>}
                          {!won && !lost && <Badge variant="gray" size="sm">—</Badge>}
                          <span className="font-heading font-semibold text-poke-text-primary truncate">
                            {t('now.versus', { name: opponentName ?? '' })}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-heading font-semibold uppercase tracking-wide text-poke-text-secondary">{t('history.myTeams')}</h3>
                <Link href="/teambuilder">
                  <Button variant="ghost" size="sm">{t('history.newTeam')}</Button>
                </Link>
              </div>
          {teams.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-poke-text-muted mb-3">{t('history.noTeams')}</p>
              <Link href="/teambuilder">
                <Button variant="primary" size="sm">{t('history.createTeam')}</Button>
              </Link>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {teams.map((team) => (
                <Link key={team.id} href={`/dashboard/team/${team.id}`}>
                  <Card variant="outlined" padding="sm" hover>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-heading font-semibold text-poke-text-primary">
                        {t('history.pokemonCount', { count: team.pokemon.length })}
                      </span>
                      <div className="flex items-center gap-2">
                        {team.locked && <Badge variant="yellow" size="sm">{t('history.locked')}</Badge>}
                        <span className="text-xs text-poke-text-muted">
                          {formatter.instant(team.updated_at, 'date')}
                        </span>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
            </div>
            </div>
          </Section>
        </div>
      </motion.div>
    </motion.div>
  );
}
