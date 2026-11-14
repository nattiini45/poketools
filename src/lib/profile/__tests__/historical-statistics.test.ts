import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachedPlayerProfile, ProfilePokemonCounter } from '@/types/profile';
import type { HistoricalCompetitionOption, HistoricalHonor, HistoricalProfileContribution } from '@/lib/pack-extensions/historical-statistics-types';

vi.mock('@/lib/pack-extensions', () => ({ loadSupplement: vi.fn(), packExtensions: { historicalProfile: vi.fn() } }));

import { combineHistoricalProfile, readHistoricalProfile } from '../historical-statistics';
import { toPublicPlayerProfile, toPublicProfileView } from '../redact';
import { loadSupplement, packExtensions } from '@/lib/pack-extensions';

const competition: HistoricalCompetitionOption = {
  id: 'archive-cup', name: 'Fable Cup', href: '/archive/fable-cup', parentId: null,
  kind: 'cup', year: 2021, seasonLabel: 'Winter',
};
const counter = (pokemon_name: string, total_games: number, total_kos_dealt = 1): ProfilePokemonCounter => ({
  pokemon_name, total_games, total_kos_dealt, total_wins: total_games, total_koed: 1,
});
function profile(): CachedPlayerProfile {
  return {
    player: { id: 'trainer-orbit', name: 'Trainer Orbit', avatar_url: null, ps_username: 'orbit_ps', champions_username: 'orbit_champs', joined_date: '2025-01-01', is_creator: false, is_guest: false },
    headline: { total_matches: 4, total_wins: 3, total_losses: 1, win_rate: 75, total_kos_dealt: 7, unique_pokemon_used: 4, tournaments_entered: 1, tournaments_won: 1 },
    current_participations: [],
    past_participations: [{ id: 'live-cup', name: 'Fable Stage', type: 'tournament', status: 'completed', bracket_type: null, standing: { rank: 1, total: 8, wins: 3, losses: 1 }, best_pokemon: null }],
    upcoming_matches: [], recent_matches: [], most_used_pokemon: [], best_kill_pokemon: [], recent_form: ['W'],
    trophies: [{ id: 'live-cup', name: 'Fable Stage', rank: 1 }], rating: null, streaks: null, signatures: [], achievements: [],
    live_pokemon_counters: [counter('Pikachu', 10), counter('Eevee', 9), counter('Ditto', 8), counter('Mew', 7, 4)],
  };
}
function contribution(overrides: Partial<HistoricalProfileContribution> = {}): HistoricalProfileContribution {
  return {
    record: { played: 4, wins: 2, draws: 1, losses: 1 },
    pokemon: [{ pokemonName: 'Mew', appearances: 10, wins: 5, kos: 20 }],
    honors: [], participations: [competition], coverage: [], ...overrides,
  };
}
function honor(overrides: Partial<HistoricalHonor> = {}): HistoricalHonor {
  return { eventKey: 'fable-event', kind: 'champion', playerIds: ['trainer-orbit'], shared: false, liveScopeIds: ['live-cup'], preferLive: true, competition, pokemonName: null, count: null, ...overrides };
}
const ready = { state: 'ready' as const, coverage: [] };

describe('historical profile combination', () => {
  it('recomputes the actual top three from full live counters, including a formerly fourth Pokémon', () => {
    const live = profile();
    const original = structuredClone(live);
    const result = combineHistoricalProfile(live, contribution(), ready);
    expect(result.most_used_pokemon.map((row) => row.pokemon_name)).toEqual(['Mew', 'Pikachu', 'Eevee']);
    expect(result.most_used_pokemon[0]).toMatchObject({ total_games: 17, total_kos_dealt: 24, total_koed: null, kill_differential: null, win_rate: 71 });
    expect(result.best_kill_pokemon[0]).toEqual({ pokemon_name: 'Mew', kos_dealt: 24, rank: null, total_ranked: null });
    expect(result.headline).toMatchObject({ total_matches: 8, total_wins: 5, total_draws: 1, total_losses: 2, win_rate: 63, total_kos_dealt: 27, unique_pokemon_used: 4 });
    expect(result.past_participations[1]).toMatchObject({ competition, standing: null, best_pokemon: null });
    expect(result.rating).toBe(live.rating);
    expect(result.streaks).toBe(live.streaks);
    expect(result.recent_form).toEqual(['W']);
    expect(live).toEqual(original);
  });

  it('does not invent games, wins, deaths or ranks for a KO-only historical Pokémon', () => {
    const result = combineHistoricalProfile(profile(), contribution({ pokemon: [{ pokemonName: 'Celebi', appearances: null, wins: null, kos: 25 }] }), ready);
    expect(result.most_used_pokemon.some((row) => row.pokemon_name === 'Celebi')).toBe(false);
    expect(result.best_kill_pokemon[0]).toEqual({ pokemon_name: 'Celebi', kos_dealt: 25, rank: null, total_ranked: null });
    expect(result.headline.total_kos_dealt).toBe(32);
  });

  it('counts only proven historical species while retaining every live species', () => {
    const live = profile();
    live.live_pokemon_counters!.push(counter('Unown', 0, 0));
    const result = combineHistoricalProfile(live, contribution({ pokemon: [
      { pokemonName: 'Celebi', appearances: null, wins: null, kos: 0 },
      { pokemonName: 'Jirachi', appearances: 0, wins: 0, kos: 0 },
      { pokemonName: 'Manaphy', appearances: null, wins: null, kos: null },
      { pokemonName: 'Shaymin', appearances: 2, wins: 0, kos: 0 },
      { pokemonName: 'Victini', appearances: null, wins: null, kos: 1 },
    ] }), ready);
    expect(result.headline.unique_pokemon_used).toBe(7);
  });

  it('does not add a mapped archive participation when a corresponding live stage exists', () => {
    const result = combineHistoricalProfile(profile(), contribution({ participations: [{ ...competition, liveScopeIds: ['other-stage', 'live-cup'] }] }), ready);
    expect(result.past_participations).toEqual(profile().past_participations);
    expect(result.headline.tournaments_entered).toBe(1);
  });

  it('retains archive participation when its mapping does not match a live participation', () => {
    const result = combineHistoricalProfile(profile(), contribution({ participations: [{ ...competition, liveScopeIds: ['other-stage'] }] }), ready);
    expect(result.past_participations).toHaveLength(2);
    expect(result.headline.tournaments_entered).toBe(2);
  });

  it('falls back to archive participation when no live participation exists', () => {
    const live = profile();
    live.past_participations = [];
    live.headline.tournaments_entered = 0;
    const result = combineHistoricalProfile(live, contribution({ participations: [{ ...competition, liveScopeIds: ['live-cup'] }] }), ready);
    expect(result.past_participations).toHaveLength(1);
    expect(result.past_participations[0].competition?.href).toBe('/archive/fable-cup');
    expect(result.headline.tournaments_entered).toBe(1);
  });

  it('only deduplicates the same mapped live award and recipient, without changing live titles', () => {
    const archive = contribution({ honors: [honor(), honor({ kind: 'runner_up' }), honor({ playerIds: ['trainer-comet'] }), honor({ eventKey: 'other-event', liveScopeIds: [] }), honor({ eventKey: 'other-event', liveScopeIds: [] })] });
    const result = combineHistoricalProfile(profile(), archive, ready);
    expect(result.historical_honors).toHaveLength(3);
    expect(result.historical_honors?.map((row) => row.kind)).toEqual(['runner_up', 'champion', 'champion']);
    expect(result.headline.tournaments_won).toBe(2);
    expect(result.trophies).toEqual(profile().trophies);
  });

  it('retains archive-only and shared honors but never counts shared honors as individual titles', () => {
    const result = combineHistoricalProfile(profile(), contribution({ honors: [honor({ playerIds: ['trainer-orbit', 'trainer-comet'], shared: true }), honor({ preferLive: false })] }), ready);
    expect(result.historical_honors).toHaveLength(2);
    expect(result.headline.tournaments_won).toBe(2);
  });

  it('does not turn a shared source honor into an individual title when a counterpart is hidden or unlinked', () => {
    const jointHonor = honor({ shared: true, playerIds: ['trainer-orbit'] });
    const result = combineHistoricalProfile(profile(), contribution({ honors: [jointHonor] }), ready);
    expect(result.headline.tournaments_won).toBe(profile().headline.tournaments_won);
    expect(result.historical_honors).toEqual([jointHonor]);
  });

  it('falls back to the source champion when the mapped live recipient differs', () => {
    const live = profile();
    live.past_participations[0].standing!.rank = 2;
    live.trophies[0].rank = 2;
    live.headline.tournaments_won = 0;
    const result = combineHistoricalProfile(live, contribution({ honors: [honor()] }), ready);
    expect(result.historical_honors).toHaveLength(1);
    expect(result.headline.tournaments_won).toBe(1);
  });

  it('does not treat a temporary live second-place standing as a runner-up honor', () => {
    const live = profile();
    live.current_participations = [{ ...live.past_participations[0], status: 'active', standing: { rank: 2, total: 8, wins: 1, losses: 1 } }];
    live.past_participations = [];
    live.trophies = [];
    expect(combineHistoricalProfile(live, contribution({ honors: [honor({ kind: 'runner_up' })] }), ready).historical_honors).toHaveLength(1);
  });

  it.each(['absent', 'excluded', 'not_ready', 'failed'] as const)('keeps live statistics and the explicit %s state', (state) => {
    const result = combineHistoricalProfile(profile(), contribution(), { state, coverage: [] });
    expect(result.headline).toEqual(profile().headline);
    expect(result.history?.state).toBe(state);
  });

  it('strips internal counters through both final public allowlists', () => {
    const result = combineHistoricalProfile(profile(), contribution(), ready);
    expect(toPublicPlayerProfile(result)).not.toHaveProperty('live_pokemon_counters');
    expect(toPublicProfileView(result)).not.toHaveProperty('live_pokemon_counters');
    expect(toPublicProfileView(result)).toHaveProperty('history', ready);
    expect(toPublicProfileView(result)).not.toHaveProperty('recent_matches');
  });
});

describe('request-scoped historical profile loading', () => {
  beforeEach(() => vi.clearAllMocks());
  it('does not call the loader when the provider is absent', async () => {
    const provider = packExtensions.historicalProfile;
    packExtensions.historicalProfile = undefined;
    try {
      expect(await readHistoricalProfile('trainer-orbit')).toEqual({ data: null, history: { state: 'absent', coverage: [] } });
      expect(loadSupplement).not.toHaveBeenCalled();
    } finally {
      packExtensions.historicalProfile = provider;
    }
  });
  it.each(['absent', 'excluded', 'failed'] as const)('preserves the %s state', async (state) => {
    vi.mocked(loadSupplement).mockResolvedValue({ state });
    expect(await readHistoricalProfile('trainer-orbit')).toEqual({ data: null, history: { state, coverage: [] } });
  });
  it('preserves not_ready and ready-with-no-data separately', async () => {
    vi.mocked(loadSupplement).mockResolvedValueOnce({ state: 'ready', value: { state: 'not_ready' } });
    expect((await readHistoricalProfile('trainer-orbit')).history.state).toBe('not_ready');
    vi.mocked(loadSupplement).mockResolvedValueOnce({ state: 'ready', value: { state: 'ready', data: null } });
    expect(await readHistoricalProfile('trainer-orbit')).toEqual({ data: null, history: ready });
  });
  it('passes the subject and shared request context through loadSupplement', async () => {
    const data = contribution();
    vi.mocked(loadSupplement).mockResolvedValueOnce({ state: 'ready', value: { state: 'ready', data } });
    vi.mocked(packExtensions.historicalProfile!).mockResolvedValueOnce({ state: 'ready', data });
    expect(await readHistoricalProfile('trainer-orbit')).toEqual({ data, history: ready });
    await vi.mocked(loadSupplement).mock.calls[0][1]!({ viewerPlayerId: 'viewer-nova' });
    expect(packExtensions.historicalProfile).toHaveBeenCalledWith('trainer-orbit', { viewerPlayerId: 'viewer-nova' });
  });
});
