'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { Player } from '@/types/player';
import type { MatchStatus, MatchWithPlayers } from '@/types/match';
import type { TournamentWithDetails } from '@/types/tournament';
import type { SeasonFormatType, SeasonStatus } from '@/types/season';
import type { PlayerStandingSnapshot } from '@/lib/stats/standings-preview';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { TeamUsed } from './teams-used';
import {
  motion,
  staggerContainer,
  staggerContainerReduced,
  staggerItem,
  useReducedMotion,
} from '@/components/shared/motion';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Section from '@/components/ui/Section';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewChip, { type SkewChipTone } from '@/components/ui/SkewChip';
import { PlateLink } from '@/components/player/Plate';
import { cn } from '@/lib/utils/cn';
import TestLeagueBadge from '@/components/league/TestLeagueBadge';
import { TablePagination } from '@/components/ui/Table';
import { useClientTable } from '@/lib/ui/use-client-table';
import RatingBadge from '@/components/gamification/RatingBadge';
import type { PlayerRating } from '@/types/rating';
import type { PlayerStreaks } from '@/types/streak';
import { compareMatchesByScheduledAt } from '@/lib/match/compare-scheduled-at';
import { availableMatchActions } from '@/lib/match/match-actions';
import { useDataLocale, useFormatter, useRequestTime, useT } from '@/i18n/client';
import type { Formatter } from '@/i18n/format';
import { enumLabel } from '@/i18n/content/enum-label';
import { commonMessages } from '@/i18n/messages/common';
import { dashboardMessages } from '@/i18n/messages/dashboard';
import { enumMessages } from '@/i18n/messages/enums';
import { leaguesMessages } from '@/i18n/messages/leagues';

export interface LeagueStandingSnapshot {
  leagueId: string;
  leagueName: string;
  status: SeasonStatus;
  formatType: SeasonFormatType;
  participantCount: number;
  /** A test league (`seasons.is_test_season`): badged, listed after the real leagues. */
  isTestSeason: boolean;
  snapshot: PlayerStandingSnapshot | null;
}

interface Props {
  playerId: string;
  playerName: string;
  avatarUrl?: string;
  customAvatarUrl?: string;
  initialPlayer: Player | null;
  initialMatches: MatchWithPlayers[];
  initialTournaments: TournamentWithDetails[];
  playerRating: PlayerRating | null;
  playerStreaks: PlayerStreaks | null;
  leagueStandings: LeagueStandingSnapshot[];
  teamsUsed: TeamUsed[];
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

/** Status chips follow the track's tones: live for running, tier-1 for complete, neutral for pending. */
function statusTone(status: string): SkewChipTone {
  switch (status) {
    case 'active': return 'live';
    case 'completed': return 'tier-1';
    case 'upcoming': return 'neutral';
    default: return 'accent';
  }
}

const MATCH_TONE: Record<MatchStatus, SkewChipTone> = {
  scheduled: 'neutral',
  in_progress: 'live',
  pending_confirmation: 'accent',
  completed: 'tier-1',
  disputed: 'loss',
};

const SUBHEAD = 'text-caption font-[550] text-fg-muted';
const NAME_LINK = 'min-w-0 truncate text-body font-[550] text-fg transition-colors duration-80 ease-out hover:text-accent-ink';

/** scheduled_at ASC with unscheduled matches last — mirrors getUpcomingMatches */
const compareScheduledAt = compareMatchesByScheduledAt;

/** History's "Teams used": the Pokémon brought per league and standalone tournament. */
export function TeamsUsedList({ teamsUsed }: { teamsUsed: TeamUsed[] }) {
  const t = useT(dashboardMessages);
  const dataLocale = useDataLocale();
  const table = useClientTable(teamsUsed, []);

  if (teamsUsed.length === 0) {
    return <p className="py-2 text-body text-fg-muted">{t('history.noTeamsUsed')}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <TablePagination
        page={table.page}
        totalPages={table.totalPages}
        perPage={table.perPage}
        totalItems={table.totalItems}
        onPageChange={table.setPage}
        onPerPageChange={table.handlePerPageChange}
      />
      {table.pageRows.map((team) => (
        <Card key={`${team.kind}:${team.id}`} variant="outlined" padding="sm">
          <div className="flex items-center justify-between gap-2">
            <Link href={team.kind === 'league' ? `/leagues/${team.id}` : `/tournaments/${team.id}`} className={NAME_LINK}>
              {team.name}
            </Link>
            <SkewChip className="shrink-0">{team.kind === 'league' ? t('history.kindLeague') : t('history.kindTournament')}</SkewChip>
          </div>
          <p className="mt-1 text-caption text-fg-muted">
            {t('history.pokemonCount', { count: team.pokemon.length })}
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {team.pokemon.map((p) => (
              <li key={p.name} className="rounded-poke-md border border-hairline bg-elevated px-2 py-0.5 text-caption text-fg">
                {t('history.brought', { name: localizeSpecies(p.name, dataLocale), count: p.brought })}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

/** One number of the stats strip on a skewed plate, in the scoreboard face. */
function StatPlate({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="skew-plate justify-items-start px-3.5 py-2">
      <span aria-hidden="true" className="skew-plate-bg border border-hairline-strong bg-surface" />
      <div className="flex flex-col">
        {children}
        <p className="text-caption text-fg-muted">{label}</p>
      </div>
    </li>
  );
}

const STAT_VALUE = 'font-heading text-title tabular-nums';

export default function DashboardContent({
  playerId, playerName, avatarUrl, customAvatarUrl,
  initialPlayer,
  initialMatches,
  initialTournaments,
  playerRating,
  playerStreaks,
  leagueStandings,
  teamsUsed,
}: Props) {
  const t = useT(dashboardMessages);
  const tc = useT(commonMessages);
  const te = useT(enumMessages);
  const tl = useT(leaguesMessages);
  const formatter = useFormatter();
  const reduceMotion = useReducedMotion() ?? false;
  // The request time, not Date.now(): server render and hydration agree (rule T4).
  const requestTime = useRequestTime();
  const greeting = greetingKey(hourInZone(formatter, requestTime));
  const matches = initialMatches;
  // Display only: the result routes decide again with the live roles.
  const viewer = { playerId, isAdmin: initialPlayer?.is_admin ?? false };
  const tournaments = initialTournaments;

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

  // League stages are tournaments too; they belong to their league's card.
  const standaloneTournaments = useMemo(
    () => tournaments.filter((t) => !t.season_id),
    [tournaments],
  );

  /** Where a match is played: its league when the tournament is a league stage, else the tournament. */
  const competitionName = (tournamentId: string): string | null => {
    const tournament = tournaments.find((entry) => entry.id === tournamentId);
    if (!tournament) return null;
    return leagueStandings.find((league) => league.leagueId === tournament.season_id)?.leagueName ?? tournament.name;
  };

  const leaguesTable = useClientTable(leagueStandings, []);
  const tournamentsTable = useClientTable(standaloneTournaments, []);
  const matchesTable = useClientTable(recentMatches, []);

  // A player with no league, tournament or match yet: the page names the next step instead of four empty lists.
  const isNewPlayer = leagueStandings.length === 0 && tournaments.length === 0 && matches.length === 0;

  return (
    <motion.div
      className="flex flex-col gap-6"
      variants={reduceMotion ? staggerContainerReduced : staggerContainer}
      initial="initial"
      animate="animate"
    >
      {/* ─── Greeting slab; its diagonal panel heads the "Now" queue ─── */}
      <motion.div variants={staggerItem}>
        <section className="grid overflow-hidden rounded-poke-xl border border-hairline bg-surface md:grid-cols-[minmax(0,1fr)_minmax(0,21rem)]">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-4 p-5 sm:p-6 md:pr-16">
            <Link href="/dashboard/avatar" className="group relative shrink-0" aria-label={t('editAvatar')}>
              <PlayerAvatar
                avatarUrl={customAvatarUrl}
                discordAvatarUrl={avatarUrl}
                name={playerName}
                size={72}
                className="transition-shadow duration-80 ease-out group-hover:ring-accent-fill"
              />
              <span aria-hidden="true" className="absolute -right-1 -bottom-1 grid size-6 place-items-center rounded-full border border-hairline-strong bg-elevated text-caption text-fg opacity-0 transition-opacity duration-80 ease-out group-hover:opacity-100 group-focus-visible:opacity-100">
                &#9998;
              </span>
            </Link>
            <div className="min-w-0 flex-1 basis-52">
              <h1 className="font-heading text-display text-fg [overflow-wrap:anywhere]">
                {t(`greeting.${greeting}`, { name: playerName })}
              </h1>
              <p className="mt-1 text-body text-fg-muted">{t('intro')}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                {playerStreaks && playerStreaks.current_win_streak >= 3 && (
                  <SkewChip tone="live">{t('winStreak', { n: playerStreaks.current_win_streak })}</SkewChip>
                )}
                <Link href="/dashboard/settings">
                  <Button variant="ghost" size="sm">{t('settings')}</Button>
                </Link>
              </div>
            </div>
          </div>

          <div className="relative flex flex-col justify-center gap-1 border-t border-hairline bg-sunken px-5 py-4 sm:px-6 md:border-t-0 md:py-6 md:pl-2">
            {/* The panel's diagonal edge with the amber slash, as on the versus slab; a flat strip on phones. */}
            <span aria-hidden="true" className="absolute inset-y-0 -left-10 hidden w-20 bg-sunken md:block [transform:skewX(var(--skew))]" />
            <span aria-hidden="true" className="absolute inset-y-0 -left-10 hidden w-1 bg-accent-fill md:block [transform:skewX(var(--skew))]" />
            <div className="relative flex items-center gap-2.5">
              <ItemIcon item="vs-seeker" />
              <h2 className="font-heading text-title text-fg">{t('now.title')}</h2>
              {actionMatches.length > 0 && (
                <SkewChip tone="accent" className="ml-auto font-heading text-title">{formatter.number(actionMatches.length)}</SkewChip>
              )}
            </div>
            <p className="relative text-body text-fg-muted">
              {isNewPlayer
                ? t('empty.lead')
                : actionMatches.length > 0
                  ? t('now.needAttention', { count: actionMatches.length })
                  : t('now.nothingNeeded')}
            </p>
          </div>
        </section>
      </motion.div>

      {/* ─── Now: what needs you today ─── */}
      <motion.div variants={staggerItem}>
        {isNewPlayer ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-4 rounded-poke-lg border border-hairline bg-surface p-5 sm:p-6">
            <ItemIcon item="poke-doll" size={48} />
            <p className="min-w-0 flex-1 basis-56 text-body text-fg">{t('empty.body')}</p>
            <PlateLink href="/leagues">{t('empty.cta')}</PlateLink>
          </div>
        ) : actionMatches.length === 0 ? (
          <p className="rounded-poke-lg border border-hairline bg-surface px-5 py-4 text-body text-fg-muted">
            {t('now.allCaughtUp')}
          </p>
        ) : (
          <ul className={cn('grid gap-3', actionMatches.length > 1 && 'md:grid-cols-2')}>
            {actionMatches.map((m) => {
              const isP1 = m.player_1_id === playerId;
              const opponentName = isP1 ? m.player_2_name : m.player_1_name;
              const isUpcomingRound = m.round_status === 'pending';
              const actions = availableMatchActions(m, viewer);
              const canAct = !isUpcomingRound && actions.has('record_game');
              const canConfirm = actions.has('confirm');
              const needsViewer = canAct || canConfirm;
              const scheduledLabel = m.scheduled_at ? formatter.instant(m.scheduled_at, 'dateTime') : null;
              const competition = competitionName(m.tournament_id);
              return (
                <li
                  key={m.id}
                  className={cn('flex flex-col overflow-hidden rounded-poke-lg border bg-surface', needsViewer ? 'border-accent-fill' : 'border-hairline')}
                >
                  <div className={cn('flex items-center justify-between gap-3 px-4 py-2.5', needsViewer ? 'bg-accent-subtle' : 'bg-elevated')}>
                    <Link
                      href={`/tournaments/${m.tournament_id}/matches/${m.id}`}
                      className="min-w-0 truncate font-heading text-title text-fg underline-offset-4 hover:underline"
                    >
                      {t('now.versus', { name: opponentName ?? '' })}
                    </Link>
                    {isUpcomingRound && m.status === 'scheduled' ? (
                      <SkewChip className="shrink-0">{t('now.upcoming')}</SkewChip>
                    ) : (
                      <SkewChip tone={MATCH_TONE[m.status] ?? 'neutral'} className="shrink-0">{enumLabel(te, 'matchStatus', m.status)}</SkewChip>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-3 px-4 py-3">
                    {(competition || scheduledLabel) && (
                      <div className="flex flex-col gap-0.5 text-body">
                        {competition && <p className="truncate text-fg">{competition}</p>}
                        {scheduledLabel && <p className="text-fg-muted">{t('now.scheduled', { date: scheduledLabel })}</p>}
                      </div>
                    )}
                    <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
                      {canConfirm && <PlateLink href={`/dashboard/confirm/${m.id}`}>{t('now.confirmResult')}</PlateLink>}
                      {canAct && (
                        <PlateLink href={`/dashboard/submit/${m.id}`} tone={canConfirm ? 'secondary' : 'primary'}>
                          {t('now.submitResult')}
                        </PlateLink>
                      )}
                      {/* Plan Team is always available */}
                      <PlateLink href={`/dashboard/match-prep/${m.id}`} tone="secondary">{t('now.planTeam')}</PlateLink>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </motion.div>

      {/* ─── Stats strip ─── */}
      <motion.div variants={staggerItem}>
        <ul className="flex flex-wrap gap-x-4 gap-y-2.5 px-1.5">
          <StatPlate label={t('stats.matches')}>
            <p className={cn(STAT_VALUE, 'text-fg')}>{matches.length}</p>
          </StatPlate>
          <StatPlate label={t('stats.winRate')}>
            <p className={cn(STAT_VALUE, wins + losses > 0 ? 'text-win' : 'text-fg')}>{formatter.percentOf(winRate, 0)}</p>
          </StatPlate>
          <StatPlate label={t('stats.teams')}>
            <p className={cn(STAT_VALUE, 'text-fg')}>{teamsUsed.length}</p>
          </StatPlate>
          <StatPlate label={t('stats.rating')}>
            {playerRating ? (
              <RatingBadge rating={playerRating.rating} rd={playerRating.rd} size="md" />
            ) : (
              <p className={cn(STAT_VALUE, 'text-fg-muted')}>—</p>
            )}
          </StatPlate>
        </ul>
      </motion.div>

      {!isNewPlayer && (
      <motion.div variants={staggerItem}>
        <div className="flex flex-col gap-6">
          {/* ─── My leagues & tournaments ─── */}
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <Section
            title={t('leagues.title')}
            icon="poke-ball"
            subtitle={t('leagues.count', { count: leagueStandings.length })}
            action={
              <Link href="/leagues">
                <Button variant="ghost" size="sm">{t('leagues.allLeagues')}</Button>
              </Link>
            }
          >
            {leagueStandings.length === 0 ? (
              <p className="py-2 text-body text-fg-muted">{t('leagues.empty')}</p>
            ) : (
              <div className="flex flex-col gap-3">
                <TablePagination
                  page={leaguesTable.page}
                  totalPages={leaguesTable.totalPages}
                  perPage={leaguesTable.perPage}
                  totalItems={leaguesTable.totalItems}
                  onPageChange={leaguesTable.setPage}
                  onPerPageChange={leaguesTable.handlePerPageChange}
                />
                {leaguesTable.pageRows.map(({ leagueId, leagueName, status, formatType, participantCount, isTestSeason, snapshot }) => (
                  <Card key={leagueId} variant="outlined" padding="sm" hover>
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/leagues/${leagueId}`} className={NAME_LINK}>
                        {leagueName}
                      </Link>
                      <div className="flex shrink-0 items-center gap-2">
                        {isTestSeason && <TestLeagueBadge label={tl('list.testBadge')} />}
                        <SkewChip tone={statusTone(status)}>{enumLabel(te, 'seasonStatus', status)}</SkewChip>
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 text-caption text-fg-muted">
                      <span>{enumLabel(te, 'formatType', formatType)}</span>
                      <span>{tc('units.players', { count: participantCount })}</span>
                    </div>
                    {snapshot ? (
                      <p className="mt-1 text-body text-fg-muted">
                        {t.rich('leagues.rank', {
                          rank: snapshot.rank,
                          total: snapshot.total,
                          wins: snapshot.wins,
                          losses: snapshot.losses,
                          strong: (chunks) => (
                            <span className="font-heading text-title text-fg tabular-nums">{chunks}</span>
                          ),
                          muted: (chunks) => <span className="tabular-nums">{chunks}</span>,
                        })}
                      </p>
                    ) : (
                      <p className="mt-1 text-caption text-fg-muted">
                        {status === 'completed' ? t('leagues.noFinalStanding') : t('leagues.statsSoon')}
                      </p>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </Section>

          <Section
            title={t('tournaments.title')}
            icon="kings-rock"
            subtitle={t('tournaments.count', { count: standaloneTournaments.length })}
          >
              {standaloneTournaments.length === 0 ? (
                <p className="py-2 text-body text-fg-muted">
                  {t('tournaments.empty')}
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  <TablePagination
                    page={tournamentsTable.page}
                    totalPages={tournamentsTable.totalPages}
                    perPage={tournamentsTable.perPage}
                    totalItems={tournamentsTable.totalItems}
                    onPageChange={tournamentsTable.setPage}
                    onPerPageChange={tournamentsTable.handlePerPageChange}
                  />
                  {tournamentsTable.pageRows.map((tournament) => (
                    <Link key={tournament.id} href={`/tournaments/${tournament.id}`}>
                      <Card variant="outlined" padding="sm" hover>
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-body font-[550] text-fg">
                            {tournament.name}
                          </span>
                          <SkewChip tone={statusTone(tournament.status)} className="shrink-0">
                            {enumLabel(te, 'tournamentStatus', tournament.status)}
                          </SkewChip>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-caption text-fg-muted">
                          <span>{enumLabel(te, 'bracketType', tournament.bracket_type)}</span>
                          <span>{tc('units.players', { count: tournament.participant_count })}</span>
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
          </Section>
          </div>

          {/* ─── History: collapsed by default ─── */}
          <Section
            title={t('history.title')}
            icon="metronome"
            collapsible
            defaultCollapsed
            subtitle={t('history.summary', { count: teamsUsed.length, wins, losses })}
          >
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
            <div>
              <h3 className={cn(SUBHEAD, 'mb-2')}>{t('history.recentMatches')}</h3>
              {recentMatches.length === 0 ? (
                <p className="py-2 text-body text-fg-muted">
                  {t('history.noCompleted')}
                </p>
              ) : (
                <div className="flex flex-col gap-1">
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
                        className="flex min-h-11 items-center gap-2.5 rounded-poke-md px-2 text-body transition-colors duration-80 ease-out hover:bg-hover"
                      >
                        {won && <SkewChip tone="win">{tc('record.winShort')}</SkewChip>}
                        {lost && <SkewChip tone="loss">{tc('record.lossShort')}</SkewChip>}
                        {!won && !lost && <SkewChip>—</SkewChip>}
                        <span className="min-w-0 truncate font-[550] text-fg">
                          {t('now.versus', { name: opponentName ?? '' })}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className={SUBHEAD}>{t('history.teamsUsed')}</h3>
                <Link href="/teambuilder">
                  <Button variant="ghost" size="sm">{t('history.teambuilder')}</Button>
                </Link>
              </div>
              <TeamsUsedList teamsUsed={teamsUsed} />
            </div>
            </div>
          </Section>
        </div>
      </motion.div>
      )}
    </motion.div>
  );
}
