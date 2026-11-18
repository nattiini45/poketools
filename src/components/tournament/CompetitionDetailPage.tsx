import { notFound } from 'next/navigation';
import { publicReads } from '@/lib/cache/public-reads';
import { loadNativePhasePageData } from '@/lib/league-phase/public-page-data';
import { phaseHref, phaseMatchHref, phaseMatchHrefPrefix, phaseStatsHref, type LeaguePhaseAddress } from '@/lib/league-phase/paths';
import type { PublicPhase } from '@/lib/cache/phase-public-reads';
import type { TournamentWithDetails } from '@/types/tournament';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { computeStandingsForFormat } from '@/lib/tournament/standings';
import { roundRobinMatchPoints } from '@/lib/tournament/standings-rules';
import { scoringByeRecords } from '@/lib/tournament/byes';
import { buildTournamentHero, parseTournamentTab, tournamentPageTabs, TOURNAMENT_TAB_PARAM, type TournamentPageTab } from '@/lib/tournament/page-view';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { kitForPhase } from '@/lib/format-engine/context';
import {
  resolveViewerWorld,
  getWorldByRouteThemeId,
  getDefaultWorld,
  WORLD_OVERRIDE_URL_PARAM,
} from '@/lib/worlds/registry';
import WorldShell from '@/components/world/WorldShell';
import WorldThemeSwitcher from '@/components/world/WorldThemeSwitcher';
import WorldOverrideRedirect from '@/components/world/route/WorldOverrideRedirect';
import { aggregatesToUsageRows } from '@/lib/stats/usage-rows';
import { buildKillRanking } from '@/lib/stats/kill-ranking';
import PageContainer from '@/components/ui/PageContainer';
import Link from 'next/link';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewPlate from '@/components/ui/SkewPlate';
import LinkTabs from '@/components/ui/LinkTabs';
import TournamentHero from '@/components/tournament/TournamentHero';
import { ENABLE_KALE_CABBAGE } from '@/lib/feature-flags';
import type { ItemIconId } from '@/lib/pkmn/item-icons';
import RulesetDetail from '@/components/ruleset/RulesetDetail';
import ElimBracketView from '@/components/bracket/ElimBracketView';
import SwissStandings from '@/components/bracket/SwissStandings';
import TournamentTabsUnified from '@/components/tournament/TournamentTabsUnified';
import type { PublicMatch } from '@/lib/match/public-match';
import { getLocale, getT } from '@/i18n/server';
import { tournamentsMessages } from '@/i18n/messages/tournaments';

// Reads no session. Rendered per request (dynamic segment, `searchParams`).
// Every read but the ruleset comes from the tagged public read cache (30 s,
// expired by match writes on this tournament).

const TAB_ICON: Record<TournamentPageTab, ItemIconId> = {
  standings: 'star-piece',
  bracket: 'kings-rock',
  rounds: 'vs-seeker',
  matrix: 'town-map',
  stats: 'scope-lens',
  ruleset: 'ability-shield',
  report: 'poke-flute',
};

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
async function loadLegacyDetail(tournament: TournamentWithDetails) {
  const { id } = tournament;
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

  // Season format drives the standings tiebreaker chain (EPB uses
  // evolution points); evolution points feed the client tabs as props.
  // The same wave reads the season's format rules, whose stored tiebreaker order ranks the table (cached,
  // season-tagged, expired by a format rules save).
  const [evolutionPoints, formatRules] = season && isEvolutionPointBuy(season.format_type)
    ? await Promise.all([publicReads.seasonEvolutionPoints(season.id), publicReads.seasonFormatRules(season.id)])
    : [undefined, null];
  const tiebreakerOrder = formatRules?.tiebreaker_order;
  // A stage of a kit league ranks by its own stage of the attached format (cached, season-tagged).
  const kit = season?.format_type === 'custom' ? kitForPhase(await publicReads.seasonKitStandings(season.id), id) : undefined;
  return {
    rounds, matches, participants, matchRecords, ruleset, battleStats, participantGymTypes, reports,
    aggregates, totalGamesInScope, season, evolutionPoints, tiebreakerOrder, kit,
  };
}

type CompetitionDetail = { kind: 'tournament' | 'legacy-phase'; tournament: TournamentWithDetails }
  | { kind: 'phase'; phase: PublicPhase };

export async function renderCompetitionDetail(
  entry: CompetitionDetail,
  query: Record<string, string | string[] | undefined>,
  forceTab?: TournamentPageTab,
) {
  const competition = entry.kind === 'phase' ? entry.phase : entry.tournament;
  const { id } = competition;
  const address: LeaguePhaseAddress | undefined = entry.kind !== 'tournament' && competition.season_id
    ? { season_id: competition.season_id, phase_id: id } : undefined;
  const native = entry.kind === 'phase' && address ? address : undefined;
  const data = entry.kind === 'phase'
    ? await loadNativePhasePageData(entry.phase, ENABLE_KALE_CABBAGE)
    : await loadLegacyDetail(entry.tournament);
  if (!data) notFound();
  const {
    rounds, matches, participants, matchRecords, ruleset, battleStats, participantGymTypes, reports, aggregates,
    totalGamesInScope, season, evolutionPoints, tiebreakerOrder, kit,
  } = data;
  const isRoundRobin = competition.bracket_type === 'round_robin';
  const seasonFormatType = season?.format_type ?? null;
  const usageRows = aggregatesToUsageRows(aggregates, totalGamesInScope);
  const killRanking = buildKillRanking(battleStats);

  // World-registered seasons keep the season world's ground behind the tournament page. B2: the viewer override is resolved
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
  const matchesByRound: Record<string, Omit<PublicMatch, 'tournament_id'>[]> = {};
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
    ? computeStandingsForFormat(seasonFormatType, participantIds, participantNames, matchRecords, participantAvatars, { byes: scoringByeRecords(competition.bracket_type, rounds) }, participantGymTypes, { evolutionPoints, tiebreakerOrder, kit })
    : [];

  const totalRounds = rounds.length > 0
    ? Math.max(...rounds.map((r) => r.round_number))
    : 0;

  // Pre-render bracket content for elim formats (server components)
  let bracketContent = null;
  let standingsContent = null;

  if (competition.bracket_type === 'single_elim' || competition.bracket_type === 'double_elim') {
    bracketContent = (
      <ElimBracketView
        bracketType={competition.bracket_type}
        {...(address ? { matchHrefPrefix: phaseMatchHrefPrefix(address) } : { tournamentId: id })}
        rounds={rounds}
        matches={matches}
        participants={participants}
        matchRecords={matchRecords}
        bracketResetEnabled={competition.bracket_reset_enabled ?? true}
        thirdPlaceEnabled={competition.third_place_enabled ?? false}
      />
    );
  } else if (competition.bracket_type === 'swiss') {
    standingsContent = <SwissStandings standings={standings} />;
  }

  const [t, locale] = await Promise.all([getT(tournamentsMessages), getLocale()]);

  // The hero's table: the one the standings tab shows. A round robin's is computed in the client tabs (its round
  // filter recomputes it), so the hero ranks it here with the same inputs, unfiltered. An elimination bracket has
  // no table: the generic standings do not model bracket placement, so the hero names no leader or champion.
  const heroStandings = isRoundRobin
    ? computeStandingsForFormat(seasonFormatType, participantIds, participantNames, matchRecords, participantAvatars, {
        ...roundRobinMatchPoints(seasonFormatType),
        battleStats,
        gamesByMatch: Object.fromEntries(
          matches.filter((m) => m.status === 'completed').map((m) => [m.id, m.games.map((game) => game.winner_id ?? '')]),
        ),
      }, participantGymTypes, { evolutionPoints, tiebreakerOrder, kit })
    : competition.bracket_type === 'swiss'
      ? standings
      : [];
  const hero = buildTournamentHero({ matches, standings: heroStandings });

  // One link-tab strip: the tab lives in `?tab=`, every other query parameter (the world override) is kept.
  const tabs = tournamentPageTabs(competition.bracket_type, { ruleset: ruleset !== null, reports: ENABLE_KALE_CABBAGE });
  const activeTab = forceTab ?? parseTournamentTab(query[TOURNAMENT_TAB_PARAM], tabs);
  const tabLabel: Record<TournamentPageTab, string> = {
    standings: isRoundRobin ? t('tabs.rankings') : t('tabs.standings'),
    bracket: t('tabs.bracket'),
    rounds: t('tabs.rounds'),
    matrix: t('tabs.overview'),
    stats: t('tabs.stats'),
    ruleset: t('tabs.ruleset'),
    report: t('tabs.report'),
  };
  const tabHref = (tab: TournamentPageTab) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (key === TOURNAMENT_TAB_PARAM) continue;
      if (typeof value === 'string') params.set(key, value);
      else if (address && value) for (const item of value) params.append(key, item);
    }
    if (tab !== tabs[0] && !(address && tab === 'stats')) params.set(TOURNAMENT_TAB_PARAM, tab);
    const search = params.toString();
    const href = address ? (tab === 'stats' ? phaseStatsHref(address) : phaseHref(address)) : `/tournaments/${id}`;
    return `${href}${search ? `?${search}` : ''}`;
  };

  return (
    <PageContainer>
      <WorldOverrideRedirect />
      <TournamentHero
        tournament={competition}
        matchHref={address && hero.match ? phaseMatchHref(address, hero.match.matchId) : undefined}
        league={season ? { id: season.id, name: season.name } : null}
        roundCount={totalRounds}
        view={hero}
        locale={locale}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <LinkTabs
          tabs={tabs.map((tab) => ({ key: tab, href: tabHref(tab), label: tabLabel[tab], icon: <ItemIcon item={TAB_ICON[tab]} /> }))}
          activeKey={activeTab}
          label={t('detail.tabsLabel')}
          glideId="tournament-tabs"
          className="min-w-0"
        />
        <Link href={address ? tabHref('stats') : `/insights?scope=tournament&id=${id}&tab=usage`} className="relative inline-flex rounded-[3px] text-body">
          <SkewPlate variant="button" tone="secondary">
            {t('detail.insights')}
          </SkewPlate>
        </Link>
      </div>
      <h2 className="sr-only">{tabLabel[activeTab]}</h2>
      <TournamentTabsUnified
        bracketType={competition.bracket_type as 'round_robin' | 'swiss' | 'single_elim' | 'double_elim'}
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
        {...(native ? { phase: native } : { tournamentId: id })}
        matchHrefPrefix={address && phaseMatchHrefPrefix(address)}
        totalRounds={totalRounds}
        reports={reports}
        bracketContent={bracketContent}
        standingsContent={standingsContent}
        rulesetContent={ruleset ? <RulesetDetail ruleset={ruleset} /> : undefined}
        usageRows={usageRows}
        killRanking={killRanking}
        isDoubles={competition.is_doubles}
        seasonFormatType={seasonFormatType}
        seasonId={competition.season_id}
        evolutionPoints={evolutionPoints}
        tiebreakerOrder={tiebreakerOrder}
        kit={kit}
        activeTab={activeTab}
      />
      {/* The world keeps its ground behind the page (a fixed layer) and its picker; everything above is on the
          site's own tokens (redesign B3). */}
      <WorldShell world={world}>
        <div className="flex justify-end">
          <WorldThemeSwitcher className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 whitespace-nowrap px-3 font-heading text-sm font-semibold text-arena-ink transition-colors duration-150 hover:text-arena-accent-strong focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-arena-focus" />
        </div>
      </WorldShell>
    </PageContainer>
  );
}
