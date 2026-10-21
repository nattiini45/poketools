'use client';

import { useState } from 'react';
import Link from 'next/link';
import PokemonUsageTable from '@/components/stats/PokemonUsageTable';
import MoveUsageTable from '@/components/stats/MoveUsageTable';
import HeadToHeadMatrix from '@/components/stats/HeadToHeadMatrix';
import KillRankingTable from '@/components/stats/KillRankingTable';
import StandingsTable from '@/components/stats/StandingsTable';
import SupplementaryKillRanking, {
  type SupplementaryKillRowView,
} from '@/components/supplementary/SupplementaryKillRanking';
import LeaderboardContent from '@/app/(public)/leaderboard/LeaderboardContent';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import type { InsightsScope, InsightsTab } from '@/lib/insights/scope';
import type { PokemonUsageRow, KillRankingRow, StandingsRow } from '@/types/game';
import type { RatingLeaderboardEntry } from '@/types/rating';
import type { StreakLeaderboardEntry } from '@/types/insights';
import { useT } from '@/i18n/client';
import { insightsMessages } from '@/i18n/messages/insights';

interface InsightsTabsProps {
  initialTab: InsightsTab;
  scope: InsightsScope;
  title: string;
  usageRows: PokemonUsageRow[];
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
  initialTab,
  scope,
  title,
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
}: InsightsTabsProps) {
  const t = useT(insightsMessages);
  const [activeTab, setActiveTab] = useState<InsightsTab>(initialTab);

  const showSupplementaryKills =
    scope.type === 'global' &&
    supplementaryKills !== undefined &&
    (supplementaryKills.state === 'failed' || supplementaryKills.rows.length > 0);
  const showKills = (scope.type !== 'global' && killRanking.length > 0) || showSupplementaryKills;
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

  const [h2hPlayer1, setH2hPlayer1] = useState('');
  const [h2hPlayer2, setH2hPlayer2] = useState('');

  const handleTabClick = (tab: InsightsTab) => {
    setActiveTab(tab);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold text-poke-text-primary">{title}</h1>
        <p className="text-sm text-poke-text-secondary mt-1">{t('page.subtitle')}</p>
      </div>

      <div className="flex gap-1 border-b border-poke-border overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => handleTabClick(tab)}
            className={`px-4 py-2 text-sm font-heading font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab
                ? 'border-poke-accent text-poke-accent'
                : 'border-transparent text-poke-text-muted hover:text-poke-text-secondary'
            }`}
          >
            {t(`tabs.${tab}`)}
          </button>
        ))}
      </div>

      {activeTab === 'ratings' && (
        <div className="space-y-2">
          {scope.type !== 'global' && (
            <p className="text-xs text-poke-text-muted">{t('ratingsGlobalNote')}</p>
          )}
          <LeaderboardContent initialRows={ratingRows} />
        </div>
      )}

      {activeTab === 'usage' && (
        <PokemonUsageTable data={usageRows} isDoubles={isDoubles} />
      )}

      {activeTab === 'kills' && showKills && !showSupplementaryKills && (
        <KillRankingTable data={killRanking} />
      )}

      {activeTab === 'kills' && showSupplementaryKills && supplementaryKills && (
        <SupplementaryKillRanking
          rows={supplementaryKills.state === 'ready' ? supplementaryKills.rows : []}
          failed={supplementaryKills.state === 'failed'}
        />
      )}

      {activeTab === 'moves' && (
        <MoveUsageTable
          scopeType={aggregateScopeType}
          scopeId={aggregateScopeId ?? ''}
        />
      )}

      {activeTab === 'h2h' && showH2h && tournamentId && (
        <div className="space-y-4">
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <label className="block text-xs text-poke-text-secondary mb-1">{t('h2h.player1')}</label>
              <select
                value={h2hPlayer1}
                onChange={(e) => setH2hPlayer1(e.target.value)}
                className="px-2 py-1 border border-poke-border rounded-poke-sm text-sm bg-poke-surface text-poke-text-primary"
              >
                <option value="">{t('h2h.selectPlayer')}</option>
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <span className="text-poke-text-muted text-sm pb-1">{t('h2h.versus')}</span>
            <div>
              <label className="block text-xs text-poke-text-secondary mb-1">{t('h2h.player2')}</label>
              <select
                value={h2hPlayer2}
                onChange={(e) => setH2hPlayer2(e.target.value)}
                className="px-2 py-1 border border-poke-border rounded-poke-sm text-sm bg-poke-surface text-poke-text-primary"
              >
                <option value="">{t('h2h.selectPlayer')}</option>
                {participants
                  .filter((p) => p.id !== h2hPlayer1)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
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
            <p className="text-sm text-poke-text-muted py-8 text-center">{t('h2h.prompt')}</p>
          )}
        </div>
      )}

      {activeTab === 'streaks' && (
        <div className="bg-poke-surface border border-poke-border rounded-poke-xl p-4 shadow-poke">
          {streakEntries.length === 0 && (
            <p className="text-sm text-poke-text-muted">{t('streaks.empty')}</p>
          )}
          {streakEntries.length > 0 && (
            <ul className="space-y-2">
              {streakEntries.slice(0, 20).map((row, i) => (
                <li
                  key={row.player_id}
                  className="flex items-center justify-between gap-3 py-2 border-b border-poke-border last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono text-poke-text-muted w-6">{i + 1}</span>
                    <Link
                      href={`/players/${row.player_id}`}
                      className="flex items-center gap-2 hover:text-poke-accent"
                    >
                      <PlayerAvatar
                        avatarUrl={row.player_avatar_url}
                        name={row.player_name}
                        size={28}
                      />
                      <span className="font-heading font-semibold text-sm">{row.player_name}</span>
                    </Link>
                  </div>
                  <span className="text-sm text-poke-text-secondary">
                    {t('streaks.winStreak', { current: row.current_win_streak, best: row.best_win_streak })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showStandings && activeTab !== 'ratings' && (
        <div className="mt-8">
          <h2 className="text-lg font-heading font-semibold text-poke-text-primary mb-3">
            {t('standings')}
          </h2>
          <StandingsTable standings={standings} />
        </div>
      )}
    </div>
  );
}
