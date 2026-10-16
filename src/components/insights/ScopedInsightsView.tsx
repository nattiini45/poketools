'use client';

import { useState } from 'react';
import PokemonUsageTable, {
  DEFAULT_POKEMON_USAGE_LABELS,
  type PokemonUsageTableLabels,
} from '@/components/stats/PokemonUsageTable';
import KillRankingTable, {
  DEFAULT_KILL_RANKING_LABELS,
  type KillRankingTableLabels,
} from '@/components/stats/KillRankingTable';
import MoveUsageTable, { DEFAULT_MOVE_USAGE_LABELS, type MoveUsageTableLabels } from '@/components/stats/MoveUsageTable';
import HeadToHeadMatrix from '@/components/stats/HeadToHeadMatrix';
import type { KillRankingRow, PokemonUsageRow } from '@/types/game';
import { useT } from '@/i18n/client';
import { insightsMessages } from '@/i18n/messages/insights';

type SubTab = 'usage' | 'kills' | 'moves' | 'h2h';

/**
 * An override of the view's words: sub-tab names and the three tables'
 * labels. Without it the view renders in the viewer's language (tab names
 * from `insights`, the tables' own `stats` defaults); the league hub still
 * passes one (its BRIDGE in `league-hub/copy.ts`, removed by the sweep).
 */
export interface ScopedInsightsLabels {
  tabs: Record<SubTab, string>;
  usage: PokemonUsageTableLabels;
  kills: KillRankingTableLabels;
  moves: MoveUsageTableLabels;
}

/**
 * The English labels.
 * @deprecated Pass no `labels` to get the viewer's language; kept for callers that still pass it.
 */
export const DEFAULT_SCOPED_INSIGHTS_LABELS: ScopedInsightsLabels = {
  tabs: {
    usage: insightsMessages.en.tabs.usage,
    kills: insightsMessages.en.tabs.kills,
    moves: insightsMessages.en.tabs.moves,
    h2h: insightsMessages.en.tabs.h2h,
  },
  usage: DEFAULT_POKEMON_USAGE_LABELS,
  kills: DEFAULT_KILL_RANKING_LABELS,
  moves: DEFAULT_MOVE_USAGE_LABELS,
};

interface ScopedInsightsViewProps {
  usageRows: PokemonUsageRow[];
  isDoubles: boolean;
  killRanking: KillRankingRow[];
  /** Required for head-to-head; if absent the H2H tab is hidden. */
  tournamentId?: string | null;
  participants?: { id: string; name: string }[];
  /** Used by the lazy-loaded Move Usage table for its `/api/stats` fetch. */
  aggregateScopeType: 'tournament' | 'league' | 'all_time';
  aggregateScopeId: string | null;
  labels?: ScopedInsightsLabels;
}

/**
 * Renders the Pokémon-centric insights (usage / kills / moves / h2h) for a
 * tournament or league. Used both inside `/insights` and inline on the
 * tournament + league detail pages so the data tables are immediately visible
 * without leaving the page.
 */
export default function ScopedInsightsView({
  usageRows,
  isDoubles,
  killRanking,
  tournamentId,
  participants = [],
  aggregateScopeType,
  aggregateScopeId,
  labels,
}: ScopedInsightsViewProps) {
  const t = useT(insightsMessages);
  const tabLabels: Record<SubTab, string> = labels?.tabs ?? {
    usage: t('tabs.usage'),
    kills: t('tabs.kills'),
    moves: t('tabs.moves'),
    h2h: t('tabs.h2h'),
  };
  const showKills = killRanking.length > 0;
  const showH2h = !!tournamentId && participants.length > 0;

  const initialTab: SubTab = usageRows.length > 0 ? 'usage' : showKills ? 'kills' : 'moves';

  const tabs: { key: SubTab; label: string }[] = [
    { key: 'usage', label: tabLabels.usage },
    ...(showKills ? [{ key: 'kills' as const, label: tabLabels.kills }] : []),
    { key: 'moves', label: tabLabels.moves },
    ...(showH2h ? [{ key: 'h2h' as const, label: tabLabels.h2h }] : []),
  ];

  const [activeTab, setActiveTab] = useState<SubTab>(initialTab);
  const [h2hPlayer1, setH2hPlayer1] = useState('');
  const [h2hPlayer2, setH2hPlayer2] = useState('');

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-poke-border overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-heading font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? 'border-poke-accent text-poke-accent'
                : 'border-transparent text-poke-text-muted hover:text-poke-text-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'usage' && (
        <PokemonUsageTable data={usageRows} isDoubles={isDoubles} labels={labels?.usage} />
      )}

      {activeTab === 'kills' && showKills && <KillRankingTable data={killRanking} labels={labels?.kills} />}

      {activeTab === 'moves' && (
        <MoveUsageTable scopeType={aggregateScopeType} scopeId={aggregateScopeId} labels={labels?.moves} />
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
    </div>
  );
}
