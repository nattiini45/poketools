import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvolutionTier, EvolutionTracker } from '@/types/evolution';

const mocks = vi.hoisted(() => ({
  trackers: vi.fn(), tiers: vi.fn(), update: vi.fn(), legacyKos: vi.fn(),
  from: vi.fn(), select: vi.fn(), eq: vi.fn(), names: vi.fn(), order: vi.fn(), range: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonTrackers: mocks.trackers, getAllTiers: mocks.tiers,
  updateTracker: mocks.update, getSeasonKosForLine: mocks.legacyKos,
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: mocks.from },
}));

import { phaseEvolutionChecker } from '../evolution-checker';
import { checkPlayerEvolutions, checkEvolutions } from '@/lib/draft/evolution-engine';
import { getPhaseSeasonKosForLine } from '@/lib/supabase/queries/phase-reconciliation';

const tier: EvolutionTier = {
  id: 'tier', season_id: 'season', player_id: null, base_pokemon: 'Charmander',
  stage2_pokemon: 'Charmeleon', stage2_kos: 3, stage3_pokemon: 'Charizard',
  stage3_kos: 8, power_tier: 'A', created_at: '2026-01-01',
};

function tracker(overrides: Partial<EvolutionTracker> = {}): EvolutionTracker {
  return {
    id: 'tracker', season_id: 'season', player_id: 'player', base_pokemon: 'Charmander',
    current_form: 'Charmander', current_stage: 1, total_kos: 0, evolved_at: null,
    created_at: '2026-01-01', updated_at: '2026-01-01', real_kills: 0, draft_tokens: 0,
    kill_tokens: 0, cosmo_points: 0, suspended_until_matchday: null,
    evolution_points_awarded: 0, locked_stage3_pokemon: null, line_id: null,
    transferred_evo_progress: 0, redraft_slot_id: null, ...overrides,
  };
}

let stats: { id: string; kos_dealt: number }[];

beforeEach(() => {
  vi.clearAllMocks();
  stats = [{ id: 'native-stat', kos_dealt: 8 }];
  mocks.trackers.mockResolvedValue([tracker(), tracker({ id: 'other', player_id: 'other-player' })]);
  mocks.tiers.mockResolvedValue([tier]);
  mocks.update.mockResolvedValue(undefined);
  mocks.legacyKos.mockResolvedValue(8);
  const builder = {
    select: mocks.select, eq: mocks.eq, in: mocks.names, order: mocks.order, range: mocks.range,
  };
  for (const fn of [mocks.from, mocks.select, mocks.eq, mocks.names, mocks.order]) fn.mockReturnValue(builder);
  mocks.range.mockImplementation((from: number, to: number) => Promise.resolve({
    data: stats.slice(from, to + 1), error: null,
  }));
});

describe('native non-EPB threshold evolution', () => {
  it('gains a stage from native league KOs and never reads legacy or standalone games', async () => {
    const events = await phaseEvolutionChecker.checkPlayerEvolutions('season', 'player');
    expect(events).toEqual([expect.objectContaining({
      previous_form: 'Charmander', new_form: 'Charizard', new_stage: 3, total_kos: 8, is_devolution: false,
    })]);
    expect(mocks.update).toHaveBeenCalledWith('tracker', expect.objectContaining({
      current_form: 'Charizard', current_stage: 3, total_kos: 8,
    }));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect([...new Set(mocks.from.mock.calls.map(([table]) => table))]).toEqual(['phase_battle_stats']);
    expect(mocks.select).toHaveBeenCalledWith(
      'id, kos_dealt, phase_games!inner(phase_matches!inner(league_phases!inner(season_id)))',
    );
    expect(mocks.eq).toHaveBeenCalledWith('phase_games.phase_matches.league_phases.season_id', 'season');
    expect(mocks.eq).toHaveBeenCalledWith('player_id', 'player');
    expect(mocks.names).toHaveBeenCalledWith('pokemon_name', ['Charmander', 'Charmeleon', 'Charizard']);
    expect(mocks.legacyKos).not.toHaveBeenCalled();
  });

  it('devolves using the same threshold algorithm after native KOs are removed', async () => {
    mocks.trackers.mockResolvedValue([tracker({ current_form: 'Charizard', current_stage: 3, total_kos: 8 })]);
    stats = [{ id: 'remaining', kos_dealt: 2 }];
    const events = await phaseEvolutionChecker.checkPlayerEvolutions('season', 'player');
    expect(events).toEqual([expect.objectContaining({
      previous_form: 'Charizard', new_form: 'Charmander', new_stage: 1, total_kos: 2, is_devolution: true,
    })]);
    expect(mocks.update).toHaveBeenCalledWith('tracker', expect.objectContaining({
      current_form: 'Charmander', current_stage: 1, total_kos: 2,
    }));
    expect(mocks.legacyKos).not.toHaveBeenCalled();
  });

  it('matches the legacy checker results while preserving legacy query selection and arity', async () => {
    const native = await phaseEvolutionChecker.checkPlayerEvolutions('season', 'player');
    mocks.from.mockClear();
    const legacy = await checkPlayerEvolutions('season', 'player');
    expect(legacy).toEqual(native);
    expect(mocks.legacyKos).toHaveBeenCalledWith('season', 'player', ['Charmander', 'Charmeleon', 'Charizard']);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(checkPlayerEvolutions.length).toBe(2);
    expect(checkEvolutions.length).toBe(1);
  });

  it('keeps player-specific tier precedence and supports the season-wide native checker', async () => {
    mocks.tiers.mockResolvedValue([tier, { ...tier, id: 'wildcard', player_id: 'player', stage3_kos: 10 }]);
    const events = await phaseEvolutionChecker.checkEvolutions('season');
    expect(events.map((event) => [event.player_id, event.new_stage])).toEqual([
      ['player', 2], ['other-player', 3],
    ]);
  });

  it('does not turn a failed native read into legacy totals or a devolution', async () => {
    const error = new Error('native KO read failed');
    mocks.range.mockResolvedValue({ data: null, error });
    await expect(phaseEvolutionChecker.checkPlayerEvolutions('season', 'player')).rejects.toBe(error);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.legacyKos).not.toHaveBeenCalled();
  });
});

describe('native line KO paging', () => {
  it('reads past max_rows using stable id pages without per-game or per-phase queries', async () => {
    stats = Array.from({ length: 1205 }, (_, i) => ({ id: String(i).padStart(5, '0'), kos_dealt: 1 }));
    expect(await getPhaseSeasonKosForLine('season', 'player', ['Charmander'])).toBe(1205);
    expect(mocks.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
    expect(mocks.order).toHaveBeenCalledWith('id');
    expect(mocks.from.mock.calls.every(([table]) => table === 'phase_battle_stats')).toBe(true);
  });

  it('returns zero for an empty line without issuing a query', async () => {
    expect(await getPhaseSeasonKosForLine('season', 'player', [])).toBe(0);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
