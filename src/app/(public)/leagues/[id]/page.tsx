import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { publicReads } from '@/lib/cache/public-reads';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { aggregatesToUsageRows } from '@/lib/stats/usage-rows';
import { buildKillRanking } from '@/lib/stats/kill-ranking';
import { getFormatCapabilities, type FormatCapabilities } from '@/lib/season/format-capabilities';
import { isDraftLike } from '@/lib/season/format-utils';
import { getSessionPlayer } from '@/lib/auth/helpers';
import { getPendingTradeRequestsForPlayer } from '@/lib/supabase/queries/redraft-trade-requests';
import { getPlayerWorldExperience } from '@/lib/supabase/queries/players';
import { DEFAULT_WORLD_EXPERIENCE, type WorldExperience } from '@/types/player';
import type { SessionPlayer } from '@/types/auth';
import type { PublicSeasonParticipant } from '@/lib/players/public-player';
import PageContainer from '@/components/ui/PageContainer';
import RulesetDetail from '@/components/ruleset/RulesetDetail';
import TradeConsentPrompt, {
  type PendingTradeView,
} from '@/components/league/TradeConsentPrompt';
import { resolveViewerWorld, WORLD_OVERRIDE_URL_PARAM } from '@/lib/worlds/registry';
import type { WorldRouteData } from '@/lib/worlds/route-data';
import type { SeasonWorld } from '@/lib/worlds/types';
import WorldOverrideRedirect from '@/components/world/route/WorldOverrideRedirect';
import EvoligaWorld from '@/components/world/evoliga/EvoligaWorld';
import SakuraWorld from '@/components/world/themes/sakura/SakuraWorld';
import MountainWorld from '@/components/world/themes/mountain/MountainWorld';
import CloudsWorld from '@/components/world/themes/clouds/CloudsWorld';
import DefaultWorld from '@/components/world/default/DefaultWorld';
import LeagueHub from '@/components/league/hub/LeagueHub';
import { ENABLE_KALE_CABBAGE } from '@/lib/feature-flags';
import {
  availableLeagueHubTabs,
  LEAGUE_HUB_TAB_PARAM,
  parseLeagueHubTab,
} from '@/lib/league-hub/tabs';
import { loadLeagueHubPanel } from '@/lib/league-hub/load';
import { getLocale } from '@/i18n/server';
import { createTranslator } from '@/i18n/core';
import { leaguesMessages } from '@/i18n/messages/leagues';
import { glossaryMessages } from '@/i18n/messages/glossary';

/**
 * The route worlds' id → component dispatch (C-094: a third world forced
 * the two-arm ternary into this record — component references in a server
 * component are fine; the callable-import law targets functions, not
 * component refs). The generic data contract is C-093's; every arm consumes
 * `WorldRouteData` and adapts it inside its own root.
 */
const ROUTE_WORLDS: Record<
  string,
  (props: {
    world: SeasonWorld;
    data: WorldRouteData;
    worldExperience?: WorldExperience;
    hub?: ReactNode;
  }) => ReactNode
> = {
  evoliga: EvoligaWorld,
  sakura: SakuraWorld,
  mountain: MountainWorld,
  clouds: CloudsWorld,
};

// Dynamic: the page reads the viewer's session (world preference, pending
// trades). Every public read comes from the tagged public read cache (30 s,
// expired by match writes); see `src/lib/cache/public-reads.ts`.
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * EPB trade-consent prompt data: only for Evolution Point Buy seasons with a
 * logged-in player. Reads this viewer's pending trade requests and resolves
 * the display data (role, lines, partner name, consent flags). Empty — and no
 * read at all — for anonymous viewers and other formats (spec §15
 * state-awareness: the prompt is hidden when there is nothing to show).
 */
async function loadPendingTradeViews(
  seasonId: string,
  caps: FormatCapabilities,
  sessionPlayer: SessionPlayer | null,
  participants: readonly PublicSeasonParticipant[],
  unknownPlayerName: string,
): Promise<PendingTradeView[]> {
  if (!caps.evolutionRedraft || !sessionPlayer) return [];
  const playerNameMap = new Map(participants.map((p) => [p.id, p.name]));
  const pending = await getPendingTradeRequestsForPlayer(seasonId, sessionPlayer.playerId);
  return pending.map((req) => {
    const isA = sessionPlayer.playerId === req.player_a_id;
    const role = isA ? 'a' : 'b';
    const partnerId = isA ? req.player_b_id : req.player_a_id;
    const yourLine = isA ? req.line_a : req.line_b;
    const receivedLine = isA ? req.line_b : req.line_a;
    const partnerName = playerNameMap.get(partnerId) ?? unknownPlayerName;
    return {
      requestId: req.id,
      role,
      yourLine,
      receivedLine,
      partnerName,
      otherName: partnerName,
      youConsented: isA ? req.consent_a : req.consent_b,
      otherConsented: isA ? req.consent_b : req.consent_a,
    };
  });
}

/**
 * League detail page.
 *
 * Data flow (query budget, D36 fix 4). Every public read below goes through
 * the tagged public read cache (D36 fix 5), so a warm render issues only the
 * viewer-scoped reads; the counts are for a cold cache:
 *   1. the season row (also the world resolver's input);
 *   2. one wave shared by both branches: stages, PUBLIC participant rows
 *      (`getPublicSeasonParticipants` — no private player columns are read)
 *      and the viewer's session;
 *   3a. route-world branch (every registered world): `buildWorldRouteData`
 *      with the rows above preloaded — one wave of ≤ 6 reads — plus, for a
 *      signed-in viewer only, the world-experience preference and (EPB) the
 *      pending trades. The league hub's default tab (season standings)
 *      renders from that payload, so a bare league URL reads no ruleset,
 *      aggregates, game totals or battle_stats. Only a selected hub tab
 *      (`?tab=matches|groups|playoffs|phases|insights|rules|reports`) adds its
 *      own reads, in the same wave (`loadLeagueHubPanel`);
 *   3b. DefaultWorld fallback branch: the stats-tab reads (ruleset, aggregate
 *      counters, game total, battle_stats for the kill ranking), stage groups
 *      and reports, and the schedule.
 */
export default async function LeagueDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const league = await publicReads.season(id);
  if (!league) notFound();

  const caps = getFormatCapabilities(league.format_type);

  // Every format renders a route world (evoliga for Evolution Point Buy, the
  // sakura park for the others; mountain and clouds by pin or override):
  // one-page anchor sections plus context overlays, with the league hub
  // (tabbed standings, matches, groups, playoffs, insights, rules) at the
  // top of #pulse.
  //
  // B2: the VIEWER override is resolved here, server-side, so the scene root,
  // the shell's token namespace, the station manifest and the DOM sections all
  // come from ONE world. Precedence stays `?world=` > admin pin > auto-map; a
  // persisted preference reaches the server as that param via
  // `WorldOverrideRedirect`. The world is resolved from the season row alone,
  // BEFORE any branch-specific read, so each branch fetches only what it renders.
  const world = resolveViewerWorld(league, query[WORLD_OVERRIDE_URL_PARAM]);
  const RouteWorld = ROUTE_WORLDS[world.id];

  // The viewer's language is a cookie read (no query); every visible word
  // below and in the hub follows it, whatever the world.
  const [stages, participants, sessionPlayer, locale] = await Promise.all([
    publicReads.seasonStages(id),
    publicReads.seasonParticipants(id),
    getSessionPlayer(),
    getLocale(),
  ]);
  const t = createTranslator(leaguesMessages, locale);

  if (RouteWorld) {
    // C-093 wave-1 production wiring: EVERY route world fetches through the
    // generic contract builder — the pages' data path is the contract, and
    // each world root adapts it (evoliga: the inline toEvoligaRouteData
    // mapping; sakura: toSakuraRouteData; mountain: toMountainRouteData,
    // each inside its root). The builder receives the season, stages and
    // participants already loaded above instead of reading them again, and
    // maps participants to the public shape before they reach the client.
    //
    // The signed-in viewer's 3D world preference rides along: ONE targeted
    // single-column read, only on this branch (pages that mount no scene do
    // not read it). Signed-out visitors and a failed preference read get
    // DEFAULT_WORLD_EXPERIENCE ('off', the simple version) — a settings hiccup
    // must never 500 a public league page.
    //
    // The league hub (standings, matches, group tables, playoffs, phases,
    // insights, rules) reads only its selected tab (`?tab=`), in this same
    // wave. The default tab renders from the world payload alone, so a bare
    // league URL keeps the budget above; each other tab adds its own reads
    // (see `loadLeagueHubPanel`).
    const hubTabs = availableLeagueHubTabs(stages, { reports: ENABLE_KALE_CABBAGE });
    const hubTab = parseLeagueHubTab(query[LEAGUE_HUB_TAB_PARAM], hubTabs);
    const routeDataRead = publicReads.worldRouteData(id, { league, stages, participants });
    const [routeData, worldExperience, pendingTradeViews, hubPanel] = await Promise.all([
      routeDataRead,
      sessionPlayer
        ? getPlayerWorldExperience(sessionPlayer.playerId).catch((err: unknown): WorldExperience => {
            console.error('[leagues/[id]] world_experience read failed:', err);
            return DEFAULT_WORLD_EXPERIENCE;
          })
        : Promise.resolve<WorldExperience>(DEFAULT_WORLD_EXPERIENCE),
      loadPendingTradeViews(id, caps, sessionPlayer, participants, t('detail.unknownPlayer')),
      loadLeagueHubPanel(hubTab, { seasonId: id, league, stages, participants, routeData: routeDataRead }),
    ]);
    if (!routeData || !hubPanel) notFound();

    return (
      <PageContainer title={league.name}>
        <WorldOverrideRedirect />
        {/* Player-facing consent prompt for pending EPB trades — stays
            visible in the scrollworld, above the sections. */}
        {pendingTradeViews.length > 0 && (
          <TradeConsentPrompt seasonId={id} requests={pendingTradeViews} />
        )}
        {/* `world` is restated on the payload so the contract can never carry
            the format auto-map's identity alongside a different viewer- or
            pin-resolved composition. */}
        <RouteWorld
          world={world}
          data={{ ...routeData, world }}
          worldExperience={worldExperience}
          hub={
            <LeagueHub
              league={league}
              stages={stages}
              participants={participants}
              locale={locale}
              query={query}
              tabs={hubTabs}
              activeTab={hubTab}
              panel={hubPanel}
            />
          }
        />
      </PageContainer>
    );
  }

  // DOM-only fallback: reached only when the resolved world has no route-world
  // root — an admin pin naming an unregistered theme, or a format no world
  // claims. Since the C-096 auto-map flip the ordinary non-EPB case resolves to
  // the sakura park and takes the route-world branch above, so this is the
  // graceful-degradation path, not the default league layout. It is the only
  // branch that renders the stats tab, so it alone reads the ruleset, the
  // aggregate counters, the game total and battle_stats (kill ranking — the
  // AGENTS.md carve-out for kill rankings).
  const [
    ruleset,
    aggregates,
    totalGamesInScope,
    seasonBattleStats,
    stageGroups,
    reportsPerStage,
    schedule,
    pendingTradeViews,
  ] = await Promise.all([
    // Read live: ruleset edits expire no public cache tag (the rulesets
    // routes revalidate `/admin/rulesets` only).
    league.ruleset_id ? getRulesetById(league.ruleset_id) : Promise.resolve(null),
    publicReads.aggregatesSummary('league', id),
    publicReads.totalGames('league', id),
    publicReads.seasonBattleStats(id),
    Promise.all(
      stages.map(async (stage) => ({ stage, groups: await publicReads.tournamentGroups(stage.id) })),
    ),
    Promise.all(stages.map((stage) => publicReads.tournamentReports(stage.id))),
    publicReads.leagueSchedule(id, { stages, participants }),
    loadPendingTradeViews(id, caps, sessionPlayer, participants, t('detail.unknownPlayer')),
  ]);

  const tGlossary = createTranslator(glossaryMessages, locale);
  const usageRows = aggregatesToUsageRows(aggregates, totalGamesInScope);
  const killRanking = buildKillRanking(seasonBattleStats);
  const allReports = reportsPerStage.flat();
  const isDoubles = league.format_type === 'doubles';

  // Build gym type lookup: player_id → gym_type
  const gymTypeMap = new Map(participants.map((p) => [p.id, p.gym_type]));

  const draftLinks = isDraftLike(league.format_type)
    ? [
        { href: `/leagues/${id}/draft`, label: tGlossary('draft.draftRoom'), variant: 'secondary' as const },
        ...(caps.pointBuyList
          ? [{ href: `/leagues/${id}/point-buy`, label: t('detail.pointBuy'), variant: 'ghost' as const }]
          : []),
        ...(caps.matchupRoles
          ? [{ href: `/leagues/${id}/matchup`, label: t('detail.matchup'), variant: 'ghost' as const }]
          : []),
        ...(caps.evolutionProgress
          ? [{ href: `/leagues/${id}/teams`, label: t('detail.teams'), variant: 'ghost' as const }]
          : []),
      ]
    : [];

  return (
    <PageContainer title={league.name}>
      <DefaultWorld
        world={world}
        league={{
          id,
          name: league.name,
          format_type: league.format_type,
          ruleset_name: league.ruleset_name,
          participant_count: league.participant_count,
          status: league.status,
          start_date: league.start_date,
          end_date: league.end_date,
          description: league.description,
        }}
        stageGroups={stageGroups}
        reports={allReports}
        phaseNames={Object.fromEntries(stages.map((s) => [s.id, s.name]))}
        rulesetContent={ruleset ? <RulesetDetail ruleset={ruleset} /> : undefined}
        usageRows={usageRows}
        killRanking={killRanking}
        isDoubles={isDoubles}
        standings={schedule.standings}
        fixtures={schedule.fixtures}
        pendingTradeViews={pendingTradeViews}
        typeCoreParticipants={
          caps.typeCores
            ? participants.map((p) => ({
                id: p.id,
                name: p.name,
                coreTypes: p.core_types,
              }))
            : undefined
        }
        gymTypeMap={gymTypeMap}
        draftLinks={draftLinks}
      />
    </PageContainer>
  );
}
