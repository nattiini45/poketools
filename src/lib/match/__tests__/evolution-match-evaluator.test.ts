/**
 * Tests for the Evolution Point Buy match evaluator (spec §27 MATCH PROCESSING).
 *
 * The evaluator orchestrates post-match tracker progress + stage resolution.
 * It is a thin coordinator over pure helpers (`applyKillDelta`,
 * `buildFormToTrackerIndex`, `applyStageTransitions` in epb-tracker-apply;
 * `resolveEpbStageTransitions` in epb-stage-resolution) and query modules
 * (evolutions, evolution-events, epb-thresholds). The query modules are
 * vi.mocked so we feed controlled tracker/threshold data and assert the
 * coordination: real KOs parsed & applied, stage transitions recorded as
 * events, rollback reverses the delta, persistence calls fire correctly.
 * The pure helpers are left REAL so the stage-resolution behavior is
 * genuinely exercised.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Hoisted mock handles ───────────────────────────────────────────
const {
  mockGetSeasonTrackers,
  mockUpdateTracker,
  mockApplyTrackerProgressWithLog,
  mockInsertEvolutionEvents,
  mockGetSeasonLineThresholds,
} = vi.hoisted(() => ({
  mockGetSeasonTrackers: vi.fn(),
  mockUpdateTracker: vi.fn(),
  mockApplyTrackerProgressWithLog: vi.fn(),
  mockInsertEvolutionEvents: vi.fn(),
  mockGetSeasonLineThresholds: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonTrackers: mockGetSeasonTrackers,
  updateTracker: mockUpdateTracker,
  applyTrackerProgressWithLog: mockApplyTrackerProgressWithLog,
  // Pulled in transitively by epb-tracker-apply via epb-team-validation; not
  // called by the evaluator, but the mock must satisfy the import graph.
  getTrackerByLine: vi.fn(),
  getPlayerTrackers: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/evolution-events', () => ({
  insertEvolutionEvents: mockInsertEvolutionEvents,
}));

vi.mock('@/lib/draft/epb-thresholds', () => ({
  getSeasonLineThresholds: mockGetSeasonLineThresholds,
}));

// ── Import after mocks ─────────────────────────────────────────────
import {
  applyRealKillsFromGame,
  rollbackRealKillsFromGame,
} from '../evolution-match-evaluator';
import type { EvolutionTracker } from '@/types/evolution';
import type { LineThresholds } from '@/lib/match/epb-stage-resolution';

// ── Fixtures ────────────────────────────────────────────────────────

function makeTracker(overrides: Partial<EvolutionTracker> = {}): EvolutionTracker {
  return {
    id: 't-char',
    season_id: 's1',
    player_id: 'p1',
    base_pokemon: 'Charmander',
    current_form: 'Charmander',
    total_kos: 0,
    current_stage: 1,
    evolved_at: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    real_kills: 0,
    draft_tokens: 0,
    kill_tokens: 0,
    cosmo_points: 0,
    suspended_until_matchday: null,
    evolution_points_awarded: 0,
    locked_stage3_pokemon: null,
    line_id: null,
    transferred_evo_progress: 0,
    redraft_slot_id: null,
    ...overrides,
  };
}

function charLine(overrides: Partial<LineThresholds> = {}): LineThresholds {
  return {
    base_pokemon: 'Charmander',
    stage2_pokemon: 'Charmeleon',
    stage3_pokemon: 'Charizard',
    stage2_kos: 4,
    stage3_kos: 14,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // insertEvolutionEvents is non-fatal in the apply path; default to success.
  mockInsertEvolutionEvents.mockResolvedValue(undefined);
  mockUpdateTracker.mockResolvedValue(undefined);
});

// ── applyRealKillsFromGame — real KOs parsed & applied ──────────────

describe('applyRealKillsFromGame', () => {
  it('returns [] and skips persistence when there are no trackers', async () => {
    mockGetSeasonTrackers.mockResolvedValue([]);
    mockGetSeasonLineThresholds.mockResolvedValue([charLine()]);

    const events = await applyRealKillsFromGame('s1', [
      { player_id: 'p1', pokemon_name: 'Charmander', kos_dealt: 3 },
    ]);

    expect(events).toEqual([]);
    expect(mockApplyTrackerProgressWithLog).not.toHaveBeenCalled();
    expect(mockInsertEvolutionEvents).not.toHaveBeenCalled();
  });

  it('applies positive KOs to the matching tracker and persists the updated total', async () => {
    const tracker = makeTracker({ total_kos: 2, real_kills: 2, current_stage: 1 });
    mockGetSeasonTrackers.mockResolvedValue([tracker]);
    mockGetSeasonLineThresholds.mockResolvedValue([charLine()]);
    // Below the stage-2 threshold (total 4) — no stage transition yet.
    mockApplyTrackerProgressWithLog.mockResolvedValue(
      makeTracker({ total_kos: 3, real_kills: 3, current_stage: 1 })
    );

    const events = await applyRealKillsFromGame('s1', [
      { player_id: 'p1', pokemon_name: 'Charmander', kos_dealt: 1 },
    ], { matchday: 2 });

    // No stage crossed → no evolution events.
    expect(events).toEqual([]);
    expect(mockApplyTrackerProgressWithLog).toHaveBeenCalledWith(
      't-char', 'real_kill', 1,
      expect.objectContaining({ matchday: 2, note: 'KO from battle' })
    );
    // No stage transition → no form/stage updateTracker call.
    expect(mockUpdateTracker).not.toHaveBeenCalled();
    // insertEvolutionEvents is still invoked (with an empty events array is
    // a no-op inside the mocked impl; the evaluator calls it unconditionally).
    expect(mockInsertEvolutionEvents).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ season_id: 's1', matchday: 2 })
    );
  });

  it('records a stage transition as an EvolutionEvent when KOs cross the stage-2 threshold', async () => {
    const tracker = makeTracker({ total_kos: 2, real_kills: 2, current_stage: 1 });
    mockGetSeasonTrackers.mockResolvedValue([tracker]);
    mockGetSeasonLineThresholds.mockResolvedValue([charLine()]);
    // +3 KOs → total_kos 5 ≥ stage2_kos 4 → Charmander → Charmeleon.
    mockApplyTrackerProgressWithLog.mockResolvedValue(
      makeTracker({ total_kos: 5, real_kills: 5, current_stage: 1 })
    );

    const events = await applyRealKillsFromGame('s1', [
      { player_id: 'p1', pokemon_name: 'Charmander', kos_dealt: 3 },
    ], { matchday: 3 });

    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event).toMatchObject({
      player_id: 'p1',
      base_pokemon: 'Charmander',
      previous_form: 'Charmander',
      new_form: 'Charmeleon',
      new_stage: 2,
      previous_stage: 1,
      is_devolution: false,
      total_kos: 5,
      tracker_id: 't-char',
    });

    // The form/stage update is persisted.
    expect(mockUpdateTracker).toHaveBeenCalledWith(
      't-char',
      expect.objectContaining({ current_form: 'Charmeleon', current_stage: 2 })
    );
    // The event is persisted to evolution_events with the matchday context.
    expect(mockInsertEvolutionEvents).toHaveBeenCalledWith(
      events,
      expect.objectContaining({ season_id: 's1', matchday: 3 })
    );
  });

  it('records a double stage transition (stage 1 → 3) when KOs cross both thresholds', async () => {
    const tracker = makeTracker({ total_kos: 2, real_kills: 2, current_stage: 1 });
    mockGetSeasonTrackers.mockResolvedValue([tracker]);
    mockGetSeasonLineThresholds.mockResolvedValue([charLine()]);
    // +15 KOs → total_kos 17 ≥ stage3_kos 14 → Charmander → Charmeleon → Charizard.
    mockApplyTrackerProgressWithLog.mockResolvedValue(
      makeTracker({ total_kos: 17, real_kills: 17, current_stage: 1 })
    );

    const events = await applyRealKillsFromGame('s1', [
      { player_id: 'p1', pokemon_name: 'Charmander', kos_dealt: 15 },
    ], { matchday: 4 });

    // Two transitions: stage 2 then stage 3.
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ new_form: 'Charmeleon', new_stage: 2, previous_stage: 1 });
    expect(events[1]).toMatchObject({ new_form: 'Charizard', new_stage: 3, previous_stage: 2 });
    // Final persisted form is the terminal stage.
    expect(mockUpdateTracker).toHaveBeenCalledWith(
      't-char',
      expect.objectContaining({ current_form: 'Charizard', current_stage: 3 })
    );
  });

  it('matches KOs recorded under an EVOLVED form name, not just the base form', async () => {
    // A line that already evolved records KOs under "Charmeleon" (its current
    // form). buildFormToTrackerIndex maps every form of the line to the
    // tracker, so the stat still resolves.
    const tracker = makeTracker({
      current_form: 'Charmeleon',
      current_stage: 2,
      total_kos: 4,
      real_kills: 4,
    });
    mockGetSeasonTrackers.mockResolvedValue([tracker]);
    mockGetSeasonLineThresholds.mockResolvedValue([charLine()]);
    mockApplyTrackerProgressWithLog.mockResolvedValue(
      makeTracker({ current_form: 'Charmeleon', current_stage: 2, total_kos: 7, real_kills: 7 })
    );

    const events = await applyRealKillsFromGame('s1', [
      { player_id: 'p1', pokemon_name: 'Charmeleon', kos_dealt: 3 },
    ]);

    expect(mockApplyTrackerProgressWithLog).toHaveBeenCalledWith(
      't-char', 'real_kill', 3, expect.objectContaining({ note: 'KO from battle' })
    );
    // 7 < 14 (stage3_kos) → still stage 2, no transition.
    expect(events).toEqual([]);
  });

  it('drops zero / negative KO rows before applying (applyKillDelta filter)', async () => {
    const tracker = makeTracker({ total_kos: 2, real_kills: 2 });
    mockGetSeasonTrackers.mockResolvedValue([tracker]);
    mockGetSeasonLineThresholds.mockResolvedValue([charLine()]);
    mockApplyTrackerProgressWithLog.mockResolvedValue(
      makeTracker({ total_kos: 3, real_kills: 3 })
    );

    await applyRealKillsFromGame('s1', [
      { player_id: 'p1', pokemon_name: 'Charmander', kos_dealt: 0 }, // dropped
      { player_id: 'p1', pokemon_name: 'Charmander', kos_dealt: -5 }, // dropped
      { player_id: 'p1', pokemon_name: 'Charmander', kos_dealt: 1 }, // applied
    ]);

    // Only the positive row reaches the apply RPC.
    expect(mockApplyTrackerProgressWithLog).toHaveBeenCalledTimes(1);
    expect(mockApplyTrackerProgressWithLog).toHaveBeenCalledWith(
      't-char', 'real_kill', 1, expect.anything()
    );
  });

  it('skips stats for an unknown form (no matching tracker)', async () => {
    const tracker = makeTracker();
    mockGetSeasonTrackers.mockResolvedValue([tracker]);
    mockGetSeasonLineThresholds.mockResolvedValue([charLine()]);

    const events = await applyRealKillsFromGame('s1', [
      { player_id: 'p1', pokemon_name: 'Pikachu', kos_dealt: 6 },
    ]);

    expect(events).toEqual([]);
    expect(mockApplyTrackerProgressWithLog).not.toHaveBeenCalled();
  });

  it('continues applying progress even if event persistence throws (non-fatal)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tracker = makeTracker({ total_kos: 2, real_kills: 2 });
    mockGetSeasonTrackers.mockResolvedValue([tracker]);
    mockGetSeasonLineThresholds.mockResolvedValue([charLine()]);
    mockApplyTrackerProgressWithLog.mockResolvedValue(
      makeTracker({ total_kos: 5, real_kills: 5 })
    );
    mockInsertEvolutionEvents.mockRejectedValue(new Error('db down'));

    const events = await applyRealKillsFromGame('s1', [
      { player_id: 'p1', pokemon_name: 'Charmander', kos_dealt: 3 },
    ]);

    // The stage transition is still computed and returned...
    expect(events).toHaveLength(1);
    expect(events[0].new_form).toBe('Charmeleon');
    // ...and the form/stage update still persisted (progress not undone).
    expect(mockUpdateTracker).toHaveBeenCalled();
    // The persistence failure is logged, not thrown.
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not mutate the input trackers array beyond the touched set', async () => {
    const touched = makeTracker({ id: 't-a', base_pokemon: 'Charmander', total_kos: 2, real_kills: 2 });
    const untouched = makeTracker({ id: 't-b', player_id: 'p1', base_pokemon: 'Squirtle', current_form: 'Squirtle', total_kos: 0, real_kills: 0 });
    mockGetSeasonTrackers.mockResolvedValue([touched, untouched]);
    mockGetSeasonLineThresholds.mockResolvedValue([
      charLine(),
      charLine({ base_pokemon: 'Squirtle', stage2_pokemon: 'Wartortle', stage3_pokemon: 'Blastoise' }),
    ]);
    mockApplyTrackerProgressWithLog.mockResolvedValue(
      makeTracker({ total_kos: 3, real_kills: 3 })
    );

    await applyRealKillsFromGame('s1', [
      { player_id: 'p1', pokemon_name: 'Charmander', kos_dealt: 1 },
    ]);

    // Only the Charmander tracker received an apply call.
    expect(mockApplyTrackerProgressWithLog).toHaveBeenCalledTimes(1);
    expect(mockUpdateTracker).not.toHaveBeenCalled(); // no stage crossed
  });
});

// ── rollbackRealKillsFromGame (undo path) ──────────────────────────

describe('rollbackRealKillsFromGame', () => {
  it('subtracts KOs with a negative sign for a deleted game', async () => {
    const tracker = makeTracker({ total_kos: 5, real_kills: 5 });
    mockGetSeasonTrackers.mockResolvedValue([tracker]);
    mockGetSeasonLineThresholds.mockResolvedValue([charLine()]);
    // Apply path mutates real_kills/total_kos on the returned tracker; the
    // rollback returns the decremented values.
    mockApplyTrackerProgressWithLog.mockResolvedValue(
      makeTracker({ total_kos: 2, real_kills: 2 })
    );

    await rollbackRealKillsFromGame('s1', [
      { player_id: 'p1', pokemon_name: 'Charmander', kos_dealt: 3 },
    ]);

    // applyKillDelta signs the row with -1; the RPC receives the negative
    // amount (clamping-at-0 happens server-side in the real RPC).
    expect(mockApplyTrackerProgressWithLog).toHaveBeenCalledWith(
      't-char', 'real_kill', -3,
      expect.objectContaining({ note: 'Rollback: game deleted' })
    );
    // Rollback does NOT resolve stage transitions or persist events.
    expect(mockUpdateTracker).not.toHaveBeenCalled();
    expect(mockInsertEvolutionEvents).not.toHaveBeenCalled();
  });

  it('reverses the delta across multiple lines in one call', async () => {
    const charT = makeTracker({ id: 't-char', base_pokemon: 'Charmander', current_form: 'Charmander', total_kos: 5, real_kills: 5 });
    const squirtT = makeTracker({ id: 't-squirt', base_pokemon: 'Squirtle', current_form: 'Squirtle', total_kos: 3, real_kills: 3 });
    mockGetSeasonTrackers.mockResolvedValue([charT, squirtT]);
    mockGetSeasonLineThresholds.mockResolvedValue([
      charLine(),
      charLine({ base_pokemon: 'Squirtle', stage2_pokemon: 'Wartortle', stage3_pokemon: 'Blastoise' }),
    ]);
    mockApplyTrackerProgressWithLog.mockResolvedValue(makeTracker({ total_kos: 0, real_kills: 0 }));

    await rollbackRealKillsFromGame('s1', [
      { player_id: 'p1', pokemon_name: 'Charmander', kos_dealt: 2 },
      { player_id: 'p1', pokemon_name: 'Squirtle', kos_dealt: 1 },
    ]);

    expect(mockApplyTrackerProgressWithLog).toHaveBeenCalledTimes(2);
    expect(mockApplyTrackerProgressWithLog).toHaveBeenNthCalledWith(1, 't-char', 'real_kill', -2, expect.anything());
    expect(mockApplyTrackerProgressWithLog).toHaveBeenNthCalledWith(2, 't-squirt', 'real_kill', -1, expect.anything());
  });

  it('no-ops when there are no trackers', async () => {
    mockGetSeasonTrackers.mockResolvedValue([]);
    mockGetSeasonLineThresholds.mockResolvedValue([charLine()]);

    await rollbackRealKillsFromGame('s1', [
      { player_id: 'p1', pokemon_name: 'Charmander', kos_dealt: 3 },
    ]);

    expect(mockApplyTrackerProgressWithLog).not.toHaveBeenCalled();
  });

  it('drops zero / negative KO rows before signing (rollback path)', async () => {
    const tracker = makeTracker();
    mockGetSeasonTrackers.mockResolvedValue([tracker]);
    mockGetSeasonLineThresholds.mockResolvedValue([charLine()]);
    mockApplyTrackerProgressWithLog.mockResolvedValue(makeTracker());

    await rollbackRealKillsFromGame('s1', [
      { player_id: 'p1', pokemon_name: 'Charmander', kos_dealt: 0 }, // dropped
      { player_id: 'p1', pokemon_name: 'Charmander', kos_dealt: 2 }, // applied as -2
    ]);

    expect(mockApplyTrackerProgressWithLog).toHaveBeenCalledTimes(1);
    expect(mockApplyTrackerProgressWithLog).toHaveBeenCalledWith(
      't-char', 'real_kill', -2, expect.anything()
    );
  });
});