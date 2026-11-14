'use client';

import { useState } from 'react';
import Link from 'next/link';
import PokemonUsageTable from '@/components/stats/PokemonUsageTable';
import HistoricalStatisticsCoverage from '@/components/stats/HistoricalStatisticsCoverage';
import PokemonLink from '@/components/shared/PokemonLink';
import Table, { type Column } from '@/components/ui/Table';
import MoveUsageTable from '@/components/stats/MoveUsageTable';
import HeadToHeadMatrix from '@/components/stats/HeadToHeadMatrix';
import KillRankingTable from '@/components/stats/KillRankingTable';
import StandingsTable from '@/components/stats/StandingsTable';
import SupplementaryKillRanking, {
  type SupplementaryKillRowView,
} from '@/components/supplementary/SupplementaryKillRanking';
import LeaderboardContent from '@/app/(public)/leaderboard/LeaderboardContent';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import LinkTabs from '@/components/ui/LinkTabs';
import Select from '@/components/ui/Select';
import { scopeToQueryString, type InsightsScope, type InsightsTab } from '@/lib/insights/scope';
import type { KillRankingRow, StandingsRow } from '@/types/game';
import type { CombinedPokemonUsageRow, HistoricalStatisticsView } from '@/lib/stats/combined-statistics';
import type { RatingLeaderboardEntry } from '@/types/rating';
import type { StreakLeaderboardEntry } from '@/types/insights';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { insightsMessages } from '@/i18n/messages/insights';
import { historicalStatisticsMessages } from '@/i18n/messages/historical-statistics';
import { statsMessages } from '@/i18n/messages/stats';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { foldForSearch } from '@/lib/pkmn/i18n/search';

interface InsightsTabsProps {
  activeTab: InsightsTab;
  scope: InsightsScope;
  usageRows: CombinedPokemonUsageRow[];
  history?: HistoricalStatisticsView;
  isDoubles: boolean;
  standings: StandingsRow[];
  killRanking: KillRankingRow[];
  participants: { id: string; name: string }[];
  tournamentId: string | null;
  aggregateScopeType: string;
  aggregateScopeId: string | null;
  ratingRows: RatingLeaderboardEntry[];
  streakEntries: StreakLeaderboardEntry[];
  /**
   * Global scope only: the active pack extension's all-time supplementary kill ranking
   * (docs/format-packs.md, "Pack extensions"). Absent when the pack has none or the records do
   * not count for this viewer; the global scope then has no kills tab, as before.
   */
  supplementaryKills?: { state: 'ready'; rows: readonly SupplementaryKillRowView[] } | { state: 'failed' };
}

export default function InsightsTabs({
  activeTab: requestedTab,
  scope,
  usageRows,
  isDoubles,
  standings,
  killRanking,
  participants,
  tournamentId,
  aggregateScopeType,
  aggregateScopeId,
  ratingRows,
  streakEntries,
  supplementaryKills,
  history,
}: InsightsTabsProps) {
  const t = useT(insightsMessages);
  const h = useT(historicalStatisticsMessages);
  const s = useT(statsMessages);
  const dl = useDataLocale();
  const f = useFormatter();
  const combinedKills = scope.type === 'archive' || scope.type === 'global' && history !== undefined && history.state !== 'absent';
  const hasHistory = history?.state === 'ready' && history.coverage.length > 0;
  const koColumns: Column<CombinedPokemonUsageRow>[] = [
    {
      key: 'pokemon_name', header: s('usage.pokemon'), sortable: true,
      sortValue: (row) => foldForSearch(localizeSpecies(row.pokemon_name, dl)),
      render: (row) => <PokemonLink name={row.pokemon_name}>{localizeSpecies(row.pokemon_name, dl)}</PokemonLink>,
    },
    {
      key: 'kos_dealt', header: s('usage.kos'), sortable: true, align: 'right',
      sortValue: (row) => row.kos_dealt,
      render: (row) => <span className="tabular-nums">
        {row.kos_dealt === null ? <span aria-label={h('notRecorded')}>—</span> : f.number(row.kos_dealt)}
        {row.sourceCounts && <span className="block text-xs text-fg-muted">{h('sourceCounts', {
          live: f.number(row.sourceCounts.liveKos),
          historical: row.sourceCounts.historicalKos === null ? h('notRecorded') : f.number(row.sourceCounts.historicalKos),
        })}</span>}
      </span>,
    },
  ];

  const showSupplementaryKills =
    !combinedKills &&
    scope.type === 'global' &&
    supplementaryKills !== undefined &&
    (supplementaryKills.state === 'failed' || supplementaryKills.rows.length > 0);
  const showKills = requestedTab === 'kills' || combinedKills || (scope.type !== 'global' && killRanking.length > 0) || showSupplementaryKills;
  const showH2h = scope.type === 'tournament' && tournamentId && participants.length > 0;
  const showStandings = scope.type !== 'global' && standings.length > 0;

  const tabs: InsightsTab[] = [
    'ratings',
    'usage',
    ...(showKills ? (['kills'] as const) : []),
    'moves',
    ...(showH2h ? (['h2h'] as const) : []),
    'streaks',
  ];

  const activeTab = tabs.includes(requestedTab) ? requestedTab : 'usage';
  const scopeQuery = scopeToQueryString(scope);

  const [h2hPlayer1, setH2hPlayer1] = useState('');
  const [h2hPlayer2, setH2hPlayer2] = useState('');

  return (
    <div className="space-y-6">
      <LinkTabs
        tabs={tabs.map((tab) => ({ key: tab, href: `/insights?${scopeQuery}&tab=${tab}`, label: t(`tabs.${tab}`) }))}
        activeKey={activeTab}
        label={t('page.tabsLabel')}
        glideId="insights-tabs"
      />

      {history && <HistoricalStatisticsCoverage history={history} />}

      {activeTab === 'ratings' && (
        <div className="space-y-2">
          {hasHistory && <p className="text-caption text-fg-muted">{h('ratingsLiveOnly')}</p>}
          {scope.type !== 'global' && (
            <p className="text-caption text-fg-muted">{t('ratingsGlobalNote')}</p>
          )}
          <LeaderboardContent initialRows={ratingRows} />
        </div>
      )}

      {activeTab === 'usage' && (
        <PokemonUsageTable data={usageRows} isDoubles={isDoubles} />
      )}

      {activeTab === 'kills' && combinedKills && (
        <Table columns={koColumns} data={usageRows.filter((row) => row.kos_dealt !== null && row.kos_dealt > 0)} keyExtractor={(row) => row.pokemon_name} stickyColumn="pokemon_name" defaultSort={{ key: 'kos_dealt', direction: 'desc' }} emptyMessage={h('noRecordedKos')} />
      )}

      {activeTab === 'kills' && showKills && !showSupplementaryKills && !combinedKills && (
        <KillRankingTable data={killRanking} />
      )}

      {activeTab === 'kills' && showSupplementaryKills && supplementaryKills && (
        <SupplementaryKillRanking
          rows={supplementaryKills.state === 'ready' ? supplementaryKills.rows : []}
          failed={supplementaryKills.state === 'failed'}
        />
      )}

      {activeTab === 'moves' && (
        scope.type === 'archive' ? <p className="text-body text-fg-muted">{h('archiveMovesUnavailable')}</p> : <div className="space-y-3">
          {hasHistory && <p className="text-caption text-fg-muted">{h('movesLiveOnly')}</p>}
        <MoveUsageTable
          scopeType={aggregateScopeType}
          scopeId={aggregateScopeId ?? ''}
        />
        </div>
      )}

      {activeTab === 'h2h' && showH2h && tournamentId && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 basis-44 sm:max-w-xs">
              <Select label={t('h2h.player1')} value={h2hPlayer1} onChange={(e) => setH2hPlayer1(e.target.value)}>
                <option value="">{t('h2h.selectPlayer')}</option>
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <span className="pb-2.5 text-body text-fg-muted max-sm:hidden">{t('h2h.versus')}</span>
            <div className="min-w-0 flex-1 basis-44 sm:max-w-xs">
              <Select label={t('h2h.player2')} value={h2hPlayer2} onChange={(e) => setH2hPlayer2(e.target.value)}>
                <option value="">{t('h2h.selectPlayer')}</option>
                {participants
                  .filter((p) => p.id !== h2hPlayer1)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </div>
          </div>
          {h2hPlayer1 && h2hPlayer2 ? (
            <HeadToHeadMatrix
              tournamentId={tournamentId}
              player1Id={h2hPlayer1}
              player2Id={h2hPlayer2}
              player1Name={participants.find((p) => p.id === h2hPlayer1)?.name ?? ''}
              player2Name={participants.find((p) => p.id === h2hPlayer2)?.name ?? ''}
            />
          ) : (
            <p className="rounded-poke-lg border border-hairline bg-surface p-5 text-body text-fg-muted">{t('h2h.prompt')}</p>
          )}
        </div>
      )}

      {activeTab === 'streaks' && (
        <div className="rounded-poke-lg border border-hairline bg-surface px-5 py-2">
          {hasHistory && <p className="py-3 text-caption text-fg-muted">{h('streaksLiveOnly')}</p>}
          {streakEntries.length === 0 && <p className="py-3 text-body text-fg-muted">{t('streaks.empty')}</p>}
          {streakEntries.length > 0 && (
            <ol>
              {streakEntries.slice(0, 20).map((row, i) => (
                <li
                  key={row.player_id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-hairline py-2.5 last:border-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-6 font-mono text-caption tabular-nums text-fg-muted">{i + 1}</span>
                    <Link
                      href={`/players/${row.player_id}`}
                      className="flex min-w-0 items-center gap-2 text-fg hover:text-accent-text"
                    >
                      <PlayerAvatar avatarUrl={row.player_avatar_url} name={row.player_name} size={28} />
                      <span className="truncate font-heading text-body font-semibold">{row.player_name}</span>
                    </Link>
                  </div>
                  <span className="text-body tabular-nums text-fg-muted">
                    {t('streaks.winStreak', { current: row.current_win_streak, best: row.best_win_streak })}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {showStandings && activeTab !== 'ratings' && (
        <section className="space-y-3 pt-4">
          <h2 className="font-heading text-title text-fg">{t('standings')}</h2>
          <StandingsTable standings={standings} />
        </section>
      )}
    </div>
  );
}
