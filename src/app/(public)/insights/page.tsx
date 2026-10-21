import { Suspense } from 'react';
import PageContainer from '@/components/ui/PageContainer';
import ScopeSelector from '@/components/shared/ScopeSelector';
import InsightsTabs from '@/components/insights/InsightsTabs';
import {
  parseScopeFromSearchParams,
  parseInsightsTab,
  scopeAggregateKey,
  insightsLeagueOptions,
} from '@/lib/insights/scope';
import { publicReads } from '@/lib/cache/public-reads';
import { loadSupplement, packExtensions } from '@/lib/pack-extensions';
import type { SupplementaryKillRowView } from '@/components/supplementary/SupplementaryKillRanking';
import {
  aggregatesToUsageRows,
  metaUsageToUsageRows,
  DEFAULT_GLOBAL_META_FORMAT,
} from '@/lib/stats/usage-rows';
import { buildKillRanking } from '@/lib/stats/kill-ranking';
import { buildStandingsRowsFromMatchRecords } from '@/lib/stats/standings-rows';
import { getT } from '@/i18n/server';
import { insightsMessages } from '@/i18n/messages/insights';

// Reads no session. Rendered per request because it reads `searchParams`;
// every read comes from the tagged public read cache (60 s for the lists and
// all-time data, 30 s for one league or tournament; expired by match writes).

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

type InsightsScope = ReturnType<typeof parseScopeFromSearchParams>;

/** The scope-specific rows (everything but the usage table). */
interface ScopeRows {
  /** The scope's name; null for the global scope, which the page titles in the viewer's language. */
  title: string | null;
  isDoubles: boolean;
  participants: { id: string; name: string }[];
  tournamentId: string | null;
  standings: ReturnType<typeof buildStandingsRowsFromMatchRecords>;
  killRanking: ReturnType<typeof buildKillRanking>;
}

/**
 * Scope-specific reads, all from the public read cache. A tournament scope
 * reads its row, then its participants (public fields only), completed
 * records and the narrow battle_stats in one wave. A league scope reads the
 * season row, the PUBLIC participant rows, the stages' battle_stats and their
 * completed records in one wave (the entries are shared with the league and
 * tournament pages). Null when the scope's tournament or league does not
 * exist. Only ids and names leave this function for the client tabs.
 */
async function loadScopeRows(scope: InsightsScope): Promise<ScopeRows | null> {
  if (scope.type === 'tournament') {
    const tournament = await publicReads.tournament(scope.id);
    if (!tournament) {
      return null;
    }
    const [parts, records, battleStats] = await Promise.all([
      publicReads.tournamentParticipants(scope.id),
      publicReads.tournamentMatchRecords(scope.id),
      publicReads.tournamentBattleStats(scope.id),
    ]);
    return {
      title: tournament.name,
      isDoubles: tournament.is_doubles,
      participants: parts.map((p) => ({ id: p.id, name: p.name })),
      tournamentId: scope.id,
      killRanking: buildKillRanking(battleStats),
      standings: buildStandingsRowsFromMatchRecords(
        parts.map((p) => ({
          id: p.id,
          name: p.name,
          avatar_url: p.avatar_url,
          gym_type: null,
        })),
        records,
      ),
    };
  }

  if (scope.type === 'league') {
    const [season, parts, battleStats, matchRecords] = await Promise.all([
      publicReads.season(scope.id),
      publicReads.seasonParticipants(scope.id),
      publicReads.seasonBattleStats(scope.id),
      publicReads.seasonMatchRecords(scope.id),
    ]);
    if (!season) {
      return null;
    }
    return {
      title: season.name,
      isDoubles: season.format_type === 'doubles',
      participants: parts.map((p) => ({ id: p.id, name: p.name })),
      tournamentId: null,
      killRanking: buildKillRanking(battleStats),
      standings: buildStandingsRowsFromMatchRecords(
        parts.map((p) => ({
          id: p.id,
          name: p.name,
          avatar_url: p.avatar_url,
          gym_type: p.gym_type,
        })),
        matchRecords,
      ),
    };
  }

  return {
    title: null,
    isDoubles: false,
    participants: [],
    tournamentId: null,
    standings: [],
    killRanking: [],
  };
}

/**
 * Everything the selected scope renders. Data flow (D36 fix 6): the
 * aggregate COUNTERS (no move_counts) and the game total run alongside the
 * scope reads instead of before them.
 */
async function loadScopeData(scope: InsightsScope) {
  const { scopeType, scopeId } = scopeAggregateKey(scope);

  const [[aggregates, totalGames], rows] = await Promise.all([
    Promise.all([
      publicReads.aggregatesSummary(scopeType, scopeId),
      publicReads.totalGames(scopeType, scopeId),
    ]),
    loadScopeRows(scope),
  ]);
  if (!rows) {
    return null;
  }

  let usageRows = aggregatesToUsageRows(aggregates, totalGames);
  if (scope.type === 'global' && usageRows.length === 0) {
    const meta = await publicReads.metaUsage(DEFAULT_GLOBAL_META_FORMAT, 100);
    usageRows = metaUsageToUsageRows(meta.data);
  }

  return {
    ...rows,
    usageRows,
    aggregateScopeType: scopeType,
    aggregateScopeId: scopeId,
  };
}

type SupplementaryKills = { state: 'ready'; rows: SupplementaryKillRowView[] } | { state: 'failed' } | undefined;

/**
 * The pack extension's all-time supplementary kill ranking (docs/format-packs.md, "Pack
 * extensions"), for the global scope only and outside every cached read. Undefined (no tab, no
 * query) when the pack has no provider, the records do not count for the viewer, or the scope is
 * not global.
 */
async function loadSupplementaryKills(scope: InsightsScope): Promise<SupplementaryKills> {
  if (scope.type !== 'global') return undefined;
  const result = await loadSupplement('supplementaryKillRanking', packExtensions.supplementaryKillRanking);
  if (result.state === 'failed') return { state: 'failed' };
  if (result.state !== 'ready') return undefined;
  return {
    state: 'ready',
    rows: result.value
      .filter((row) => row.kos > 0)
      .map((row) => ({ pokemonName: row.pokemonName, kos: row.kos })),
  };
}

async function InsightsPageContent({ searchParams }: PageProps) {
  const params = await searchParams;
  const scope = parseScopeFromSearchParams(params);
  const tab = parseInsightsTab(
    typeof params.tab === 'string' ? params.tab : undefined,
  );

  const [leagues, tournaments, ratingRows, scopeData, streakEntries, t, supplementaryKills] = await Promise.all([
    publicReads.seasonList(),
    publicReads.tournamentList(),
    publicReads.ratingLeaderboard(5),
    loadScopeData(scope),
    publicReads.streakLeaderboard(),
    getT(insightsMessages),
    loadSupplementaryKills(scope),
  ]);

  if (!scopeData) {
    return (
      <PageContainer title={t('page.title')} maxWidth="xl">
        <p className="text-poke-text-muted">{t('page.scopeNotFound')}</p>
      </PageContainer>
    );
  }

  // The public list includes test leagues; the stats scope picker never offers one.
  const leagueOptions = insightsLeagueOptions(leagues);
  const tournamentOptions = tournaments.map((t) => ({ id: t.id, name: t.name }));

  return (
    <PageContainer maxWidth="xl">
      <ScopeSelector
        scope={scope}
        leagues={leagueOptions}
        tournaments={tournamentOptions}
        globalOnly={tab === 'ratings'}
        className="mb-6"
      />
      <InsightsTabs
        initialTab={tab}
        scope={scope}
        title={scopeData.title ?? t('page.globalTitle')}
        usageRows={scopeData.usageRows}
        isDoubles={scopeData.isDoubles}
        standings={scopeData.standings}
        killRanking={scopeData.killRanking}
        participants={scopeData.participants}
        tournamentId={scopeData.tournamentId}
        aggregateScopeType={scopeData.aggregateScopeType}
        aggregateScopeId={scopeData.aggregateScopeId}
        ratingRows={ratingRows}
        streakEntries={streakEntries}
        supplementaryKills={supplementaryKills}
      />
    </PageContainer>
  );
}

export default async function InsightsPage(props: PageProps) {
  const t = await getT(insightsMessages);
  return (
    <Suspense
      fallback={
        <PageContainer title={t('page.title')} maxWidth="xl">
          <p className="text-poke-text-muted text-sm">{t('page.loading')}</p>
        </PageContainer>
      }
    >
      <InsightsPageContent {...props} />
    </Suspense>
  );
}
