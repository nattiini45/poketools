import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PokemonUsageTable from '../PokemonUsageTable';
import HistoricalStatisticsCoverage from '../HistoricalStatisticsCoverage';
import { renderWithI18n } from '@/test/i18n';
import type { CombinedPokemonUsageRow, HistoricalStatisticsView } from '@/lib/stats/combined-statistics';
import type { HistoricalStatisticsCoverage as Coverage } from '@/lib/pack-extensions/historical-statistics-types';

const unknown: CombinedPokemonUsageRow = {
  pokemon_name: 'Pikachu', usage_percent: null, total_appearances: null, total_games: null,
  efficiency: null, kos_dealt: null, koed_rate: null, bring_rate: null, lead_rate: null, win_rate: null,
};
const coverage: Coverage = {
  competition: { id: 'sky-cup', name: 'Sky Cup', href: '/archive/sky-cup', parentId: null, kind: 'cup', year: 2020, seasonLabel: null },
  sourceResults: 12, candidateBattles: 10, includedBattles: 7, excludedBattles: 2, withheldBattles: 1,
  unmatchedTeamRows: 3, missingPeriods: ['Final week'],
  periods: [{ period: 'Opening week', sourceResults: 12, includedBattles: 7, excludedBattles: 2, withheldBattles: 1, reasons: {} }],
  metrics: { usage: 'disjoint', kills: 'disjoint', records: 'unresolved', honors: 'unresolved' },
};

describe('combined usage presentation', () => {
  it('sorts recorded usage including zero ahead of KO-only species without inventing their rank', () => {
    const html = renderToStaticMarkup(<PokemonUsageTable data={[
      { ...unknown, pokemon_name: 'Gengar', kos_dealt: 11 },
      { ...unknown, pokemon_name: 'Garchomp', usage_percent: 0, total_appearances: 0 },
      { ...unknown, pokemon_name: 'Pikachu', usage_percent: 66.7, total_appearances: 10 },
    ]} />);
    const body = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
    expect(body.indexOf('Pikachu')).toBeGreaterThanOrEqual(0);
    expect(body.indexOf('Pikachu')).toBeLessThan(body.indexOf('Garchomp'));
    expect(body.indexOf('Garchomp')).toBeLessThan(body.indexOf('Gengar'));
    const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((match) => match[1]);
    const ranks = rows.map((row) => row.match(/<td[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? '');
    expect(ranks[0]).toContain('>1</span>');
    expect(ranks[1]).toContain('>2</span>');
    expect(ranks[2]).toContain('aria-label="Not recorded">—</span>');
  });

  it('distinguishes unknown values from recorded zeroes', () => {
    const html = renderToStaticMarkup(<PokemonUsageTable data={[unknown]} isDoubles />);
    expect(html).toContain('aria-label="Not recorded"');
    expect(html).not.toContain('0.0%');
    const zero = renderToStaticMarkup(<PokemonUsageTable data={[{ ...unknown, usage_percent: 0, kos_dealt: 0, total_appearances: 0 }]} />);
    expect(zero).toContain('0.0%');
    expect(zero).toContain('>0</');
  });

  it('shows count provenance without manufacturing live-only rates', () => {
    const row = { ...unknown, kos_dealt: 9, total_appearances: 4, sourceCounts: { liveAppearances: 1, historicalAppearances: 3, liveKos: 2, historicalKos: 7 } };
    const html = renderToStaticMarkup(<PokemonUsageTable data={[row]} isDoubles />);
    expect(html).toContain('Live 1 · Historical 3');
    expect(html).toContain('Live 2 · Historical 7');
    expect(html).not.toContain('0.0%');
    expect(renderWithI18n(<PokemonUsageTable data={[row]} />, { locale: 'de' })).toContain('Live 2 · Historisch 7');
  });

  it('keeps live-only rows free of historical provenance', () => {
    expect(renderToStaticMarkup(<PokemonUsageTable data={[{ ...unknown, sourceCounts: undefined }]} />)).not.toContain('Historical');
  });
});

describe('historical coverage presentation', () => {
  it.each(['recorded', 'missing'] as const)('localizes known %s period IDs in English and German but preserves authored labels', (kind) => {
    const ids = ['first_half', 'second_half', 'ko', 'playoff', 'single', 'Opening week'];
    const history: HistoricalStatisticsView = {
      state: 'ready', coverage: [{
        ...coverage,
        periods: kind === 'recorded' ? ids.map((period) => ({ period, sourceResults: 1, includedBattles: 1, excludedBattles: 0, withheldBattles: 0, reasons: {} })) : [],
        missingPeriods: kind === 'missing' ? ids : [],
      }],
    };
    const en = renderWithI18n(<HistoricalStatisticsCoverage history={history} />, { locale: 'en' });
    const de = renderWithI18n(<HistoricalStatisticsCoverage history={history} />, { locale: 'de' });
    for (const label of ['First half', 'Second half', 'Knockout stage', 'Playoffs', 'Single period', 'Opening week']) expect(en).toContain(`>${label}</th>`);
    for (const label of ['Erste Hälfte', 'Zweite Hälfte', 'K.-o.-Phase', 'Playoffs', 'Einzelner Zeitraum', 'Opening week']) expect(de).toContain(`>${label}</th>`);
    for (const id of ids.slice(0, -1)) {
      expect(en).not.toContain(`>${id}</th>`);
      expect(de).not.toContain(`>${id}</th>`);
    }
  });

  it('renders nothing when the extension is absent', () => {
    expect(renderToStaticMarkup(<HistoricalStatisticsCoverage history={{ state: 'absent', coverage: [] }} />)).toBe('');
  });

  it.each([
    ['excluded', 'Historical statistics are excluded.'],
    ['not_ready', 'Historical data has not been activated.'],
    ['failed', 'Historical statistics could not be loaded.'],
  ] as const)('keeps %s distinct from ready', (state, message) => {
    const html = renderToStaticMarkup(<HistoricalStatisticsCoverage history={{ state, coverage: [] }} />);
    expect(html).toContain(message);
    expect(html).not.toContain('paired, observed battles');
  });

  it('shows competition and period counts alongside explicit missing coverage', () => {
    const history: HistoricalStatisticsView = { state: 'ready', coverage: [coverage] };
    const html = renderToStaticMarkup(<HistoricalStatisticsCoverage history={history} />);
    for (const text of ['Sky Cup', 'Opening week', 'Final week', 'Missing', 'Not recorded', 'Unmatched team records: 3', 'Known result rows: 12', 'Included: 7', 'Excluded: 2', 'Withheld: 1', 'not a count of all historical battles', 'live-only or unknown']) expect(html).toContain(text);
    expect(html).toContain('scope="row"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/<div id="[^"]+" hidden="">/);
    expect(html).toMatch(/Opening week[\s\S]*?>12<[^]*?>7<[^]*?>2<[^]*?>1</);
    const de = renderWithI18n(<HistoricalStatisticsCoverage history={history} />, { locale: 'de' });
    expect(de).toContain('Historische Abdeckung');
    expect(de).toContain('Nicht zugeordnete Teamdatensätze: 3');
  });
});
