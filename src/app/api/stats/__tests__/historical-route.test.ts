import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Aggregate } from '@/types/game';
import type { HistoricalUsageContribution } from '@/lib/pack-extensions/historical-statistics-types';

const mocks = vi.hoisted(() => ({
  aggregates: vi.fn(), count: vi.fn(), pokemon: vi.fn(), players: vi.fn(), historical: vi.fn(),
  supplement: vi.fn(), hidden: vi.fn(), names: vi.fn(), items: vi.fn(),
  scopes: vi.fn(), playerIds: vi.fn(), playerRows: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/aggregates', () => ({
  getAggregates: mocks.aggregates, getTotalGamesInScope: mocks.count,
  getAggregateForPokemon: mocks.pokemon, getPlayerAggregatesForPokemon: mocks.players,
  getAggregateScopesForPokemon: mocks.scopes, getPlayerIdsForPokemon: mocks.playerIds,
}));
vi.mock('@/lib/pack-extensions', () => ({
  packExtensions: { historicalUsage: mocks.historical }, loadSupplement: mocks.supplement,
}));
vi.mock('@/lib/cache/public-reads', () => ({ publicReads: { hiddenPlayerIds: mocks.hidden, itemUsage: mocks.items } }));
vi.mock('@/lib/supabase/queries/players', () => ({ resolvePlayerNames: mocks.names, getPlayersByIds: mocks.playerRows }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ listSeasonsByIds: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ listTournamentsByIds: vi.fn() }));
vi.mock('@/lib/supabase/queries/teams', () => ({ getItemUsageForPokemon: mocks.items }));
vi.mock('@/lib/pkmn/dex', () => ({ getSpeciesNatDex: () => ({ entity: { name: 'Pikachu' } }), getMoveNatDex: () => null }));

import { GET } from '../route';
import { GET as pokemonGET } from '@/app/api/pokemon/[name]/stats/route';
import { GET as filtersGET } from '@/app/api/pokemon/[name]/filters/route';

const live: Aggregate = {
  id: 'row', scope_type: 'all_time', scope_id: null, pokemon_name: 'Pikachu',
  total_appearances: 4, total_games: 6, total_brought: 2, total_led: 1,
  total_kos_dealt: 3, total_koed: 1, total_wins: 2, move_counts: { Thunderbolt: 2 }, last_updated: '',
};
const earlier: HistoricalUsageContribution = {
  battleCount: 5, coverage: [],
  pokemon: [{ pokemonName: 'Pikachu', appearances: 3, wins: 2, kos: 9 }],
};
const request = (query: string) => new NextRequest(`http://localhost/api/stats?${query}`);
const speciesParams = { params: Promise.resolve({ name: 'Pikachu' }) };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.aggregates.mockResolvedValue([live]);
  mocks.pokemon.mockResolvedValue(live);
  mocks.count.mockResolvedValue(10);
  mocks.players.mockResolvedValue([]);
  mocks.hidden.mockResolvedValue([]);
  mocks.names.mockResolvedValue({});
  mocks.items.mockResolvedValue([]);
  mocks.scopes.mockResolvedValue([]);
  mocks.playerIds.mockResolvedValue([]);
  mocks.playerRows.mockResolvedValue(new Map());
  mocks.historical.mockResolvedValue({ state: 'ready', data: earlier });
  mocks.supplement.mockImplementation(async (_name, provider) => ({ state: 'ready', value: await provider({ viewerPlayerId: null }) }));
});

describe('optional historical statistics API composition', () => {
  it('combines real usage before returning it and prevents shared CDN caching', async () => {
    const response = await GET(request('scope=all_time'));
    const body = await response.json();
    expect(body.data[0]).toMatchObject({ total_appearances: 7, total_games: 9, kos_dealt: 12 });
    expect(body.data[0].usage_percent).toBeCloseTo(7 / 15 * 100);
    expect(body.history.state).toBe('ready');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('keeps Off totals live-only without invoking the historical provider', async () => {
    mocks.supplement.mockResolvedValue({ state: 'excluded' });
    const response = await GET(request('scope=all_time'));
    const body = await response.json();
    expect(body.data[0]).toMatchObject({ total_appearances: 4, total_games: 6, kos_dealt: 3, usage_percent: 40 });
    expect(body.history.state).toBe('excluded');
    expect(mocks.historical).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('serves archive usage without querying any live scope', async () => {
    const response = await GET(request('scope=archive&scope_id=fictional-cup'));
    const body = await response.json();
    expect(body.data[0]).toMatchObject({ total_appearances: 3, usage_percent: 60, kos_dealt: 9, koed_rate: null });
    expect(mocks.aggregates).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.historical).toHaveBeenCalledWith({ scopeType: 'archive', scopeId: 'fictional-cup' }, { viewerPlayerId: null });
  });

  it('distinguishes not activated and failed history from a successful empty contribution', async () => {
    mocks.historical.mockResolvedValue({ state: 'not_ready' });
    const pending = await GET(request('scope=all_time'));
    expect((await pending.json()).history.state).toBe('not_ready');
    mocks.supplement.mockResolvedValue({ state: 'failed' });
    const failed = await GET(request('scope=all_time'));
    expect((await failed.json()).history.state).toBe('failed');
  });

  it('preserves raw live aggregates and exposes historical inputs separately without inventing deaths or moves', async () => {
    const raw = await GET(request('scope=all_time&view=raw'));
    const rawBody = await raw.json();
    expect(rawBody.data).toEqual([live]);
    expect(rawBody.historical).toEqual(earlier);
    const moves = await GET(request('scope=all_time&view=moves'));
    const movesBody = await moves.json();
    expect(movesBody.metricCoverage).toBe('live_only');
    expect(movesBody.data.rows).toEqual([expect.objectContaining({ move_name: 'Thunderbolt', count: 2 })]);
  });

  it('uses the same combined counters and live-only move denominator on the species API', async () => {
    const response = await pokemonGET(request('scope=all_time'), speciesParams);
    const body = await response.json();
    expect(body.data).toMatchObject({ total_appearances: 7, total_games_in_scope: 15, kos_dealt: 12, koed_rate: 25 });
    expect(body.data.moves).toEqual([{ name: 'Thunderbolt', count: 2, usage_percent: 50 }]);
    expect(body.data.history.state).toBe('ready');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('includes historical-only visible individuals, without crediting shared or hidden rows', async () => {
    mocks.pokemon.mockResolvedValue(null);
    mocks.historical.mockResolvedValue({ state: 'ready', data: {
      ...earlier, players: [
        { playerId: 'fictional-visible', pokemon: earlier.pokemon },
        { playerId: 'fictional-hidden', pokemon: earlier.pokemon },
        { playerId: 'fictional-absent', pokemon: [{ pokemonName: 'Pikachu', appearances: 0, wins: 0, kos: null }] },
      ],
    } });
    mocks.hidden.mockResolvedValue(['fictional-hidden']);
    mocks.names.mockResolvedValue({ 'fictional-visible': 'Trainer Comet' });
    const response = await pokemonGET(request('scope=all_time'), speciesParams);
    const body = await response.json();
    expect(body.data.players).toEqual([expect.objectContaining({
      player_id: 'fictional-visible', player_name: 'Trainer Comet', games: 3, kos_dealt: 9, koed_rate: null,
    })]);
    expect(mocks.names).toHaveBeenCalledWith(['fictional-visible']);
  });

  it('validates archive slugs without weakening live UUID validation', async () => {
    for (const query of ['scope=archive&scope_id=../private', 'scope=league&scope_id=fictional-cup']) {
      expect((await GET(request(query))).status).toBe(400);
      expect((await pokemonGET(request(query), speciesParams)).status).toBe(400);
    }
    expect(mocks.historical).not.toHaveBeenCalled();
    expect(mocks.aggregates).not.toHaveBeenCalled();
  });

  it('offers historical-only players with relevant known counters, not zero-only or unrelated species', async () => {
    mocks.historical.mockResolvedValue({ state: 'ready', data: { ...earlier, players: [
      { playerId: 'trainer-comet', pokemon: earlier.pokemon },
      { playerId: 'trainer-orbit', pokemon: [{ pokemonName: 'Pikachu', appearances: 0, wins: 0, kos: null }] },
      { playerId: 'trainer-lunar', pokemon: [{ pokemonName: 'Eevee', appearances: 3, wins: 2, kos: 1 }] },
    ] } });
    mocks.playerRows.mockResolvedValue(new Map([['trainer-comet', { id: 'trainer-comet', name: 'Trainer Comet' }]]));
    const response = await filtersGET(request(''), speciesParams);
    expect(mocks.playerRows).toHaveBeenCalledWith(['trainer-comet']);
    expect((await response.json()).data.players).toEqual([{ id: 'trainer-comet', name: 'Trainer Comet' }]);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
