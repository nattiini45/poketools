/**
 * Tests for the Evolution Point Buy match evaluator (spec §27 MATCH PROCESSING).
 *
 * The evaluator orchestrates post-match tracker progress + stage resolution.
 * It is a thin coordinator over pure helpers (`applyKillDelta`,
 * `buildFormToTrackerIndex`, `applyStageTransitions` in epb-tracker-apply;
 * `resolveEpbStageTransitions` in epb-stage-resolution) and query modules
 * (evolutions, evolution-events, epb-thresholds). The query modules are
 * vi.mocked so we feed controlled tracker/threshold data and assert the
 * coordination: real KOs parsed into per-tracker credits, each game credited
 * through the marker RPC once (at match completion, never twice),
 * stage transitions resolved and recorded as events, the edit debit fenced on
 * the marker.
 * The pure helpers are left REAL so the stage-resolution behavior is
 * genuinely exercised.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Hoisted mock handles ───────────────────────────────────────────
const {
  mockGetSeasonTrackers,
  mockUpdateTracker,
  mockCreditGameKills,
  mockUncreditGameKills,
  mockInsertEvolutionEvents,
  mockGetSeasonLineThresholds,
} = vi.hoisted(() => ({
  mockGetSeasonTrackers: vi.fn(),
  mockUpdateTracker: vi.fn(),
  mockCreditGameKills: vi.fn(),
  mockUncreditGameKills: vi.fn(),
  mockInsertEvolutionEvents: vi.fn(),
  mockGetSeasonLineThresholds: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonTrackers: mockGetSeasonTrackers,
  updateTracker: mockUpdateTracker,
  creditGameKills: mockCreditGameKills,
  uncreditGameKills: mockUncreditGameKills,
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
  buildGameKillCredits,
  creditMatchRealKills,
  uncreditGameRealKills,
} from '../evolution-match-evaluator';
import { buildFormToTrackerIndex } from '@/lib/match/epb-tracker-apply';
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


function creditInput(overrides: Partial<Parameters<typeof creditMatchRealKills>[0]> = {}) {
  return {
    seasonId: 's1',
    matchday: 3,
    playerIds: ['p1', 'p2'] as const,
    gameIds: ['g1'],
    statsByGame: { g1: [{ player_id: 'p1', pokemon_name: 'Charmander', kos_dealt: 3 }] },
    ...overrides,
  };
}

// ── buildGameKillCredits — real KOs parsed into per-tracker credits ──

describe('buildGameKillCredits', () => {
  const lines = [
    charLine(),
    charLine({ base_pokemon: 'Squirtle', stage2_pokemon: 'Wartortle', stage3_pokemon: 'Blastoise' }),
  ];

  it('sums one entry per tracker, drops zero/negative and untracked rows, sorts by tracker id', () => {
    const index = buildFormToTrackerIndex(
      [
        makeTracker({ id: 't-z', base_pokemon: 'Charmander', current_form: 'Charmander' }),
        makeTracker({ id: 't-a', base_pokemon: 'Squirtle', current_form: 'Squirtle' }),
      ],
      lines
    );

    expect(
      buildGameKillCredits(
        [
          { player_id: 'p1', pokemon_name: 'Charmander', kos_dealt: 2 },
          { player_id: 'p1', pokemon_name: 'Charmeleon', kos_dealt: 1 }, // evolved form of the same line
          { player_id: 'p1', pokemon_name: 'Squirtle', kos_dealt: 1 },
          { player_id: 'p1', pokemon_name: 'Squirtle', kos_dealt: 0 }, // dropped
          { player_id: 'p1', pokemon_name: 'Squirtle', kos_dealt: -4 }, // dropped
          { player_id: 'p1', pokemon_name: 'Pikachu', kos_dealt: 6 }, // untracked
          { player_id: 'p2', pokemon_name: 'Charmander', kos_dealt: 5 }, // another player's mon
        ],
        index
      )
    ).toEqual([
      { tracker_id: 't-a', amount: 1 },
      { tracker_id: 't-z', amount: 3 },
    ]);
  });

  it('returns no credit for a game without stats', () => {
    expect(buildGameKillCredits([], buildFormToTrackerIndex([makeTracker()], lines))).toEqual([]);
  });
});

// ── creditMatchRealKills — completion-time credit, once per game ─────

describe('creditMatchRealKills', () => {
  it('credits each game once through the marker RPC and records the stage transition on the matchday', async () => {
    mockGetSeasonLineThresholds.mockResolvedValue([charLine()]);
    mockGetSeasonTrackers
      // credit index: before the credit
      .mockResolvedValueOnce([makeTracker({ total_kos: 2, real_kills: 2 })])
      // stage recheck: the RPC raised the total to 5 (stage-2 threshold 4)
      .mockResolvedValueOnce([makeTracker({ total_kos: 5, real_kills: 5 })]);
    mockCreditGameKills.mockResolvedValue('applied');

    const result = await creditMatchRealKills(creditInput());

    expect(mockCreditGameKills).toHaveBeenCalledTimes(1);
    expect(mockCreditGameKills).toHaveBeenCalledWith('g1', [{ tracker_id: 't-char', amount: 3 }]);
    expect(result.applied).toEqual(['g1']);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      player_id: 'p1',
      previous_form: 'Charmander',
      new_form: 'Charmeleon',
      new_stage: 2,
      tracker_id: 't-char',
    });
    expect(mockUpdateTracker).toHaveBeenCalledWith(
      't-char',
      expect.objectContaining({ current_form: 'Charmeleon', current_stage: 2 })
    );
    expect(mockInsertEvolutionEvents).toHaveBeenCalledWith(
      result.events,
      expect.objectContaining({ season_id: 's1', matchday: 3 })
    );
  });

  it('credits nothing twice on a re-run: an already credited game writes nothing, the stage recheck stays state-based', async () => {
    mockGetSeasonLineThresholds.mockResolvedValue([charLine()]);
    // The first run already credited the kills and resolved the stage.
    mockGetSeasonTrackers.mockResolvedValue([
      makeTracker({ current_form: 'Charmeleon', current_stage: 2, total_kos: 5, real_kills: 5 }),
    ]);
    mockCreditGameKills.mockResolvedValue('already_applied');

    const result = await creditMatchRealKills(creditInput());

    expect(result).toMatchObject({ applied: [], alreadyApplied: ['g1'], events: [] });
    expect(mockUpdateTracker).not.toHaveBeenCalled();
  });

  it('calls the RPC for every game, sorted, including a game without stats', async () => {
    mockGetSeasonLineThresholds.mockResolvedValue([charLine()]);
    mockGetSeasonTrackers.mockResolvedValue([makeTracker()]);
    mockCreditGameKills.mockResolvedValue('applied');

    await creditMatchRealKills(creditInput({
      gameIds: ['g2', 'g1', 'g2'],
      statsByGame: { g1: [{ player_id: 'p1', pokemon_name: 'Charmander', kos_dealt: 1 }] },
    }));

    expect(mockCreditGameKills.mock.calls).toEqual([
      ['g1', [{ tracker_id: 't-char', amount: 1 }]],
      ['g2', []],
    ]);
  });

  it('reports games of a match that left completed, and resolves no stage for them', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetSeasonLineThresholds.mockResolvedValue([charLine()]);
    mockGetSeasonTrackers.mockResolvedValue([makeTracker()]);
    mockCreditGameKills.mockResolvedValueOnce('match_not_completed');

    const result = await creditMatchRealKills(creditInput());

    expect(result).toMatchObject({ applied: [], notCompleted: ['g1'], events: [] });
    expect(mockGetSeasonTrackers).toHaveBeenCalledTimes(1); // no stage recheck
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('not credited: the match left completed'), ['g1']);
    logged.mockRestore();
  });

  it('propagates a failed credit (the step fails; the uncredited games stay uncredited)', async () => {
    mockGetSeasonLineThresholds.mockResolvedValue([charLine()]);
    mockGetSeasonTrackers.mockResolvedValue([makeTracker()]);
    const err = new Error('rpc failed');
    mockCreditGameKills.mockRejectedValueOnce(err);

    await expect(creditMatchRealKills(creditInput())).rejects.toBe(err);
    expect(mockUpdateTracker).not.toHaveBeenCalled();
  });

  it('does nothing without games', async () => {
    const result = await creditMatchRealKills(creditInput({ gameIds: [], statsByGame: {} }));
    expect(result.applied).toEqual([]);
    expect(mockGetSeasonTrackers).not.toHaveBeenCalled();
    expect(mockCreditGameKills).not.toHaveBeenCalled();
  });
});

// ── uncreditGameRealKills — admin edit debit, fenced on the marker ───

describe('uncreditGameRealKills', () => {
  it('debits the credited stats, fenced on the marker it read', async () => {
    mockGetSeasonLineThresholds.mockResolvedValue([charLine()]);
    mockGetSeasonTrackers.mockResolvedValue([makeTracker({ total_kos: 5, real_kills: 5 })]);
    mockUncreditGameKills.mockResolvedValue('rolled_back');

    const outcome = await uncreditGameRealKills(
      's1',
      { id: 'g1', evolution_applied_at: '2026-10-20T10:00:00Z' },
      [{ player_id: 'p1', pokemon_name: 'Charmander', kos_dealt: 3 }]
    );

    expect(outcome).toBe('rolled_back');
    expect(mockUncreditGameKills).toHaveBeenCalledWith('g1', '2026-10-20T10:00:00Z', [
      { tracker_id: 't-char', amount: 3 },
    ]);
  });

  it('writes nothing for a game that was never credited', async () => {
    const outcome = await uncreditGameRealKills('s1', { id: 'g1', evolution_applied_at: null }, [
      { player_id: 'p1', pokemon_name: 'Charmander', kos_dealt: 3 },
    ]);

    expect(outcome).toBe('not_applied');
    expect(mockUncreditGameKills).not.toHaveBeenCalled();
    expect(mockGetSeasonTrackers).not.toHaveBeenCalled();
  });

  it('passes a lost marker race through', async () => {
    mockGetSeasonLineThresholds.mockResolvedValue([charLine()]);
    mockGetSeasonTrackers.mockResolvedValue([makeTracker()]);
    mockUncreditGameKills.mockResolvedValue('marker_changed');

    await expect(
      uncreditGameRealKills('s1', { id: 'g1', evolution_applied_at: '2026-10-20T10:00:00Z' }, [])
    ).resolves.toBe('marker_changed');
  });
});
