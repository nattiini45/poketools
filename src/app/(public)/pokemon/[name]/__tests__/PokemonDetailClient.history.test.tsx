/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PokemonDetailClient from '../PokemonDetailClient';
import { withI18n } from '@/test/i18n';
import type { PokemonDetailStats, PokemonFilterOptions } from '@/types/game';
import type { HistoricalCompetitionOption } from '@/lib/pack-extensions/historical-statistics-types';

const initialStats: PokemonDetailStats = {
  pokemon_name: 'Pikachu', total_appearances: 2, total_games_in_scope: 4, usage_percent: 50, kos_dealt: 3,
  koed_rate: 50, bring_rate: null, lead_rate: null, win_rate: 50, moves: [], items: [], players: [],
};
const archived: PokemonDetailStats = {
  ...initialStats, total_appearances: null, usage_percent: null, kos_dealt: 11, koed_rate: null, win_rate: null,
  sourceCounts: { liveAppearances: 0, historicalAppearances: null, liveKos: 0, historicalKos: 11 },
  history: { state: 'ready', coverage: [] },
};
const archiveOptions: HistoricalCompetitionOption[] = [
  { id: 'star-cup', name: 'Star Cup', href: '/archive/star-cup', parentId: null, kind: 'cup', year: 2020, seasonLabel: null },
];
afterEach(() => vi.unstubAllGlobals());

describe('Pokémon archive picker', () => {
  it.each([
    ['en', 'Player', 'Scope', 'Selected player (no included observations)'],
    ['de', 'Spieler', 'Bereich', 'Ausgewählter Spieler (keine einbezogenen Beobachtungen)'],
  ] as const)('keeps an excluded player filter visible and clearable in %s without retaining its name', async (locale, playerLabel, scopeLabel, fallbackLabel) => {
    let includeHistory = true;
    const fetchMock = vi.fn(async (input: string) => ({ json: async () => input.endsWith('/filters')
      ? { success: true, data: { leagues: [], tournaments: [], players: includeHistory ? [{ id: 'star-trainer', name: 'Star Trainer' }] : [] } }
      : { success: true, data: initialStats } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const { rerender } = render(withI18n(<PokemonDetailClient pokemonName="Pikachu" initialStats={initialStats} archiveOptions={archiveOptions} />, { locale }));
    await screen.findByRole('option', { name: 'Star Trainer' });
    await user.selectOptions(screen.getByRole('combobox', { name: playerLabel }), 'star-trainer');
    await user.selectOptions(screen.getByRole('combobox', { name: scopeLabel }), 'archive');
    includeHistory = false;
    rerender(withI18n(<PokemonDetailClient pokemonName="Pikachu" initialStats={{ ...initialStats, history: { state: 'excluded', coverage: [] } }} archiveOptions={archiveOptions} />, { locale }));
    const fallback = await screen.findByRole('option', { name: fallbackLabel });
    expect(fallback).toHaveProperty('selected', true);
    expect(screen.getByRole('combobox', { name: playerLabel })).toHaveProperty('value', 'star-trainer');
    expect(screen.queryByRole('option', { name: 'Star Trainer' })).toBeNull();
    expect(screen.getByRole('combobox', { name: scopeLabel })).toHaveProperty('value', 'archive');
    await user.selectOptions(screen.getByRole('combobox', { name: playerLabel }), '');
    expect(screen.queryByRole('combobox', { name: playerLabel })).toBeNull();
    expect(screen.queryByRole('option', { name: fallbackLabel })).toBeNull();
    await waitFor(() => {
      const url = new URL(fetchMock.mock.calls.at(-1)?.[0] ?? '', 'https://example.test');
      expect(url.searchParams.get('scope')).toBe('archive');
      expect(url.searchParams.get('scope_id')).toBe('star-cup');
      expect(url.searchParams.has('player_id')).toBe(false);
    });
  });

  it('refreshes player names on server prop changes and ignores stale filter responses without resetting selection', async () => {
    type FilterResult = { success: boolean; data: PokemonFilterOptions };
    let finishOld: (value: FilterResult) => void = () => { throw new Error('No pending fixture request'); };
    const oldResult = new Promise<FilterResult>((resolve) => { finishOld = resolve; });
    const filterSignals: (AbortSignal | null | undefined)[] = [];
    const filters: PokemonFilterOptions = { leagues: [], tournaments: [], players: [{ id: 'star-trainer', name: 'Star Trainer' }] };
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      if (!input.endsWith('/filters')) return { json: async () => ({ success: true, data: input.includes('scope=archive') ? archived : initialStats }) };
      filterSignals.push(init?.signal);
      if (filterSignals.length === 2) return { json: () => oldResult };
      return { json: async () => ({ success: true, data: filterSignals.length === 1 ? filters : {
        ...filters, players: [{ id: 'star-trainer', name: 'Star Trainer Updated' }, { id: 'moon-trainer', name: 'Moon Trainer' }],
      } }) };
    }));
    const user = userEvent.setup();
    const { rerender } = render(withI18n(<PokemonDetailClient pokemonName="Pikachu" initialStats={initialStats} archiveOptions={archiveOptions} />));
    await screen.findByRole('option', { name: 'Star Trainer' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Player' }), 'star-trainer');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Scope' }), 'archive');
    await screen.findByText('Team appearances were not recorded.');
    rerender(withI18n(<PokemonDetailClient pokemonName="Pikachu" initialStats={{ ...initialStats, history: { state: 'excluded', coverage: [] } }} archiveOptions={archiveOptions} />));
    await waitFor(() => expect(filterSignals).toHaveLength(2));
    rerender(withI18n(<PokemonDetailClient pokemonName="Pikachu" initialStats={{ ...archived }} archiveOptions={archiveOptions} />));
    await screen.findByRole('option', { name: 'Moon Trainer' });
    expect(screen.getByRole('option', { name: 'Star Trainer Updated' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Player' })).toHaveProperty('value', 'star-trainer');
    expect(screen.getByRole('combobox', { name: 'Archive' })).toHaveProperty('value', 'star-cup');
    expect(filterSignals[1]?.aborted).toBe(true);
    await act(async () => finishOld({ success: true, data: { ...filters, players: [{ id: 'stale-trainer', name: 'Stale Trainer' }] } }));
    expect(screen.queryByRole('option', { name: 'Stale Trainer' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Moon Trainer' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Player' })).toHaveProperty('value', 'star-trainer');
    expect(screen.getByRole('combobox', { name: 'Archive' })).toHaveProperty('value', 'star-cup');
  });

  it('requests archive scope and displays unknown values instead of zero', async () => {
    const fetchMock = vi.fn(async (input: string) => ({ json: async () => input.endsWith('/filters')
      ? { success: true, data: { leagues: [], tournaments: [], players: [] } }
      : { success: true, data: input.includes('scope=archive') ? archived : initialStats } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const { rerender } = render(withI18n(<PokemonDetailClient pokemonName="Pikachu" initialStats={initialStats} archiveOptions={archiveOptions} />));
    await screen.findByText('2 appearances across 4 games');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Scope' }), 'archive');
    await screen.findByText('Team appearances were not recorded.');
    expect(screen.getByRole('combobox', { name: 'Archive' })).toHaveProperty('value', 'star-cup');
    expect(fetchMock.mock.calls.some(([url]) => url.includes('scope=archive&scope_id=star-cup'))).toBe(true);
    expect(screen.getByText('Move usage was not recorded for archived competitions.')).toBeTruthy();
    expect(screen.getByText('Live 0 · Historical 11', { exact: false })).toBeTruthy();
    const excluded: PokemonDetailStats = { ...archived, kos_dealt: null, history: { state: 'excluded', coverage: [] } };
    fetchMock.mockImplementation(async () => ({ json: async () => ({ success: true, data: excluded }) }));
    rerender(withI18n(<PokemonDetailClient pokemonName="Pikachu" initialStats={{ ...initialStats }} archiveOptions={archiveOptions} />));
    await screen.findByText('Live data only. Historical statistics are excluded.');
    expect(screen.getByRole('combobox', { name: 'Archive' })).toHaveProperty('value', 'star-cup');
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('scope=archive&scope_id=star-cup');
  });

  it('does not display stale live totals if the archived request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.includes('scope=archive')) throw new Error('Fixture request failed');
      return { json: async () => input.endsWith('/filters') ? { success: true, data: { leagues: [], tournaments: [], players: [] } } : { success: true, data: initialStats } };
    }));
    const user = userEvent.setup();
    render(withI18n(<PokemonDetailClient pokemonName="Pikachu" initialStats={initialStats} archiveOptions={archiveOptions} />));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    await user.selectOptions(screen.getByRole('combobox', { name: 'Scope' }), 'archive');
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Statistics could not be loaded. Please try selecting the scope again.');
    expect(screen.queryByText('2 appearances across 4 games')).toBeNull();
  });

  it.each(['global', 'player', 'refresh'] as const)('hides old totals when a %s request fails', async (scenario) => {
    let fail = false;
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.endsWith('/filters')) return { json: async () => ({ success: true, data: { leagues: [], tournaments: [], players: [{ id: 'star-trainer', name: 'Star Trainer' }] } }) };
      if (fail) throw new Error('Fixture request failed');
      return { json: async () => ({ success: true, data: input.includes('scope=archive') ? archived : initialStats }) };
    }));
    const user = userEvent.setup();
    const { rerender } = render(withI18n(<PokemonDetailClient pokemonName="Pikachu" initialStats={initialStats} archiveOptions={archiveOptions} />));
    await screen.findByText('2 appearances across 4 games');
    if (scenario === 'global') {
      await user.selectOptions(screen.getByRole('combobox', { name: 'Scope' }), 'archive');
      await screen.findByText('Team appearances were not recorded.');
    }
    fail = true;
    if (scenario === 'global') await user.selectOptions(screen.getByRole('combobox', { name: 'Scope' }), 'all_time');
    else if (scenario === 'player') await user.selectOptions(screen.getByRole('combobox', { name: 'Player' }), 'star-trainer');
    else rerender(withI18n(<PokemonDetailClient pokemonName="Pikachu" initialStats={{ ...initialStats, history: { state: 'excluded', coverage: [] } }} archiveOptions={archiveOptions} />));
    await screen.findByRole('alert');
    expect(screen.queryByText('2 appearances across 4 games')).toBeNull();
    expect(screen.queryByText('Team appearances were not recorded.')).toBeNull();
    expect(screen.queryByText('Live 0 · Historical 11', { exact: false })).toBeNull();
  });
});
