import Link from 'next/link';
import { notFound } from 'next/navigation';
import { publicReads } from '@/lib/cache/public-reads';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { computeStandingsForFormat } from '@/lib/tournament/standings';
import { scoringByeRecords } from '@/lib/tournament/byes';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import {
  resolveViewerWorld,
  getWorldByRouteThemeId,
  getDefaultWorld,
  WORLD_OVERRIDE_URL_PARAM,
} from '@/lib/worlds/registry';
import WorldShell from '@/components/world/WorldShell';
import WorldOverrideRedirect from '@/components/world/route/WorldOverrideRedirect';
import { aggregatesToUsageRows } from '@/lib/stats/usage-rows';
import { buildKillRanking } from '@/lib/stats/kill-ranking';
import PageContainer from '@/components/ui/PageContainer';
import Badge from '@/components/ui/Badge';
import { getButtonClasses } from '@/components/ui/buttonStyles';
import RulesetDetail from '@/components/ruleset/RulesetDetail';
import ElimBracketView from '@/components/bracket/ElimBracketView';
import SwissStandings from '@/components/bracket/SwissStandings';
import TournamentTabsUnified from '@/components/tournament/TournamentTabsUnified';
import type { PublicMatch } from '@/lib/match/public-match';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { tournamentsMessages } from '@/i18n/messages/tournaments';

// Reads no session. Rendered per request (dynamic segment, `searchParams`).
// Every read but the ruleset comes from the tagged public read cache (30 s,
// expired by match writes on this tournament).

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Tournament / league-phase detail page.
 *
 * Data flow (D36 fixes 6 and 11), through the public read cache (fix 5):
 * the tournament row first, then ONE wave
 * for everything keyed by it — rounds, matches, participants, completed
 * match records, ruleset, the narrow battle_stats read (kill ranking and the
 * RR kill-difference tiebreaker; no moves/turns/match_won), stage reports,
 * the aggregate COUNTERS (no move_counts), the game total, the season row
 * and the season's gym bands (two columns, no player join). Only an EPB
 * season adds a third wave, for its evolution points.
 */
export default async function TournamentPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const tournament = await publicReads.tournament(id);
  if (!tournament) notFound();

  const isRoundRobin = tournament.bracket_type === 'round_robin';

  const [
    rounds,
    matches,
    participants,
    matchRecords,
    ruleset,
    battleStats,
    participantGymTypes,
    reports,
    aggregates,
    totalGamesInScope,
    season,
  ] = await Promise.all([
    publicReads.tournamentRounds(id),
    publicReads.tournamentMatches(id),
    publicReads.tournamentParticipants(id),
    publicReads.tournamentMatchRecords(id),
    // Read live: ruleset edits expire no public cache tag (the rulesets
    // routes revalidate `/admin/rulesets` only).
    tournament.ruleset_id ? getRulesetById(tournament.ruleset_id) : Promise.resolve(null),
    // Battle stats for kill ranking in the Stats tab (RR also uses them in standings)
    publicReads.tournamentBattleStats(id),
    tournament.season_id
      ? publicReads.seasonGymTypes(tournament.season_id)
      : Promise.resolve<Record<string, string | null>>({}),
    publicReads.tournamentReports(id),
    publicReads.aggregatesSummary('tournament', id),
    publicReads.totalGames('tournament', id),
    tournament.season_id ? publicReads.seasonRow(tournament.season_id) : Promise.resolve(null),
  ]);

  const usageRows = aggregatesToUsageRows(aggregates, totalGamesInScope);
  const killRanking = buildKillRanking(battleStats);

  // Season format drives the standings tiebreaker chain (EPB uses
  // evolution points); evolution points feed the client tabs as props.
  const seasonFormatType = season?.format_type ?? null;
  // The same wave reads the season's format rules, whose stored tiebreaker order ranks the table (cached,
  // season-tagged, expired by a format rules save).
  const [evolutionPoints, formatRules] = season && isEvolutionPointBuy(season.format_type)
    ? await Promise.all([publicReads.seasonEvolutionPoints(season.id), publicReads.seasonFormatRules(season.id)])
    : [undefined, null];
  const tiebreakerOrder = formatRules?.tiebreaker_order;

  // World-registered seasons wrap the tournament page in the season world
  // shell so world tokens carry over. B2: the viewer override is resolved
  // here too, so the shell's token namespace and station manifest follow the
  // same world the palette and camera do. Precedence stays `?world=` > admin
  // pin > auto-map (EPB → evoliga/plaza, everything else → sakura, C-096).
  // Standalone tournaments get the park outcome via getDefaultWorld, or the
  // viewer's explicit pick when it names a registered theme.
  const viewerWorld = query[WORLD_OVERRIDE_URL_PARAM];
  const world = season
    ? resolveViewerWorld(season, viewerWorld)
    : (typeof viewerWorld === 'string' ? getWorldByRouteThemeId(viewerWorld) : null) ??
      getDefaultWorld();

  // Group matches by round for bracket components
  const matchesByRound: Record<string, PublicMatch[]> = {};
  for (const match of matches) {
    if (!matchesByRound[match.round_id]) {
      matchesByRound[match.round_id] = [];
    }
    matchesByRound[match.round_id].push(match);
  }
  // Build standings for Swiss display
  const participantIds = participants.map((p) => p.id);
  const participantNames: Record<string, string> = {};
  const participantAvatars: Record<string, string | null> = {};
  for (const p of participants) {
    participantNames[p.id] = p.name;
    participantAvatars[p.id] = p.avatar_url;
  }

  const standings = !isRoundRobin
    ? computeStandingsForFormat(seasonFormatType, participantIds, participantNames, matchRecords, participantAvatars, { byes: scoringByeRecords(tournament.bracket_type, rounds) }, participantGymTypes, { evolutionPoints, tiebreakerOrder })
    : [];

  const totalRounds = rounds.length > 0
    ? Math.max(...rounds.map((r) => r.round_number))
    : 0;

  // Pre-render bracket content for elim formats (server components)
  let bracketContent = null;
  let standingsContent = null;

  if (tournament.bracket_type === 'single_elim' || tournament.bracket_type === 'double_elim') {
    bracketContent = (
      <ElimBracketView
        bracketType={tournament.bracket_type}
        tournamentId={id}
        rounds={rounds}
        matches={matches}
        participants={participants}
        matchRecords={matchRecords}
        bracketResetEnabled={tournament.bracket_reset_enabled ?? true}
      />
    );
  } else if (tournament.bracket_type === 'swiss') {
    standingsContent = <SwissStandings standings={standings} />;
  }

  const pageTitle = season ? `${season.name} — ${tournament.name}` : tournament.name;
  const [t, tc, te] = await Promise.all([getT(tournamentsMessages), getT(commonMessages), getT(enumMessages)]);

  const page = (
    <PageContainer title={pageTitle}>
      {season && (
        <Link
          href={`/leagues/${season.id}#schedule`}
          className="inline-flex items-center gap-1 text-sm font-medium text-poke-text-secondary hover:text-poke-text transition-colors"
          aria-label={t('detail.backToLeagueLabel', { name: season.name })}
        >
          <span aria-hidden="true">←</span> {t('detail.backToLeague', { name: season.name })}
        </Link>
      )}
      <div className="flex flex-wrap gap-2 items-center text-sm text-poke-text-secondary">
        <span>{enumLabel(te, 'bracketType', tournament.bracket_type)}</span>
        <span>&middot;</span>
        <span>{tc('bestOf', { count: tournament.best_of_default })}</span>
        {tournament.is_doubles && (
          <>
            <span>&middot;</span>
            <Badge variant="purple">{t('list.doubles')}</Badge>
          </>
        )}
        <span>&middot;</span>
        <span>{tournament.ruleset_name}</span>
        <span>&middot;</span>
        <span>{tc('units.players', { count: tournament.participant_count })}</span>
        <span>&middot;</span>
        <Link
          href={`/insights?scope=tournament&id=${id}&tab=usage`}
          className={getButtonClasses('ghost', 'sm')}
        >
          {t('detail.insights')}
        </Link>
      </div>

      {tournament.description && (
        <p className="text-sm text-poke-text-secondary whitespace-pre-wrap max-w-3xl">{tournament.description}</p>
      )}

      {/* Unified tabbed layout for all bracket types */}
      <TournamentTabsUnified
        bracketType={tournament.bracket_type as 'round_robin' | 'swiss' | 'single_elim' | 'double_elim'}
        participants={participants.map((p) => ({
          id: p.id,
          name: p.name,
          avatar_url: p.avatar_url,
          gym_type: participantGymTypes[p.id] ?? null,
        }))}
        rounds={rounds.map((r) => ({
          id: r.id,
          name: r.name,
          round_number: r.round_number,
          status: r.status,
        }))}
        matches={matches}
        matchRecords={matchRecords}
        matchesByRound={matchesByRound}
        battleStats={battleStats}
        tournamentId={id}
        totalRounds={totalRounds}
        reports={reports}
        bracketContent={bracketContent}
        standingsContent={standingsContent}
        rulesetContent={ruleset ? <RulesetDetail ruleset={ruleset} /> : undefined}
        usageRows={usageRows}
        killRanking={killRanking}
        isDoubles={tournament.is_doubles}
        seasonFormatType={seasonFormatType}
        seasonId={tournament.season_id}
        evolutionPoints={evolutionPoints}
        tiebreakerOrder={tiebreakerOrder}
        layout="sections"
      />
    </PageContainer>
  );

  return (
    <WorldShell world={world}>
      <WorldOverrideRedirect />
      {page}
    </WorldShell>
  );
}
