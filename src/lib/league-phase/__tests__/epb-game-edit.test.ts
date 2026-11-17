import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvolutionEvent } from '@/types/evolution';
import type { EpbGameEditRecheck } from '../game-pipeline-types';
import type { EpbGameEditStorage } from '../epb-game-edit';
import type { MatchKillCreditResult } from '@/lib/match/evolution-match-evaluator';

const native = vi.hoisted(() => ({
  legacy: vi.fn(() => { throw new Error('Legacy EPB persistence is forbidden'); }),
  getMatch: vi.fn(),
  uncredit: vi.fn(),
  credit: vi.fn(),
  stages: vi.fn(),
  storage: { native: true },
}));
vi.mock('@/lib/league-phase/epb-storage', () => ({ createPhaseEpbStorage: vi.fn(() => native.storage) }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: native.getMatch }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: native.legacy }));
vi.mock('@/lib/match/evolution-match-evaluator', () => ({
  createEpbKillEvaluator: vi.fn(() => ({ uncreditGameRealKills: native.uncredit, creditMatchRealKills: native.credit })),
  uncreditGameRealKills: native.legacy,
  creditMatchRealKills: native.legacy,
  recheckEpbStages: native.stages,
}));

import { createEpbGameEditRechecker, createNativeEpbGameEditRechecker } from '../epb-game-edit';
import { createPhaseEpbStorage } from '../epb-storage';
import { createEpbKillEvaluator } from '@/lib/match/evolution-match-evaluator';

const input: EpbGameEditRecheck = {
  seasonId: 'league', matchId: 'phase-match', matchday: 2, playerIds: ['p1', 'p2'],
  game: {
    id: 'phase-game', match_id: 'phase-match', game_number: 1, winner_id: 'p1', replay_url: '', replay_hash: null,
    source: 'manual', parsed: true, stats_locked: false, evolution_applied_at: 'credit-marker',
    exclude_all_time: false, created_at: '', updated_at: '',
  },
  oldStats: [], newStats: [], wasCompleted: true, statusConflict: false,
};
const event: EvolutionEvent = {
  player_id: 'p1', base_pokemon: 'Pichu', previous_form: 'Pichu', new_form: 'Pikachu',
  new_stage: 1, total_kos: 1, is_devolution: false,
};
const credit = (): MatchKillCreditResult => ({ applied: ['phase-game'], alreadyApplied: [], notCompleted: [], missing: [], events: [] });

function fixture() {
  const storage: EpbGameEditStorage = {
    getMatchById: vi.fn<EpbGameEditStorage['getMatchById']>().mockResolvedValue({ status: 'completed' }),
    uncreditGameRealKills: vi.fn<EpbGameEditStorage['uncreditGameRealKills']>().mockResolvedValue('rolled_back'),
    creditMatchRealKills: vi.fn<EpbGameEditStorage['creditMatchRealKills']>().mockResolvedValue(credit()),
    recheckEpbStages: vi.fn<EpbGameEditStorage['recheckEpbStages']>().mockResolvedValue([]),
  };
  return { storage, recheck: createEpbGameEditRechecker(storage) };
}

beforeEach(() => {
  vi.clearAllMocks();
  native.getMatch.mockResolvedValue({ status: 'completed' });
  native.uncredit.mockResolvedValue('rolled_back');
  native.credit.mockResolvedValue(credit());
  native.stages.mockResolvedValue([]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  expect(native.legacy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe('EPB game edit recheck', () => {
  it('debits, re-reads completion, credits edited stats and then rechecks stages', async () => {
    const { storage, recheck } = fixture();
    const order: string[] = [];
    vi.mocked(storage.uncreditGameRealKills).mockImplementation(async () => { order.push('debit'); return 'rolled_back'; });
    vi.mocked(storage.getMatchById).mockImplementation(async () => { order.push('read'); return { status: 'completed' }; });
    vi.mocked(storage.creditMatchRealKills).mockImplementation(async () => { order.push('credit'); return { ...credit(), events: [event] }; });
    vi.mocked(storage.recheckEpbStages).mockImplementation(async () => { order.push('stages'); return [event]; });
    await expect(recheck(input)).resolves.toEqual({ events: [event, event], failed: false });
    expect(order).toEqual(['debit', 'read', 'credit', 'stages']);
    expect(storage.uncreditGameRealKills).toHaveBeenCalledWith('league', input.game, input.oldStats);
    expect(storage.creditMatchRealKills).toHaveBeenCalledWith({ seasonId: 'league', matchday: 2, playerIds: ['p1', 'p2'], gameIds: ['phase-game'], statsByGame: { 'phase-game': input.newStats } });
    expect(storage.recheckEpbStages).toHaveBeenCalledWith('league', ['p1', 'p2']);
  });

  it.each(['marker_changed', 'game_missing'] as const)('reports a lost debit fence (%s) without reading or crediting the match', async (outcome) => {
    const { storage, recheck } = fixture();
    vi.mocked(storage.uncreditGameRealKills).mockResolvedValue(outcome);
    await expect(recheck(input)).resolves.toEqual({ events: [], failed: true });
    expect(storage.getMatchById).not.toHaveBeenCalled();
    expect(storage.creditMatchRealKills).not.toHaveBeenCalled();
    expect(storage.recheckEpbStages).toHaveBeenCalled();
  });

  it.each(['in_progress', null] as const)('leaves credit to the next completion when the re-read is %s', async (status) => {
    const { storage, recheck } = fixture();
    vi.mocked(storage.getMatchById).mockResolvedValue(status ? { status } : null);
    await expect(recheck(input)).resolves.toEqual({ events: [], failed: false });
    expect(storage.creditMatchRealKills).not.toHaveBeenCalled();
    expect(storage.recheckEpbStages).toHaveBeenCalled();
  });

  it.each([
    { debit: 'rolled_back' as const, wasCompleted: true, statusConflict: false, failed: false },
    { debit: 'not_applied' as const, wasCompleted: false, statusConflict: false, failed: false },
    { debit: 'not_applied' as const, wasCompleted: true, statusConflict: false, failed: true },
    { debit: 'rolled_back' as const, wasCompleted: true, statusConflict: true, failed: true },
  ])('checks whether a concurrent credit necessarily contains the edited stats: %j', async ({ debit, wasCompleted, statusConflict, failed }) => {
    const { storage, recheck } = fixture();
    vi.mocked(storage.uncreditGameRealKills).mockResolvedValue(debit);
    vi.mocked(storage.creditMatchRealKills).mockResolvedValue({ ...credit(), applied: [], alreadyApplied: ['phase-game'] });
    await expect(recheck({ ...input, wasCompleted, statusConflict })).resolves.toEqual({ events: [], failed });
  });

  it('accepts a match that left completed again, but reports a game gone during credit', async () => {
    const { storage, recheck } = fixture();
    vi.mocked(storage.creditMatchRealKills).mockResolvedValueOnce({ ...credit(), applied: [], notCompleted: ['phase-game'] })
      .mockResolvedValueOnce({ ...credit(), applied: [], missing: ['phase-game'] });
    await expect(recheck(input)).resolves.toEqual({ events: [], failed: false });
    await expect(recheck(input)).resolves.toEqual({ events: [], failed: true });
  });

  it('preserves collected events and reports stage failure after the game change was saved', async () => {
    const { storage, recheck } = fixture();
    const failure = new Error('stage write failed');
    vi.mocked(storage.creditMatchRealKills).mockResolvedValue({ ...credit(), events: [event] });
    vi.mocked(storage.recheckEpbStages).mockRejectedValue(failure);
    await expect(recheck(input)).resolves.toEqual({ events: [event], failed: true });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('after the game change was saved'), failure);
  });

  it('binds native credit/debit storage, phase completion reads and the concrete stage recheck', async () => {
    const recheck = createNativeEpbGameEditRechecker();
    expect(createPhaseEpbStorage).not.toHaveBeenCalled();
    await expect(recheck(input)).resolves.toEqual({ events: [], failed: false });
    expect(createEpbKillEvaluator).toHaveBeenCalledWith(native.storage);
    expect(native.uncredit).toHaveBeenCalledWith('league', input.game, input.oldStats);
    expect(native.getMatch).toHaveBeenCalledWith('phase-match');
    expect(native.credit).toHaveBeenCalledWith(expect.objectContaining({ gameIds: ['phase-game'] }));
    expect(native.stages).toHaveBeenCalledWith('league', ['p1', 'p2']);
    expect(native.uncredit.mock.invocationCallOrder[0]).toBeLessThan(native.getMatch.mock.invocationCallOrder[0]);
    expect(native.getMatch.mock.invocationCallOrder[0]).toBeLessThan(native.credit.mock.invocationCallOrder[0]);
  });

  it('keeps native binding failures as saved-change warnings', async () => {
    const failure = new Error('native storage unavailable');
    vi.mocked(createPhaseEpbStorage).mockImplementationOnce(() => { throw failure; });
    await expect(createNativeEpbGameEditRechecker()(input)).resolves.toEqual({ events: [], failed: true });
    expect(native.getMatch).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('after the game change was saved'), failure);
  });
});
