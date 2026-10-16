import ScopedInsightsView, { type ScopedInsightsLabels } from '@/components/insights/ScopedInsightsView';
import type { LeagueHubCopy } from '@/lib/league-hub/copy';
import type { KillRankingRow, PokemonUsageRow } from '@/types/game';
import { HubLink } from './HubBits';

interface HubInsightsPanelProps {
  leagueId: string;
  usageRows: PokemonUsageRow[];
  killRanking: KillRankingRow[];
  isDoubles: boolean;
  copy: LeagueHubCopy;
  /** The insights tables' words in another language; absent keeps their English. */
  labels?: ScopedInsightsLabels;
}

/**
 * Insights: the league-scoped Pokémon usage, kill ranking and move usage
 * (the same view the phase pages and /insights render), plus the way into
 * the full insights hub (ratings, streaks).
 */
export default function HubInsightsPanel({
  leagueId,
  usageRows,
  killRanking,
  isDoubles,
  copy,
  labels,
}: HubInsightsPanelProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-arena-ink-secondary">
        <p>{copy.insightsNote}</p>
        <HubLink href={`/insights?scope=league&id=${leagueId}&tab=usage`}>
          {copy.links.insights}
          <span aria-hidden="true"> →</span>
        </HubLink>
      </div>
      <ScopedInsightsView
        usageRows={usageRows}
        isDoubles={isDoubles}
        killRanking={killRanking}
        aggregateScopeType="league"
        aggregateScopeId={leagueId}
        labels={labels}
      />
    </div>
  );
}
