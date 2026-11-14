export interface HistoricalCompetitionOption {
  id: string;
  name: string;
  href: string;
  parentId: string | null;
  kind: 'league' | 'playoff' | 'tournament' | 'cup';
  year: number | null;
  seasonLabel: string | null;
  liveScopeIds?: readonly string[];
}

export interface HistoricalStatisticsRequest {
  scopeType: 'all_time' | 'league' | 'tournament' | 'archive';
  scopeId: string | null;
  playerId?: string;
}

export interface HistoricalPokemonCounter {
  pokemonName: string;
  appearances: number | null;
  wins: number | null;
  kos: number | null;
}

export interface HistoricalStatisticsCoverage {
  competition: HistoricalCompetitionOption;
  sourceResults: number;
  candidateBattles: number;
  includedBattles: number;
  excludedBattles: number;
  withheldBattles: number;
  unmatchedTeamRows: number;
  missingPeriods: readonly string[];
  periods: readonly {
    period: string;
    sourceResults: number;
    includedBattles: number;
    excludedBattles: number;
    withheldBattles: number;
    reasons: Readonly<Record<string, number>>;
  }[];
  metrics: Readonly<Record<'usage' | 'kills' | 'records' | 'honors', 'disjoint' | 'duplicate' | 'unresolved'>>;
}

export interface HistoricalUsageContribution {
  battleCount: number;
  pokemon: readonly HistoricalPokemonCounter[];
  coverage: readonly HistoricalStatisticsCoverage[];
  players?: readonly { playerId: string; pokemon: readonly HistoricalPokemonCounter[] }[];
}

export interface HistoricalHonor {
  eventKey: string;
  kind: 'champion' | 'runner_up' | 'top_killer';
  playerIds: readonly string[];
  shared: boolean;
  liveScopeIds: readonly string[];
  preferLive: boolean;
  competition: HistoricalCompetitionOption;
  pokemonName: string | null;
  count: number | null;
}

export interface HistoricalProfileContribution {
  record: { played: number; wins: number; draws: number; losses: number } | null;
  pokemon: readonly HistoricalPokemonCounter[];
  honors: readonly HistoricalHonor[];
  participations: readonly HistoricalCompetitionOption[];
  coverage: readonly HistoricalStatisticsCoverage[];
}

export type HistoricalStatisticsResult<T> =
  | { state: 'not_ready' }
  | { state: 'ready'; data: T | null };
