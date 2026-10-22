/**
 * `runEpbMatchdayHooks` wiring of the participation rule: the registered teams of the
 * match (`match_prep_teams`) are read once and passed with the battle rows to `awardCosmoPoint`
 * for both players, and to the snapshot writer. A failed team read throws before any write.
 * The failure rollback deletes only the evolution events this run added (baseline by id).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: vi.fn() } }));
vi.mock('@/lib/supabase/queries/evolutions', () => ({
  clearExpiredSuspensions: vi.fn(),
  getSeasonTrackers: vi.fn(),
  updateTracker: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/evolution-events', () => ({ getSeasonEvolutionEvents: vi.fn() }));
vi.mock('@/lib/supabase/queries/progress-log', () => ({ getSeasonProgressLog: vi.fn() }));
vi.mock('@/lib/supabase/queries/match-snapshots', () => ({
  deleteMatchSnapshots: vi.fn(),
  insertMatchSnapshots: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/match-prep-teams', () => ({ getRegisteredSpeciesByMatch: vi.fn() }));
vi.mock('@/lib/draft/epb-thresholds', () => ({ getSeasonLineThresholds: vi.fn() }));
vi.mock('@/lib/draft/progress-engine', () => ({ awardCosmoPoint: vi.fn(), checkEarlyStage3Lock: vi.fn() }));
vi.mock('@/lib/draft/evolution-points-engine', () => ({ awardEvolutionPointForMatchday: vi.fn() }));
vi.mock('@/lib/match/evolution-match-evaluator', () => ({ recheckEpbStages: vi.fn() }));

import { runEpbMatchdayHooks } from '../epb-matchday';
import { supabase } from '@/lib/supabase/client';
import { clearExpiredSuspensions, getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import { getSeasonEvolutionEvents } from '@/lib/supabase/queries/evolution-events';
import { getSeasonProgressLog } from '@/lib/supabase/queries/progress-log';
import { insertMatchSnapshots } from '@/lib/supabase/queries/match-snapshots';
import { getRegisteredSpeciesByMatch } from '@/lib/supabase/queries/match-prep-teams';
import { getSeasonLineThresholds } from '@/lib/draft/epb-thresholds';
import { awardCosmoPoint, checkEarlyStage3Lock } from '@/lib/draft/progress-engine';
import { recheckEpbStages } from '@/lib/match/evolution-match-evaluator';
import type { BattleStat } from '@/types/game';
import type { EvolutionEventRecord, EvolutionTracker } from '@/types/evolution';
import type { MatchWithPlayers } from '@/types/match';

const MATCH = { id: 'match-1', player_1_id: 'p1', player_2_id: 'p2' } as MatchWithPlayers;

function tracker(overrides: Partial<EvolutionTracker> = {}): EvolutionTracker {
  return {
    id: 't-dratini',
    season_id: 's1',
    player_id: 'p1',
    base_pokemon: 'Dratini',
    current_form: 'Dratini',
    total_kos: 0,
    current_stage: 1,
    evolved_at: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    real_kills: 0,
    draft_tokens: 0,
    kill_tokens: 0,
    cosmo_points: 0,
    suspended_until_matchday: null,
    evolution_points_awarded: 0,
    locked_stage3_pokemon: null,
    line_id: 'dratini--dragonite',
    transferred_evo_progress: 0,
    redraft_slot_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSeasonTrackers).mockResolvedValue([tracker()]);
  vi.mocked(getSeasonLineThresholds).mockResolvedValue([
    {
      line_id: 'dratini--dragonite',
      base_pokemon: 'Dratini',
      stage2_pokemon: 'Dragonair',
      stage3_pokemon: 'Dragonite',
      stage2_kos: 5,
      stage3_kos: 10,
    },
  ]);
  vi.mocked(getSeasonEvolutionEvents).mockResolvedValue([]);
  vi.mocked(getSeasonProgressLog).mockResolvedValue([]);
  vi.mocked(awardCosmoPoint).mockResolvedValue(false);
  vi.mocked(checkEarlyStage3Lock).mockResolvedValue([]);
  vi.mocked(recheckEpbStages).mockResolvedValue([]);
});

describe('runEpbMatchdayHooks — registered teams (participation rule)', () => {
  it('passes each player’s registered team and the battle rows to awardCosmoPoint', async () => {
    vi.mocked(getRegisteredSpeciesByMatch).mockResolvedValue(new Map([['p1', ['Dratini', 'Pichu']]]));

    await runEpbMatchdayHooks({ match: MATCH, seasonId: 's1', matchday: 3, battleStats: [] });

    expect(getRegisteredSpeciesByMatch).toHaveBeenCalledTimes(1);
    expect(getRegisteredSpeciesByMatch).toHaveBeenCalledWith('match-1');
    expect(awardCosmoPoint).toHaveBeenCalledTimes(2);
    expect(awardCosmoPoint).toHaveBeenNthCalledWith(1, 's1', 3, {
      playerId: 'p1',
      registeredSpecies: ['Dratini', 'Pichu'],
      battleStats: [],
    });
    // p2 registered no team: null, never an empty team.
    expect(awardCosmoPoint).toHaveBeenNthCalledWith(2, 's1', 3, { playerId: 'p2', registeredSpecies: null, battleStats: [] });
  });

  it('marks a registered line as brought in the snapshot even without battle rows', async () => {
    vi.mocked(getRegisteredSpeciesByMatch).mockResolvedValue(new Map([['p1', ['Dratini']]]));

    await runEpbMatchdayHooks({ match: MATCH, seasonId: 's1', matchday: 3, battleStats: [] });

    const rows = vi.mocked(insertMatchSnapshots).mock.calls[0][1];
    expect(rows).toEqual([expect.objectContaining({ tracker_id: 't-dratini', brought: true })]);
  });

  it('a line neither registered nor in the battle rows is not brought', async () => {
    vi.mocked(getRegisteredSpeciesByMatch).mockResolvedValue(new Map([['p1', ['Pichu']]]));
    const battleStats = [{ player_id: 'p2', pokemon_name: 'Dratini' }] as BattleStat[];

    await runEpbMatchdayHooks({ match: MATCH, seasonId: 's1', matchday: 3, battleStats });

    const rows = vi.mocked(insertMatchSnapshots).mock.calls[0][1];
    expect(rows).toEqual([expect.objectContaining({ tracker_id: 't-dratini', brought: false })]);
  });

  it('a failed team read throws before any write (never read as "no team")', async () => {
    const failure = new Error('match_prep_teams read failed');
    vi.mocked(getRegisteredSpeciesByMatch).mockRejectedValue(failure);

    await expect(
      runEpbMatchdayHooks({ match: MATCH, seasonId: 's1', matchday: 3, battleStats: [] }),
    ).rejects.toBe(failure);
    expect(clearExpiredSuspensions).not.toHaveBeenCalled();
    expect(awardCosmoPoint).not.toHaveBeenCalled();
    expect(insertMatchSnapshots).not.toHaveBeenCalled();
  });
});

describe('runEpbMatchdayHooks — failure rollback keeps the real-kill credit\'s events', () => {
  function event(id: string, overrides: Partial<EvolutionEventRecord> = {}): EvolutionEventRecord {
    return {
      id,
      season_id: 's1',
      matchday: 3,
      is_manual: false,
      // The database clock may run ahead of the app's: created_at says nothing about which run wrote it.
      created_at: '2099-01-01T00:00:00Z',
      player_id: 'p1',
      tracker_id: 't-dratini',
      base_pokemon: 'Dratini',
      previous_form: 'Dratini',
      new_form: 'Dragonair',
      previous_stage: 1,
      new_stage: 2,
      total_kos: 5,
      is_devolution: false,
      ...overrides,
    };
  }

  it('deletes only the events this run added, never the credit step\'s stage transitions', async () => {
    vi.mocked(getRegisteredSpeciesByMatch).mockResolvedValue(new Map());
    const creditEvent = event('ev-credit'); // written by finalize step epb_real_kills, before the hooks
    const hookEvent = event('ev-hook', { player_id: 'p2', tracker_id: 't-p2' });
    const manualEvent = event('ev-manual', { is_manual: true });
    const otherPairing = event('ev-other', { player_id: 'p9', tracker_id: 't-p9' });
    vi.mocked(getSeasonEvolutionEvents)
      .mockResolvedValueOnce([creditEvent]) // baseline, read before any hook write
      .mockResolvedValue([creditEvent, hookEvent, manualEvent, otherPairing]);
    const failure = new Error('stage lock failed');
    vi.mocked(checkEarlyStage3Lock).mockRejectedValue(failure);

    const deletedIds: unknown[] = [];
    vi.mocked(supabase.from).mockImplementation((() => {
      const chain: Record<string, unknown> = {};
      for (const m of ['delete', 'eq', 'neq', 'gte']) chain[m] = vi.fn(() => chain);
      chain.in = vi.fn((column: string, values: unknown[]) => {
        if (column === 'id') deletedIds.push(...values);
        return chain;
      });
      chain.then = (resolve: (v: unknown) => void) => Promise.resolve({ error: null }).then(resolve);
      return chain;
    }) as unknown as typeof supabase.from);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      runEpbMatchdayHooks({ match: MATCH, seasonId: 's1', matchday: 3, battleStats: [] }),
    ).rejects.toBe(failure);

    expect(deletedIds).toEqual(['ev-hook']);
    expect(vi.mocked(supabase.from)).toHaveBeenCalledWith('evolution_events');
    consoleError.mockRestore();
  });
});
