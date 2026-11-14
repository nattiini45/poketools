import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import InsightsTabs from '../InsightsTabs';
import type { CombinedPokemonUsageRow, HistoricalStatisticsView } from '@/lib/stats/combined-statistics';

vi.mock('@/components/stats/MoveUsageTable', () => ({ default: () => <p>Live move explorer</p> }));

const history: HistoricalStatisticsView = {
  state: 'ready', coverage: [{
    competition: { id: 'cloud-cup', name: 'Cloud Cup', href: '/archive/cloud-cup', parentId: null, kind: 'cup', year: 2020, seasonLabel: null },
    sourceResults: 5, candidateBattles: 5, includedBattles: 4, excludedBattles: 0, withheldBattles: 1, unmatchedTeamRows: 2,
    missingPeriods: ['Final'], periods: [], metrics: { usage: 'disjoint', kills: 'disjoint', records: 'disjoint', honors: 'disjoint' },
  }],
};
const row: CombinedPokemonUsageRow = {
  pokemon_name: 'Pikachu', usage_percent: null, total_appearances: null, total_games: null,
  kos_dealt: 17, koed_rate: null, efficiency: null, bring_rate: null, lead_rate: null, win_rate: null,
  sourceCounts: { liveAppearances: 0, historicalAppearances: null, liveKos: 5, historicalKos: 12 },
};
const props: Parameters<typeof InsightsTabs>[0] = {
  activeTab: 'kills', scope: { type: 'global' }, history, usageRows: [row], isDoubles: false,
  standings: [], killRanking: [], participants: [], tournamentId: null,
  aggregateScopeType: 'all_time', aggregateScopeId: null, ratingRows: [], streakEntries: [],
};

describe('historical Insights integration', () => {
  it('renders combined KO totals rather than the earlier-only ranking', () => {
    const html = renderWithI18n(<InsightsTabs {...props} supplementaryKills={{ state: 'ready', rows: [{ pokemonName: 'Garchomp', kos: 999 }] }} />);
    expect(html).toContain('>17<');
    expect(html).toContain('Live 5 · Historical 12');
    expect(html).toContain('Cloud Cup');
    expect(html).not.toContain('Earlier records');
    expect(html).not.toContain('Garchomp');
    expect(html).not.toContain('Eff');
  });

  it('preserves the legacy supplementary ranking when the historical provider is absent', () => {
    const html = renderWithI18n(<InsightsTabs {...props} history={{ state: 'absent', coverage: [] }} supplementaryKills={{ state: 'ready', rows: [{ pokemonName: 'Garchomp', kos: 12 }] }} />);
    expect(html).toContain('Earlier records');
    expect(html).toContain('Garchomp');
    expect(html).not.toContain('Pikachu');
  });

  it('keeps combined live-only mode when a present provider is excluded', () => {
    const html = renderWithI18n(<InsightsTabs {...props} history={{ state: 'excluded', coverage: [] }} usageRows={[{ ...row, kos_dealt: 5, sourceCounts: undefined }]} supplementaryKills={{ state: 'ready', rows: [{ pokemonName: 'Garchomp', kos: 12 }] }} />);
    expect(html).toContain('Pikachu');
    expect(html).toContain('>5<');
    expect(html).not.toContain('Earlier records');
    expect(html).not.toContain('Garchomp');
  });

  it('keeps empty archive kills selected and distinct from usage', () => {
    const html = renderWithI18n(<InsightsTabs {...props} scope={{ type: 'archive', id: 'cloud-cup' }} usageRows={[]} />);
    expect(html).toMatch(/<a(?=[^>]*tab=kills")(?=[^>]*aria-current="page")[^>]*>/);
    expect(html).toContain('No recorded KO totals for this scope.');
    expect(html).not.toContain('No usage data');
  });

  it('ranks only strictly positive known KOs, not zero meta fallback or unknown rows', () => {
    const html = renderWithI18n(<InsightsTabs {...props} usageRows={[
      row,
      { ...row, pokemon_name: 'Garchomp', kos_dealt: 0 },
      { ...row, pokemon_name: 'Snorlax', kos_dealt: null },
    ]} />);
    expect(html).toContain('Pikachu');
    expect(html).not.toContain('Garchomp');
    expect(html).not.toContain('Snorlax');
  });

  it('does not mount the live moves explorer for an archive', () => {
    const html = renderWithI18n(<InsightsTabs {...props} activeTab="moves" scope={{ type: 'archive', id: 'cloud-cup' }} />);
    expect(html).toContain('Move usage was not recorded for archived competitions.');
    expect(html).not.toContain('Live move explorer');
  });

  it.each([
    ['ratings', 'Ratings use live matches only'],
    ['streaks', 'Streaks use live matches only'],
    ['moves', 'Move usage uses live battle data only'],
  ] as const)('labels %s as live-only', (activeTab, label) => {
    expect(renderWithI18n(<InsightsTabs {...props} activeTab={activeTab} />)).toContain(label);
  });

  it('keeps the scoped live kill ranking separate', () => {
    const html = renderWithI18n(<InsightsTabs {...props} scope={{ type: 'league', id: 'league-one' }} killRanking={[{
      pokemon_name: 'Garchomp', kos_dealt: 3, times_koed: 1, kill_differential: 2, times_in_team: 2, participations: 2, efficiency: 1.5,
    }]} />);
    expect(html).toContain('Garchomp');
    expect(html).not.toContain('Live 5 · Historical 12');
  });

  it('translates unsupported archive metrics into German', () => {
    const html = renderWithI18n(<InsightsTabs {...props} activeTab="moves" scope={{ type: 'archive', id: 'cloud-cup' }} />, { locale: 'de' });
    expect(html).toContain('Für archivierte Wettbewerbe wurde keine Attacken-Nutzung erfasst.');
  });
});
