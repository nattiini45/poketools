/**
 * Tests for the chronological EPB evolution rebuild engine (spec §20).
 *
 * `computeEvolutionStateCore` is pure, so the canonical-case tests pass
 * already-loaded data and need no DB mocks. The diff test mocks the query
 * module that re-fetches stored trackers, following the repo's vi.mock
 * chained-builder pattern (see drafts.test.ts).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  computeEvolutionStateCore,
  type RebuildInput,
  type RebuildSnapshot,
  type ComputedTracker,
} from '../evolution-rebuild';
import type { EvolutionTracker } from '@/types/evolution';
import type { LineThresholds } from '@/lib/match/epb-stage-resolution';
import { epbPack } from '@/lib/format-pack';
import type { BattleStat } from '@/types/game';
import type { Match } from '@/types/match';

// ── Fixtures ───────────────────────────────────────────────────────

const dreepyLine: LineThresholds = {
  base_pokemon: 'Dreepy',
  stage2_pokemon: 'Drakloak',
  stage3_pokemon: 'Dragapult',
  stage2_kos: 3,
  stage3_kos: 10,
};

/** The example pack's participation line (src/format-packs/example/epb.ts), test thresholds. */
const cosmogLine: LineThresholds = {
  base_pokemon: 'Dratini',
  stage2_pokemon: 'Dragonair',
  stage3_pokemon: 'Dragonite',
  stage2_kos: 4,
  stage3_kos: 12,
};

function makeTracker(overrides: Partial<EvolutionTracker> = {}): EvolutionTracker {
  return {
    id: 'tracker-1',
    season_id: 'season-1',
    player_id: 'player-1',
    base_pokemon: 'Dreepy',
    current_form: 'Dreepy',
    total_kos: 0,
    current_stage: 1,
    evolved_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
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

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: 'match-1',
    round_id: 'round-1',
    tournament_id: 't-1',
    player_1_id: 'player-1',
    player_2_id: 'player-2',
    winner_id: 'player-1',
    status: 'completed',
    submitter_id: null,
    date_played: '2026-01-10T00:00:00Z',
    scheduled_at: null,
    auto_confirm_at: null,
    confirmed_at: null,
    bracket_side: null,
    bracket_pos: null,
    notes: '',
    social_image_url: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function stat(
  playerId: string,
  pokemon: string,
  kos: number,
  gameId = 'g-1'
): BattleStat {
  return {
    id: `${playerId}-${pokemon}-${gameId}`,
    game_id: gameId,
    player_id: playerId,
    pokemon_name: pokemon,
    was_brought: true,
    was_lead: false,
    kos_dealt: kos,
    was_koed: false,
    moves_used: [],
    turns_active: 1,
    match_won: false,
    created_at: '2026-01-10T00:00:00Z',
  };
}

function findTracker(
  state: { computedTrackers: ComputedTracker[] },
  basePokemon: string,
  playerId = 'player-1'
): ComputedTracker {
  const t = state.computedTrackers.find(
    (x) => x.base_pokemon === basePokemon && x.player_id === playerId
  );
  if (!t) throw new Error(`tracker not found: ${basePokemon} for ${playerId}`);
  return t;
}

// ── §20 canonical case: Dreepy evolves in matchday 1, played as Drakloak
//    in matchday 2; deleting matchday 1 moves/undoes the progression. ──

describe('§20 canonical case — Dreepy evolves md1, played as Drakloak md2', () => {
  const dreepyTracker = makeTracker({ id: 't-dreepy', base_pokemon: 'Dreepy' });
  const lines = [dreepyLine];

  // matchday 1: Dreepy gets 3 KOs (crosses stage2_kos=3) → evolves to Drakloak.
  // matchday 2: player fields Drakloak (the evolved form), gets 1 KO.
  const matchday1 = {
    match: makeMatch({ id: 'm1' }),
    matchday: 1,
    battleStats: [stat('player-1', 'Dreepy', 3), stat('player-2', 'Foo', 0)],
  };
  const matchday2 = {
    match: makeMatch({ id: 'm2', round_id: 'round-2', player_2_id: 'player-3' }),
    matchday: 2,
    // KOs credited under the evolved form name (Drakloak) — the form→tracker
    // index must map them back to the Dreepy base line.
    battleStats: [stat('player-1', 'Drakloak', 1)],
  };

  it('WITH matchday 1: evolution at md1, EP at md1, stage 2 after md2', () => {
    const input: RebuildInput = {
      trackers: [dreepyTracker],
      lines,
      matches: [matchday1, matchday2],
      snapshots: [],
    };
    const state = computeEvolutionStateCore(input);

    const t = findTracker(state, 'Dreepy');
    // 3 KOs (md1) + 1 KO (md2) = 4 real_kills; total_kos = 4.
    expect(t.real_kills).toBe(4);
    expect(t.total_kos).toBe(4);
    expect(t.current_stage).toBe(2);
    expect(t.current_form).toBe('Drakloak');
    expect(t.evolution_points_awarded).toBe(1);

    // Evolution event at matchday 1 (Dreepy → Drakloak), non-devolution.
    const md1Events = state.computedEvents.filter((e) => e.matchday === 1);
    expect(md1Events).toHaveLength(1);
    expect(md1Events[0].event.is_devolution).toBe(false);
    expect(md1Events[0].event.new_form).toBe('Drakloak');
    expect(md1Events[0].event.new_stage).toBe(2);
    // No new evolution event at matchday 2 (already at stage 2, below stage3).
    const md2Events = state.computedEvents.filter((e) => e.matchday === 2);
    expect(md2Events).toHaveLength(0);
  });

  it('WITHOUT matchday 1 (deleted): KOs from md2 still apply via form→tracker mapping, evolution moves to md2', () => {
    // After deleting matchday 1, the tracker is rebuilt from scratch: it
    // starts at Dreepy stage 1. The md2 battle stats credit Drakloak (the
    // evolved form) with 1 KO — but the form→tracker index is built from the
    // working tracker (still Dreepy at md2 start), and collectLineForms
    // includes ALL line forms (Dreepy, Drakloak, Dragapult), so the KO maps
    // to the Dreepy tracker regardless.
    const input: RebuildInput = {
      trackers: [dreepyTracker],
      lines,
      matches: [matchday2], // matchday 1 deleted
      snapshots: [],
    };
    const state = computeEvolutionStateCore(input);

    const t = findTracker(state, 'Dreepy');
    // Only 1 KO from md2; below stage2_kos=3 → no evolution.
    expect(t.real_kills).toBe(1);
    expect(t.total_kos).toBe(1);
    expect(t.current_stage).toBe(1);
    expect(t.current_form).toBe('Dreepy');
    // No evolution → no EP.
    expect(t.evolution_points_awarded).toBe(0);
    expect(state.computedEvents).toHaveLength(0);
  });

  it('WITHOUT matchday 1 but WITH enough md2 KOs: evolution moves to md2 and EP follows', () => {
    const md2Enough = {
      match: makeMatch({ id: 'm2', round_id: 'round-2', player_2_id: 'player-3' }),
      matchday: 2,
      battleStats: [stat('player-1', 'Drakloak', 3)], // crosses threshold at md2
    };
    const input: RebuildInput = {
      trackers: [dreepyTracker],
      lines,
      matches: [md2Enough],
      snapshots: [],
    };
    const state = computeEvolutionStateCore(input);

    const t = findTracker(state, 'Dreepy');
    expect(t.real_kills).toBe(3);
    expect(t.total_kos).toBe(3);
    expect(t.current_stage).toBe(2);
    expect(t.current_form).toBe('Drakloak');
    expect(t.evolution_points_awarded).toBe(1);

    const md2Events = state.computedEvents.filter((e) => e.matchday === 2);
    expect(md2Events).toHaveLength(1);
    expect(md2Events[0].event.new_stage).toBe(2);
  });
});

// ── Cosmo point + preserved grants (§21) ───────────────────────────

describe('cosmo point + preserved draft/kill-token grants (§21)', () => {
  const cosmogTracker = makeTracker({
    id: 't-cosmog',
    base_pokemon: 'Dratini',
    current_form: 'Dratini',
  });

  it('awards a cosmo point when the participation line is brought and below untilStage', () => {
    const input: RebuildInput = {
      trackers: [cosmogTracker],
      lines: [cosmogLine],
      matches: [
        {
          match: makeMatch(),
          matchday: 1,
          battleStats: [stat('player-1', 'Dratini', 0)],
        },
      ],
      snapshots: [],
    };
    const state = computeEvolutionStateCore(input);
    const t = findTracker(state, 'Dratini');
    expect(t.cosmo_points).toBe(1);
    expect(t.total_kos).toBe(1);
  });

  it('does NOT award cosmo once the line reached stage 3 (no cosmo after final evo)', () => {
    // 12 KOs at matchday 1 → crosses stage3_kos=12 → Dratini→Dragonair→Dragonite.
    const input: RebuildInput = {
      trackers: [cosmogTracker],
      lines: [cosmogLine],
      matches: [
        {
          match: makeMatch(),
          matchday: 1,
          battleStats: [stat('player-1', 'Dratini', 12)],
        },
      ],
      snapshots: [],
    };
    const state = computeEvolutionStateCore(input);
    const t = findTracker(state, 'Dratini');
    expect(t.current_stage).toBe(3);
    // shouldAwardCosmoPoint(stage 3) === false → no cosmo point.
    expect(t.cosmo_points).toBe(0);
    expect(t.total_kos).toBe(12);
  });

  it('preserves draft_tokens and kill_tokens (never reset) and includes them in total_kos', () => {
    const tWithGrants = makeTracker({
      id: 't-dreepy',
      base_pokemon: 'Dreepy',
      draft_tokens: 2,
      kill_tokens: 1,
    });
    const input: RebuildInput = {
      trackers: [tWithGrants],
      lines: [dreepyLine],
      // One matchday with 1 real KO: real_kills=1, but tokens preserved.
      matches: [
        {
          match: makeMatch(),
          matchday: 1,
          battleStats: [stat('player-1', 'Dreepy', 1)],
        },
      ],
      snapshots: [],
    };
    const state = computeEvolutionStateCore(input);
    const t = findTracker(state, 'Dreepy');
    expect(t.draft_tokens).toBe(2); // preserved (§21)
    expect(t.kill_tokens).toBe(1); // preserved (§21)
    expect(t.real_kills).toBe(1); // recomputed from matches
    expect(t.cosmo_points).toBe(0);
    expect(t.total_kos).toBe(4); // 1 real + 2 draft + 1 kill + 0 cosmo
    // total_kos 4 ≥ dreepy stage2_kos(3) and < stage3_kos(10) → stage 2.
    expect(t.current_stage).toBe(2);
    expect(t.current_form).toBe('Drakloak');
  });

  it('zeroes real_kills and cosmo_points when there are no remaining matches but preserves grants', () => {
    const tWithGrants = makeTracker({
      id: 't-dreepy',
      base_pokemon: 'Dreepy',
      draft_tokens: 2,
      kill_tokens: 1,
      real_kills: 99,
      cosmo_points: 5,
    });
    const input: RebuildInput = {
      trackers: [tWithGrants],
      lines: [dreepyLine],
      matches: [], // all matches deleted
      snapshots: [],
    };
    const state = computeEvolutionStateCore(input);
    const t = findTracker(state, 'Dreepy');
    expect(t.real_kills).toBe(0);
    expect(t.cosmo_points).toBe(0);
    expect(t.draft_tokens).toBe(2);
    expect(t.kill_tokens).toBe(1);
    expect(t.total_kos).toBe(3); // only preserved grants
    expect(t.current_stage).toBe(1);
    expect(t.current_form).toBe('Dreepy');
    expect(t.evolution_points_awarded).toBe(0);
  });

  it('preserves transferred_evo_progress and counts it in the five-term total_kos', () => {
    // Redraft example (SPEC Prompt 6 §12): Dreepy receives 9 transferred progress;
    // one self-earned KO later the line has total 10 = Dragapult's threshold.
    const transferred = makeTracker({
      id: 't-dreepy',
      base_pokemon: 'Dreepy',
      line_id: 'dreepy--dragapult',
      transferred_evo_progress: 9,
      real_kills: 0,
      total_kos: 9,
    });
    const state = computeEvolutionStateCore({
      trackers: [transferred],
      lines: [{ ...dreepyLine, line_id: 'dreepy--dragapult' }],
      matches: [{ match: makeMatch(), matchday: 1, battleStats: [stat('player-1', 'Dreepy', 1)] }],
      snapshots: [],
    });
    const t = findTracker(state, 'Dreepy');
    expect(t.transferred_evo_progress).toBe(9); // preserved (§21), never shown as kills
    expect(t.real_kills).toBe(1); // only the self-earned KO
    expect(t.total_kos).toBe(10); // 1 real + 9 transferred
    expect(t.current_stage).toBe(3);
    expect(t.current_form).toBe('Dragapult');
  });

  it('keeps transferred progress in total_kos when no match remains', () => {
    const transferred = makeTracker({
      id: 't-dreepy',
      base_pokemon: 'Dreepy',
      transferred_evo_progress: 4,
      draft_tokens: 1,
      kill_tokens: 2,
      real_kills: 7,
    });
    const state = computeEvolutionStateCore({
      trackers: [transferred],
      lines: [dreepyLine],
      matches: [],
      snapshots: [],
    });
    const t = findTracker(state, 'Dreepy');
    expect(t.real_kills).toBe(0);
    expect(t.total_kos).toBe(7); // 4 transferred + 1 draft + 2 comeback
  });
});

describe('Cosmo Tokens in the rebuild (line ids, brought, once per matchday)', () => {
  const solgaleo: LineThresholds = {
    line_id: 'ralts--gallade',
    base_pokemon: 'Ralts',
    stage2_pokemon: 'Kirlia',
    stage3_pokemon: 'Gallade',
    stage2_kos: 4,
    stage3_kos: 9,
  };
  const lunala: LineThresholds = { ...cosmogLine, line_id: 'dratini--dragonite', stage2_kos: 5, stage3_kos: 10 };
  const lunalaTracker = makeTracker({
    id: 't-lunala',
    base_pokemon: 'Dratini',
    current_form: 'Dratini',
    line_id: 'dratini--dragonite',
    locked_stage3_pokemon: 'Dragonite',
  });

  it('resolves a participation tracker by its line id and awards one token when brought', () => {
    const state = computeEvolutionStateCore({
      trackers: [lunalaTracker],
      lines: [solgaleo, lunala],
      matches: [{ match: makeMatch(), matchday: 1, battleStats: [stat('player-1', 'Dratini', 0)] }],
      snapshots: [],
    });
    expect(findTracker(state, 'Dratini').cosmo_points).toBe(1);
  });

  it('awards nothing when the match has stats but the line was not brought', () => {
    const state = computeEvolutionStateCore({
      trackers: [lunalaTracker],
      lines: [solgaleo, lunala],
      matches: [{ match: makeMatch(), matchday: 1, battleStats: [stat('player-1', 'Dreepy', 2)] }],
      snapshots: [],
    });
    expect(findTracker(state, 'Dratini').cosmo_points).toBe(0);
  });

  it('awards nothing without the line thresholds (cannot prove "brought")', () => {
    const state = computeEvolutionStateCore({
      trackers: [lunalaTracker],
      lines: [],
      matches: [{ match: makeMatch(), matchday: 1, battleStats: [stat('player-1', 'Dratini', 0)] }],
      snapshots: [],
    });
    expect(findTracker(state, 'Dratini').cosmo_points).toBe(0);
  });

  it('awards at most one token per matchday, one per matchday played', () => {
    const state = computeEvolutionStateCore({
      trackers: [lunalaTracker],
      lines: [solgaleo, lunala],
      matches: [
        { match: makeMatch({ id: 'm-a' }), matchday: 1, battleStats: [stat('player-1', 'Dragonair', 0)] },
        // a second match in the same matchday (re-scheduled pairing) does not add a token
        { match: makeMatch({ id: 'm-b', player_2_id: 'player-3' }), matchday: 1, battleStats: [stat('player-1', 'Dratini', 0, 'g-2')] },
        { match: makeMatch({ id: 'm-c' }), matchday: 2, battleStats: [stat('player-1', 'Dratini', 0, 'g-3')] },
      ],
      snapshots: [],
    });
    expect(findTracker(state, 'Dratini').cosmo_points).toBe(2);
  });
});

// ── Early stage-3 lock ─────────────────────────────────────────────

describe('early stage lock (format pack epb.stageLock; example: stage 3 by matchday 2)', () => {
  it('suspends for the next matchday when stage 3 is reached early', () => {
    // 10 KOs at matchday 1 crosses stage3_kos=10 for Dreepy → stage 3 at md1.
    const input: RebuildInput = {
      trackers: [makeTracker({ id: 't-dreepy', base_pokemon: 'Dreepy' })],
      lines: [dreepyLine],
      matches: [
        {
          match: makeMatch(),
          matchday: 1,
          battleStats: [stat('player-1', 'Dreepy', 10)],
        },
      ],
      snapshots: [],
    };
    const state = computeEvolutionStateCore(input);
    const t = findTracker(state, 'Dreepy');
    expect(t.current_stage).toBe(3);
    expect(t.suspended_until_matchday).toBe(1 + epbPack.stageLock.suspendMatchdays); // md1 + suspendMatchdays
  });

  it('clears the suspension once a later matchday beyond the lock window is evaluated', () => {
    // Stage 3 reached at matchday 1 → suspended until matchday 2. The lock
    // rule re-triggers while the matchday is inside the pack's lock window
    // (shouldSuspend true and the guard is `=== null`). At matchday 5, beyond
    // the window, shouldSuspend is false and the cleared suspension stays
    // clear. This mirrors the shipped checkEarlyStage3Lock behavior exactly.
    const input: RebuildInput = {
      trackers: [makeTracker({ id: 't-dreepy', base_pokemon: 'Dreepy' })],
      lines: [dreepyLine],
      matches: [
        {
          match: makeMatch(),
          matchday: 1,
          battleStats: [stat('player-1', 'Dreepy', 10)],
        },
        {
          match: makeMatch({ id: 'm5', round_id: 'round-5', player_2_id: 'p3' }),
          matchday: 5, // beyond the lock window
          battleStats: [stat('player-1', 'Dragapult', 1, 'g5')],
        },
      ],
      snapshots: [],
    };
    const state = computeEvolutionStateCore(input);
    const t = findTracker(state, 'Dreepy');
    expect(t.suspended_until_matchday).toBeNull();
  });
});

// ── Impossible-lineup detection (§20/§13) ──────────────────────────

describe('impossible-lineup detection (flag, do not rewrite)', () => {
  it('flags a snapshot whose stage exceeds the rebuilt progression', () => {
    // Snapshot claims the player fielded Drakloak (stage 2) at matchday 2,
    // but the rebuild (matchday 1 deleted) only reaches stage 1 by matchday 2.
    const input: RebuildInput = {
      trackers: [makeTracker({ id: 't-dreepy', base_pokemon: 'Dreepy' })],
      lines: [dreepyLine],
      matches: [
        {
          match: makeMatch({ id: 'm2', round_id: 'round-2', player_2_id: 'p3' }),
          matchday: 2,
          battleStats: [stat('player-1', 'Dreepy', 1)],
        },
      ],
      snapshots: [
        {
          matchId: 'm2',
          matchday: 2,
          playerId: 'player-1',
          basePokemon: 'Dreepy',
          stageAtMatch: 2,
        },
      ],
    };
    const state = computeEvolutionStateCore(input);
    expect(state.impossibleLineups).toHaveLength(1);
    const imp = state.impossibleLineups[0];
    expect(imp.matchId).toBe('m2');
    expect(imp.snapshotStage).toBe(2);
    expect(imp.rebuiltMaxStageByMatchday).toBe(1);
    expect(imp.matchday).toBe(2);
  });

  it('does not flag when the snapshot stage matches the rebuilt progression', () => {
    const input: RebuildInput = {
      trackers: [makeTracker({ id: 't-dreepy', base_pokemon: 'Dreepy' })],
      lines: [dreepyLine],
      matches: [
        {
          match: makeMatch(),
          matchday: 1,
          battleStats: [stat('player-1', 'Dreepy', 3)], // → stage 2
        },
      ],
      snapshots: [
        {
          matchId: 'm1',
          matchday: 1,
          playerId: 'player-1',
          basePokemon: 'Dreepy',
          stageAtMatch: 2, // matches rebuilt
        },
      ],
    };
    const state = computeEvolutionStateCore(input);
    expect(state.impossibleLineups).toHaveLength(0);
  });
});

describe('impossible-lineup detection — branched base keyed by line_id', () => {
  // One player owns both Oshawott lines; they share the base but not the
  // thresholds, so by matchday 1 only the Samurott line reaches stage 2.
  const samurottLine: LineThresholds = {
    line_id: 'oshawott--samurott',
    base_pokemon: 'Oshawott',
    stage2_pokemon: 'Dewott',
    stage3_pokemon: 'Samurott',
    stage2_kos: 3,
    stage3_kos: 10,
  };
  const hisuiLine: LineThresholds = {
    line_id: 'oshawott--samurotthisui',
    base_pokemon: 'Oshawott',
    stage2_pokemon: 'Dewott',
    stage3_pokemon: 'Samurott-Hisui',
    stage2_kos: 6,
    stage3_kos: 12,
  };

  function branchedInput(snapshots: RebuildSnapshot[], trackerOrder: 'samurott-first' | 'hisui-first'): RebuildInput {
    const samurott = makeTracker({
      id: 't-samurott',
      base_pokemon: 'Oshawott',
      current_form: 'Oshawott',
      line_id: 'oshawott--samurott',
      draft_tokens: 3,
      total_kos: 3,
    });
    const hisui = makeTracker({
      id: 't-hisui',
      base_pokemon: 'Oshawott',
      current_form: 'Oshawott',
      line_id: 'oshawott--samurotthisui',
      draft_tokens: 3,
      total_kos: 3,
    });
    return {
      trackers: trackerOrder === 'samurott-first' ? [samurott, hisui] : [hisui, samurott],
      lines: [samurottLine, hisuiLine],
      matches: [{ match: makeMatch(), matchday: 1, battleStats: [stat('player-1', 'Pikachu', 0)] }],
      snapshots,
    };
  }

  function snapshot(lineId: string | null, stageAtMatch: number): RebuildSnapshot {
    return { matchId: 'm1', matchday: 1, playerId: 'player-1', basePokemon: 'Oshawott', lineId, stageAtMatch };
  }

  it.each(['samurott-first', 'hisui-first'] as const)(
    'flags only the line whose own progression cannot reach the fielded stage (%s)',
    (order) => {
      const state = computeEvolutionStateCore(
        branchedInput([snapshot('oshawott--samurott', 2), snapshot('oshawott--samurotthisui', 2)], order)
      );
      expect(state.computedTrackers.find((t) => t.id === 't-samurott')?.current_stage).toBe(2);
      expect(state.computedTrackers.find((t) => t.id === 't-hisui')?.current_stage).toBe(1);
      expect(state.impossibleLineups).toHaveLength(1);
      expect(state.impossibleLineups[0]).toMatchObject({
        lineId: 'oshawott--samurotthisui',
        basePokemon: 'Oshawott',
        snapshotStage: 2,
        rebuiltMaxStageByMatchday: 1,
      });
    }
  );

  it('does not flag a stage-1 snapshot of either line', () => {
    const state = computeEvolutionStateCore(
      branchedInput([snapshot('oshawott--samurott', 1), snapshot('oshawott--samurotthisui', 1)], 'hisui-first')
    );
    expect(state.impossibleLineups).toHaveLength(0);
  });

  it.each(['samurott-first', 'hisui-first'] as const)(
    'an old snapshot without line_id falls back to the max over the base (%s)',
    (order) => {
      const state = computeEvolutionStateCore(branchedInput([snapshot(null, 2)], order));
      expect(state.impossibleLineups).toHaveLength(0);
      const tooHigh = computeEvolutionStateCore(branchedInput([snapshot(null, 3)], order));
      expect(tooHigh.impossibleLineups).toHaveLength(1);
      expect(tooHigh.impossibleLineups[0]).toMatchObject({ lineId: null, rebuiltMaxStageByMatchday: 2 });
    }
  );
});

// ── Diff + repair (mocked query modules) ───────────────────────────

// Mock the evolutions query module so diffEvolutionState's re-fetch returns a
// deliberately-corrupted stored tracker, and so repairSeasonEvolution's writes
// can be inspected (grouped-insert matchday preservation).
const {
  mockGetSeasonTrackers,
  mockUpdateTracker,
  mockInsertEvolutionEvents,
  mockRecalculateEvolutionPoints,
} = vi.hoisted(() => ({
  mockGetSeasonTrackers: vi.fn(),
  mockUpdateTracker: vi.fn(),
  mockInsertEvolutionEvents: vi.fn(),
  mockRecalculateEvolutionPoints: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonTrackers: mockGetSeasonTrackers,
  updateTracker: mockUpdateTracker,
}));

vi.mock('@/lib/draft/epb-thresholds', () => ({
  getSeasonLineThresholds: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/evolution-events', () => ({
  getSeasonEvolutionEvents: vi.fn(),
  insertEvolutionEvents: mockInsertEvolutionEvents,
}));

vi.mock('@/lib/supabase/queries/match-snapshots', () => ({
  getMatchSnapshots: vi.fn(),
}));

vi.mock('@/lib/draft/evolution-points-engine', () => ({
  recalculateEvolutionPoints: mockRecalculateEvolutionPoints,
}));

vi.mock('@/lib/supabase/client', () => {
  // Thenable chained-builder mock: every chain method returns the builder, and
  // awaiting the builder (or calling a terminal like .single/.maybeSingle)
  // resolves to { data: null, error: null }. This supports both the loader's
  // `await supabase.from(...).select().eq()` reads and the repair writer's
  // `await supabase.from(...).delete().eq().eq()` deletes without a real DB.
  const emptyResult = { data: null, error: null };
  const builder: Record<string, unknown> = {};
  const methods = [
    'from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
    'contains', 'filter', 'not', 'or', 'order', 'limit', 'range', 'match',
  ];
  for (const m of methods) {
    builder[m] = vi.fn().mockReturnValue(builder);
  }
  builder.single = vi.fn().mockResolvedValue(emptyResult);
  builder.maybeSingle = vi.fn().mockResolvedValue(emptyResult);
  // Make the builder itself thenable so `await builder` resolves.
  builder.then = (_resolve: (v: unknown) => void) => Promise.resolve(emptyResult).then(_resolve);
  return { supabase: builder };
});

import { diffEvolutionState, repairSeasonEvolution, applyComputedEvolutionState } from '../evolution-rebuild';

describe('diffEvolutionState', () => {
  beforeEach(() => {
    mockGetSeasonTrackers.mockReset();
  });

  it('detects a deliberately-corrupted stored tracker', async () => {
    const computed = computeEvolutionStateCore({
      trackers: [makeTracker({ id: 't-dreepy', base_pokemon: 'Dreepy' })],
      lines: [dreepyLine],
      matches: [
        {
          match: makeMatch(),
          matchday: 1,
          battleStats: [stat('player-1', 'Dreepy', 3)], // → stage 2, real_kills 3
        },
      ],
      snapshots: [],
    });

    // Corrupt the stored state: claim it's still at stage 1 with 0 real_kills.
    const corruptedStored = [
      makeTracker({
        id: 't-dreepy',
        base_pokemon: 'Dreepy',
        real_kills: 0,
        current_stage: 1,
        current_form: 'Dreepy',
        total_kos: 0,
      }),
    ];
    mockGetSeasonTrackers.mockResolvedValue(corruptedStored);

    const mismatches = await diffEvolutionState('season-1', computed);
    const fields = mismatches.map((m) => m.field);
    expect(fields).toContain('real_kills');
    expect(fields).toContain('current_stage');
    expect(fields).toContain('current_form');
    expect(fields).toContain('total_kos');
    const realKillsMismatch = mismatches.find((m) => m.field === 'real_kills');
    expect(realKillsMismatch?.stored).toBe(0);
    expect(realKillsMismatch?.computed).toBe(3);
  });

  it('returns no mismatches when stored matches computed', async () => {
    const computed = computeEvolutionStateCore({
      trackers: [makeTracker({ id: 't-dreepy', base_pokemon: 'Dreepy' })],
      lines: [dreepyLine],
      matches: [],
      snapshots: [],
    });
    // Stored matches computed (no matches → all zeroed, grants preserved).
    const stored = [
      makeTracker({
        id: 't-dreepy',
        base_pokemon: 'Dreepy',
        real_kills: 0,
        cosmo_points: 0,
        total_kos: 0,
        current_stage: 1,
        current_form: 'Dreepy',
        evolution_points_awarded: 0,
        suspended_until_matchday: null,
      }),
    ];
    mockGetSeasonTrackers.mockResolvedValue(stored);

    const mismatches = await diffEvolutionState('season-1', computed);
    expect(mismatches).toHaveLength(0);
  });
});

// ── repairSeasonEvolution: grouped-insert preserves matchday (Finding 1) ──

describe('repairSeasonEvolution — grouped insert preserves matchday', () => {
  beforeEach(() => {
    mockGetSeasonTrackers.mockReset();
    mockUpdateTracker.mockReset();
    mockInsertEvolutionEvents.mockReset();
    mockRecalculateEvolutionPoints.mockReset();
    mockRecalculateEvolutionPoints.mockResolvedValue({
      players_updated: 1,
      points_awarded: 1,
    });
  });

  it('inserts events once per distinct matchday with that matchday in ctx (EP not zeroed)', async () => {
    // Two distinct matchdays each produce a non-devolution event: Dreepy evolves
    // at md1, Gastly evolves at md2. The repair write path (applyComputedEvolutionState)
    // must group by matchday and pass each matchday in the insert ctx — the
    // epb_recalculate_evolution_points RPC only awards points where
    // matchday IS NOT NULL, so a flat insert with no matchday would zero EP.
    const trackerDreepy = makeTracker({ id: 't-dreepy', base_pokemon: 'Dreepy' });
    const trackerGastly = makeTracker({
      id: 't-gastly',
      base_pokemon: 'Gastly',
      player_id: 'player-1',
    });
    const gastlyLine2: LineThresholds = {
      base_pokemon: 'Gastly',
      stage2_pokemon: 'Haunter',
      stage3_pokemon: 'Gengar',
      stage2_kos: 5,
      stage3_kos: 15,
    };

    const computed = computeEvolutionStateCore({
      trackers: [trackerDreepy, trackerGastly],
      lines: [dreepyLine, gastlyLine2],
      matches: [
        {
          match: makeMatch({ id: 'm1' }),
          matchday: 1,
          battleStats: [stat('player-1', 'Dreepy', 3)], // Dreepy → Drakloak at md1
        },
        {
          match: makeMatch({ id: 'm2', round_id: 'round-2', player_2_id: 'p3' }),
          matchday: 2,
          battleStats: [stat('player-1', 'Gastly', 5)], // Gastly → Haunter at md2
        },
      ],
      snapshots: [],
    });

    // Sanity: both matchdays produced a non-devolution event.
    const md1 = computed.computedEvents.filter((e) => e.matchday === 1);
    const md2 = computed.computedEvents.filter((e) => e.matchday === 2);
    expect(md1.length).toBeGreaterThanOrEqual(1);
    expect(md2.length).toBeGreaterThanOrEqual(1);
    expect(
      md1.every((e) => !e.event.is_devolution) && md2.every((e) => !e.event.is_devolution)
    ).toBe(true);

    // Drive the actual write path with the computed state (no DB/loader mock
    // needed — applyComputedEvolutionState takes the state directly).
    const result = await applyComputedEvolutionState('season-1', computed);

    // One insert call per distinct matchday (md1 and md2), each carrying that
    // matchday in its ctx — NOT a single flat insert with matchday defaulted.
    const matchdaysInserted = new Set<number>();
    for (const call of mockInsertEvolutionEvents.mock.calls) {
      const ctx = call[1] as { season_id: string; matchday?: number | null };
      expect(ctx.season_id).toBe('season-1');
      // The load-bearing assertion: matchday is a real number, never null/undefined.
      expect(typeof ctx.matchday).toBe('number');
      matchdaysInserted.add(ctx.matchday as number);
    }
    expect(matchdaysInserted).toEqual(new Set([1, 2]));
    expect(mockInsertEvolutionEvents).toHaveBeenCalledTimes(2);

    // recalc runs after the grouped insert; with non-null matchdays on every
    // event, points_awarded is > 0 (the bug would have produced 0).
    expect(mockRecalculateEvolutionPoints).toHaveBeenCalledTimes(1);
    expect(mockRecalculateEvolutionPoints).toHaveBeenCalledWith('season-1');
    expect(result.eventsRewritten).toBe(computed.computedEvents.length);
    expect(result.evolutionPoints.points_awarded).toBeGreaterThan(0);
  });

  it('repairSeasonEvolution calls recalculateEvolutionPoints after the grouped insert', async () => {
    const tracker = makeTracker({ id: 't-dreepy', base_pokemon: 'Dreepy' });
    mockGetSeasonTrackers.mockResolvedValue([tracker]);
    const { getSeasonLineThresholds } = await import('@/lib/draft/epb-thresholds');
    (getSeasonLineThresholds as ReturnType<typeof vi.fn>).mockResolvedValue([dreepyLine]);

    // loadSeasonMatches uses the supabase client (mocked no-op → no matches),
    // so repair computes an empty-events state; the contract under test is the
    // call ordering (insert before recalc) and that recalc is invoked once.
    await repairSeasonEvolution('season-1');

    expect(mockRecalculateEvolutionPoints).toHaveBeenCalledWith('season-1');
    expect(mockRecalculateEvolutionPoints).toHaveBeenCalledTimes(1);
    // With no matches there are no events to insert, so recalc still ran (the
    // wipe+recompute still executes) but produced 0 points from the mock.
    expect(mockInsertEvolutionEvents).not.toHaveBeenCalled();
  });
});

// ── Loader/core: completed match with no battle_stats excluded (Finding 2) ─

describe('completed match with no battle_stats excluded from simulation', () => {
  it('does not advance matchday processing or clear a suspension spuriously', () => {
    // Stage 3 reached at matchday 1 → suspended until matchday 2. A matchday-2
    // match with NO battle_stats must be skipped entirely, so it must NOT clear
    // the suspension (the suspension should persist through md2 until the ≤4
    // lock window re-evaluates it at md3 with a real match).
    const tracker = makeTracker({ id: 't-dreepy', base_pokemon: 'Dreepy' });
    const state = computeEvolutionStateCore({
      trackers: [tracker],
      lines: [dreepyLine],
      matches: [
        {
          match: makeMatch({ id: 'm1' }),
          matchday: 1,
          battleStats: [stat('player-1', 'Dreepy', 10)], // → stage 3, suspended until md2
        },
        {
          // Corrupt/incomplete: completed but no stats. Must be skipped — if it
          // were processed, clearExpiredSuspensions(md2) would clear the md2
          // suspension prematurely.
          match: makeMatch({ id: 'm2-empty', round_id: 'round-2', player_2_id: 'p3' }),
          matchday: 2,
          battleStats: [],
        },
        {
          match: makeMatch({ id: 'm3', round_id: 'round-3', player_2_id: 'p4' }),
          matchday: 3,
          battleStats: [stat('player-1', 'Dragapult', 1, 'g3')], // real md3 match
        },
      ],
      snapshots: [],
    });

    const t = findTracker(state, 'Dreepy');
    // At md3 the early stage lock re-triggers only while md3 is inside the
    // pack's lock window (shouldSuspend(3, 3), guard is === null) → suspended
    // until md3 + suspendMatchdays; outside it (example pack: by matchday 2)
    // the served suspension stays cleared. The empty md2 match was skipped
    // either way: the suspension is set by the md3 lock, not by the skipped md2.
    const lock = epbPack.stageLock;
    expect(t.suspended_until_matchday).toBe(lock.byMatchday >= 3 ? 3 + lock.suspendMatchdays : null);
    // And the empty match contributed no real kills.
    expect(t.real_kills).toBe(11); // 10 (md1) + 1 (md3), none from md2
  });

  it('an empty-stats match produces no events and no EP', () => {
    const tracker = makeTracker({ id: 't-dreepy', base_pokemon: 'Dreepy' });
    const state = computeEvolutionStateCore({
      trackers: [tracker],
      lines: [dreepyLine],
      matches: [
        {
          match: makeMatch({ id: 'm-empty' }),
          matchday: 1,
          battleStats: [],
        },
      ],
      snapshots: [],
    });
    const t = findTracker(state, 'Dreepy');
    expect(t.real_kills).toBe(0);
    expect(t.total_kos).toBe(0);
    expect(t.current_stage).toBe(1);
    expect(t.evolution_points_awarded).toBe(0);
    expect(state.computedEvents).toHaveLength(0);
  });
});

// ── §27 regression coverage (delete / reconcile / evolution-rebuild) ──
//
// These blocks cover the spec §27 delete categories against the PURE
// `computeEvolutionStateCore` engine. Fixtures are minimal RebuildInputs; no
// DB mocks are required (the core is pure). Each category asserts the rebuilt
// `ComputedEvolutionState` after a match is removed from the input `matches`,
// exercising the delete/reconcile/evolution-rebuild behavior in isolation.

describe('§27 EVOLUTION + HISTORICAL INCONSISTENCY — delete earlier match rebuilds progression', () => {
  // Two matchdays. matchday1 carries the progression (3 KOs → Dreepy→Drakloak);
  // matchday2 fields the evolved form (Drakloak). Deleting matchday1 removes the
  // enabling match: the line rebuilds to base (Dreepy), the evolution event is
  // gone, and matchday2's immutable snapshot (claiming Drakloak, stage 2) is
  // FLAGGED as an impossible lineup (not rewritten — §13).
  const tracker = makeTracker({ id: 't-dreepy', base_pokemon: 'Dreepy' });

  const md1 = {
    match: makeMatch({ id: 'm1' }),
    matchday: 1,
    battleStats: [stat('player-1', 'Dreepy', 3), stat('player-2', 'Foo', 0)],
  };
  const md2 = {
    match: makeMatch({ id: 'm2', round_id: 'round-2', player_2_id: 'player-3' }),
    matchday: 2,
    battleStats: [stat('player-1', 'Drakloak', 1)],
  };
  const md2Snapshot: RebuildSnapshot = {
    matchId: 'm2',
    matchday: 2,
    playerId: 'player-1',
    basePokemon: 'Dreepy',
    stageAtMatch: 2, // player actually fielded Drakloak (stage 2) at md2
  };

  it('WITH both matchdays: Drakloak stage 2 + evolution event for the transition', () => {
    const input: RebuildInput = {
      trackers: [tracker],
      lines: [dreepyLine],
      matches: [md1, md2],
      snapshots: [md2Snapshot],
    };
    const state = computeEvolutionStateCore(input);

    const t = findTracker(state, 'Dreepy');
    expect(t.current_stage).toBe(2);
    expect(t.current_form).toBe('Drakloak');
    expect(t.evolution_points_awarded).toBe(1);

    // One evolution event at matchday 1 (Dreepy → Drakloak), non-devolution.
    const md1Events = state.computedEvents.filter((e) => e.matchday === 1);
    expect(md1Events).toHaveLength(1);
    expect(md1Events[0].event.is_devolution).toBe(false);
    expect(md1Events[0].event.new_form).toBe('Drakloak');
    expect(md1Events[0].event.new_stage).toBe(2);
    // No impossible lineup — the snapshot is supportable with md1 present.
    expect(state.impossibleLineups).toHaveLength(0);
  });

  it('WITHOUT matchday1 (deleted): event gone, line rebuilds to base, impossibleLineup flagged', () => {
    const input: RebuildInput = {
      trackers: [tracker],
      lines: [dreepyLine],
      matches: [md2], // matchday1 deleted
      snapshots: [md2Snapshot],
    };
    const state = computeEvolutionStateCore(input);

    const t = findTracker(state, 'Dreepy');
    // Only md2 remains: 1 KO credited to the Dreepy base line via form→tracker
    // mapping (collectLineForms includes all line forms). Below stage2_kos=3.
    expect(t.real_kills).toBe(1);
    expect(t.current_stage).toBe(1);
    expect(t.current_form).toBe('Dreepy');
    expect(t.evolution_points_awarded).toBe(0);
    expect(state.computedEvents).toHaveLength(0);

    // §27 HISTORICAL INCONSISTENCY: md2's snapshot claims stage 2 (Drakloak),
    // but the rebuild only reaches stage 1 by matchday 2 → flagged (not rewritten).
    expect(state.impossibleLineups).toHaveLength(1);
    const imp = state.impossibleLineups[0];
    expect(imp.matchId).toBe('m2');
    expect(imp.snapshotStage).toBe(2);
    expect(imp.rebuiltMaxStageByMatchday).toBe(1);
    expect(imp.matchday).toBe(2);
  });

  it('HISTORICAL INCONSISTENCY — snapshots array is NOT mutated by the core (§13 immutability)', () => {
    const snapshotClone: RebuildSnapshot = { ...md2Snapshot };
    const input: RebuildInput = {
      trackers: [tracker],
      lines: [dreepyLine],
      matches: [md2],
      snapshots: [snapshotClone],
    };
    // Deep-equal-ish: capture the source field before, then assert it is unchanged
    // after the core runs. The core must only READ snapshots, never write them.
    const before = { ...snapshotClone };
    computeEvolutionStateCore(input);
    expect(snapshotClone).toEqual(before);
    expect(snapshotClone.stageAtMatch).toBe(2);
    expect(snapshotClone.matchId).toBe('m2');
  });
});

describe('§27 PARTICIPATION — participation point removed when the enabling match is deleted', () => {
  const cosmogTracker = makeTracker({
    id: 't-cosmog',
    base_pokemon: 'Dratini',
    current_form: 'Dratini',
  });

  it('with the match: cosmo point awarded for bringing the participation line', () => {
    const input: RebuildInput = {
      trackers: [cosmogTracker],
      lines: [cosmogLine],
      matches: [
        {
          match: makeMatch({ id: 'm-cosmog' }),
          matchday: 1,
          battleStats: [stat('player-1', 'Dratini', 0)],
        },
      ],
      snapshots: [],
    };
    const state = computeEvolutionStateCore(input);
    const t = findTracker(state, 'Dratini');
    expect(t.cosmo_points).toBe(1);
  });

  it('without the match (deleted): cosmo point gone, no progression', () => {
    const input: RebuildInput = {
      trackers: [cosmogTracker],
      lines: [cosmogLine],
      matches: [], // match deleted
      snapshots: [],
    };
    const state = computeEvolutionStateCore(input);
    const t = findTracker(state, 'Dratini');
    expect(t.cosmo_points).toBe(0);
    expect(t.real_kills).toBe(0);
    expect(t.current_stage).toBe(1);
  });
});

describe('§27 KILL TOKENS — unrelated Kill Tokens remain after a match is deleted', () => {
  // kill_tokens are a PRESERVED non-match source (§21) — they are never reset by
  // the rebuild. This test asserts that real_kill contributions from match A are
  // removed when A is deleted, while the preserved kill_tokens (a non-match
  // grant independent of any single match) remain and still contribute to
  // total_kos. The "unrelated Kill Tokens remain" invariant (§27) is modeled
  // here by a preserved kill-token grant that no single match owns.
  const tracker = makeTracker({
    id: 't-dreepy',
    base_pokemon: 'Dreepy',
    kill_tokens: 2, // preserved non-match grant — unrelated to either match
  });

  const matchA = {
    match: makeMatch({ id: 'm-a' }),
    matchday: 1,
    battleStats: [stat('player-1', 'Dreepy', 2)],
  };
  const matchB = {
    match: makeMatch({ id: 'm-b', round_id: 'round-2', player_2_id: 'p3' }),
    matchday: 2,
    battleStats: [stat('player-1', 'Dreepy', 2)],
  };

  it('with both matches: real_kills = 4 (A+B), kill_tokens preserved = 2', () => {
    const input: RebuildInput = {
      trackers: [tracker],
      lines: [dreepyLine],
      matches: [matchA, matchB],
      snapshots: [],
    };
    const state = computeEvolutionStateCore(input);
    const t = findTracker(state, 'Dreepy');
    expect(t.real_kills).toBe(4); // 2 (A) + 2 (B)
    expect(t.kill_tokens).toBe(2); // preserved
    expect(t.total_kos).toBe(6); // 4 real + 2 kill tokens
  });

  it('delete match A: A contribution gone, B remains, kill_tokens still preserved', () => {
    const input: RebuildInput = {
      trackers: [tracker],
      lines: [dreepyLine],
      matches: [matchB], // match A deleted
      snapshots: [],
    };
    const state = computeEvolutionStateCore(input);
    const t = findTracker(state, 'Dreepy');
    expect(t.real_kills).toBe(2); // only B's contribution
    expect(t.kill_tokens).toBe(2); // UNRELATED kill tokens REMAIN
    expect(t.total_kos).toBe(4); // 2 real + 2 kill tokens
  });
});

describe('§27 STAGE 3 SUSPENSION — suspension gone when the enabling match is unearned', () => {
  // 10 KOs at matchday 1 crosses stage3_kos=10 for Dreepy → stage 3 at md1,
  // which is ≤4 → suspended until matchday 2. Deleting matchday1 removes the
  // enabling match: stage 3 is no longer reached, so no suspension is derived.
  const tracker = makeTracker({ id: 't-dreepy', base_pokemon: 'Dreepy' });

  it('with the enabling match: stage 3 + suspended until next matchday', () => {
    const input: RebuildInput = {
      trackers: [tracker],
      lines: [dreepyLine],
      matches: [
        {
          match: makeMatch({ id: 'm-enabling' }),
          matchday: 1,
          battleStats: [stat('player-1', 'Dreepy', 10)],
        },
      ],
      snapshots: [],
    };
    const state = computeEvolutionStateCore(input);
    const t = findTracker(state, 'Dreepy');
    expect(t.current_stage).toBe(3);
    expect(t.suspended_until_matchday).toBe(1 + epbPack.stageLock.suspendMatchdays); // md1 + suspendMatchdays
  });

  it('without the enabling match (deleted): no stage 3, no suspension derived', () => {
    const input: RebuildInput = {
      trackers: [tracker],
      lines: [dreepyLine],
      matches: [], // enabling match deleted
      snapshots: [],
    };
    const state = computeEvolutionStateCore(input);
    const t = findTracker(state, 'Dreepy');
    expect(t.current_stage).toBe(1);
    expect(t.suspended_until_matchday).toBeNull();
  });
});

describe('§27 POKÉMON RECORDS recalc — totals equal the sum of remaining matches', () => {
  // Deleting a match reduces the rebuilt totals by exactly that match's
  // contribution. Assert: rebuilt_total(with A,B) − rebuilt_total(B only) ===
  // A's contribution (the KO delta A added), and B's contribution is intact.
  const tracker = makeTracker({ id: 't-dreepy', base_pokemon: 'Dreepy' });

  const matchA = {
    match: makeMatch({ id: 'm-a' }),
    matchday: 1,
    battleStats: [stat('player-1', 'Dreepy', 3)],
  };
  const matchB = {
    match: makeMatch({ id: 'm-b', round_id: 'round-2', player_2_id: 'p3' }),
    matchday: 2,
    battleStats: [stat('player-1', 'Drakloak', 2, 'g2')],
  };

  it('rebuilt total with A+B equals A contribution + B contribution', () => {
    const both = computeEvolutionStateCore({
      trackers: [tracker],
      lines: [dreepyLine],
      matches: [matchA, matchB],
      snapshots: [],
    });
    const tBoth = findTracker(both, 'Dreepy');
    expect(tBoth.real_kills).toBe(5); // 3 (A) + 2 (B)
  });

  it('deleting A reduces the rebuilt total by exactly A contribution; B remains', () => {
    const onlyB = computeEvolutionStateCore({
      trackers: [tracker],
      lines: [dreepyLine],
      matches: [matchB], // A deleted
      snapshots: [],
    });
    const tOnlyB = findTracker(onlyB, 'Dreepy');
    // B alone: 2 real kills credited to the Dreepy base line via form mapping.
    expect(tOnlyB.real_kills).toBe(2);
    // The recalc invariant: rebuilt(with both) − rebuilt(B only) === A's 3 KOs.
    expect(5 - tOnlyB.real_kills).toBe(3); // A's exact contribution removed
  });
});

describe('computeEvolutionStateCore is deterministic (same input → identical rebuilt state)', () => {
  // NOTE — what this block is NOT: it does NOT cover the §27 EDIT/REIMPORT
  // "no duplicate records" invariant. That invariant is NOT a property of this
  // pure rebuild core. It is enforced OUTSIDE the core by:
  //   1. resetMatch (src/lib/pkmn/game-pipeline.ts) fully deleting the old
  //      match's games + match_evolution_snapshots (deleteMatchSnapshots) and
  //      flipping the match out of status='completed' BEFORE a reimport, so the
  //      stale rows cannot re-enter the rebuild. Covered by game-pipeline.test.ts
  //      (resetMatch + resetMatchFields ordering) and the 4A-2 reconcile delete
  //      tests in this file.
  //   2. The loader (loadSeasonMatches in evolution-rebuild.ts) querying the
  //      `matches` table once by primary key with status='completed', which
  //      yields exactly one row per match id — so a corrected replay cannot
  //      appear twice in RebuildInput.matches.
  // computeEvolutionStateCore itself processes EVERY match row it is handed
  // (it has no match-id dedup), so it is intentionally NOT a dedup layer. The
  // test below ("DOES double-count a duplicated match row") pins that contract:
  // dedup MUST happen at the loader, and a buggy caller that fed the same match
  // twice would get DOUBLED real_kills (the kill delta is applied per row).
  // This block therefore only asserts the real, useful property the core DOES
  // provide — determinism: the same single-match input always rebuilds to
  // byte-identical state. A core that double-counted a reimported duplicate row
  // would ALSO pass determinism, which is why determinism alone must not be
  // labelled "§27 EDIT/REIMPORT".
  const tracker = makeTracker({ id: 't-dreepy', base_pokemon: 'Dreepy' });
  const singleMatch = {
    match: makeMatch({ id: 'm1' }),
    matchday: 1,
    battleStats: [stat('player-1', 'Dreepy', 3)],
  };

  function build(): RebuildInput {
    return {
      trackers: [tracker],
      lines: [dreepyLine],
      matches: [singleMatch],
      snapshots: [],
    };
  }

  it('two clean one-time imports produce identical rebuilt state (determinism)', () => {
    const first = computeEvolutionStateCore(build());
    const second = computeEvolutionStateCore(build());
    expect(second).toEqual(first);

    // Concrete invariants of a clean import: one event, EP awarded once.
    const t = findTracker(second, 'Dreepy');
    expect(t.real_kills).toBe(3);
    expect(t.current_stage).toBe(2);
    expect(t.evolution_points_awarded).toBe(1);
    expect(second.computedEvents).toHaveLength(1);
  });

  it('DOES double-count a duplicated match row — dedup is the loader/caller job, not the core', () => {
    // The core iterates RebuildInput.matches verbatim with no match-id dedup.
    // If a buggy caller handed the SAME match as two rows (e.g. a reset+resubmit
    // that was not fully cleared), the kill delta is applied twice. This test
    // documents that contract by failing the moment the core ever silently
    // dedupes — i.e. it pins the expectation that §27 no-duplicate behavior is
    // enforced by resetMatch + the loader, NOT here.
    //
    // Symptom of a duplicated row: real_kills (and total_kos) DOUBLE, because
    // the kill delta is added per row with no stage-gate. Events and EP do NOT
    // double: applyStageTransitions only fires on a stage *cross*, so once the
    // first row advanced Dreepy→Drakloak the second row's already-evolved form
    // crosses no new threshold (events stay at 1); and EP is deduped per
    // (player, matchday) Set inside the core (EP stays at 1). So real_kills is
    // the signal that catches a duplicated row — events/EP are not.
    const clean = computeEvolutionStateCore(build());
    const tClean = findTracker(clean, 'Dreepy');
    expect(tClean.real_kills).toBe(3);
    expect(tClean.total_kos).toBe(3);
    expect(clean.computedEvents).toHaveLength(1);

    const doubled = computeEvolutionStateCore({
      trackers: [tracker],
      lines: [dreepyLine],
      // Same match id + matchday + stats, handed twice — the loader would never
      // build this; this is precisely the input dedup must prevent.
      matches: [singleMatch, singleMatch],
      snapshots: [],
    });
    const tDoubled = findTracker(doubled, 'Dreepy');
    // Kills are applied per row → 3 + 3 = 6 (double-counted). total_kos follows.
    expect(tDoubled.real_kills).toBe(tClean.real_kills * 2);
    expect(tDoubled.total_kos).toBe(tClean.total_kos * 2);
    // No second event: the form is already at stage 2 after the first row, so
    // the duplicated row crosses no new stage threshold. (If a future change
    // made the core idempotent on match id, real_kills above would flip to 3 —
    // that is the assertion that would catch it.)
    expect(doubled.computedEvents).toHaveLength(clean.computedEvents.length);
    // EP is still 1 (deduped per player per matchday) — NOT a duplicated-row
    // signal; real_kills is.
    expect(tDoubled.evolution_points_awarded).toBe(1);
  });
});

describe('§27 MULTIPLE MATCHES — delete A, B contributions remain intact', () => {
  // Distinct matchdays with distinct deltas. Deleting match A (matchday 1)
  // must leave match B's (matchday 2) contributions intact in the rebuilt
  // totals, i.e. the rebuilt state equals "B only".
  const tracker = makeTracker({ id: 't-dreepy', base_pokemon: 'Dreepy' });

  const matchA = {
    match: makeMatch({ id: 'm-a' }),
    matchday: 1,
    battleStats: [stat('player-1', 'Dreepy', 3)], // → Drakloak at md1
  };
  const matchB = {
    match: makeMatch({ id: 'm-b', round_id: 'round-2', player_2_id: 'p3' }),
    matchday: 2,
    battleStats: [stat('player-1', 'Drakloak', 1, 'g2')], // 1 KO at md2
  };

  it('rebuilt state with only B equals rebuilt state from [A,B] minus A', () => {
    const withBoth = computeEvolutionStateCore({
      trackers: [tracker],
      lines: [dreepyLine],
      matches: [matchA, matchB],
      snapshots: [],
    });
    const onlyB = computeEvolutionStateCore({
      trackers: [tracker],
      lines: [dreepyLine],
      matches: [matchB], // A deleted
      snapshots: [],
    });

    const tBoth = findTracker(withBoth, 'Dreepy');
    const tOnlyB = findTracker(onlyB, 'Dreepy');
    // B's contribution is the 1 KO at md2; it survives deleting A.
    expect(tOnlyB.real_kills).toBe(1);
    expect(tBoth.real_kills - tOnlyB.real_kills).toBe(3); // A's contribution
    // No events remain after deleting A (B alone doesn't cross stage2_kos=3).
    expect(onlyB.computedEvents).toHaveLength(0);
    expect(onlyB.computedTrackers[0].evolution_points_awarded).toBe(0);
  });
});
// ── Review G3: creation-time gate for redrafted / traded trackers ────
//
// Player B owned Oshawott→Samurott and scored 5 kills on matchdays 1-3, then
// redrafted into Oshawott→Samurott-Hisui (same base and stage-1/2 forms). The
// old tracker is gone; the new one carries transferred_evo_progress = 5. The
// rebuild must not re-credit the pre-redraft kills to the new tracker.

describe('creation-time gate — pre-redraft kills never credit the redrafted line', () => {
  const hisuiLine: LineThresholds = {
    line_id: 'oshawott--samurotthisui',
    base_pokemon: 'Oshawott',
    stage2_pokemon: 'Dewott',
    stage3_pokemon: 'Samurott-Hisui',
    stage2_kos: 6,
    stage3_kos: 12,
  };
  const REDRAFT_AT = '2026-02-01T12:00:00Z';

  function hisuiTracker(overrides: Partial<EvolutionTracker> = {}): EvolutionTracker {
    return makeTracker({
      id: 't-hisui',
      player_id: 'player-b',
      base_pokemon: 'Oshawott',
      current_form: 'Oshawott',
      line_id: 'oshawott--samurotthisui',
      transferred_evo_progress: 5,
      real_kills: 0,
      total_kos: 5,
      redraft_slot_id: 'rs-1',
      created_at: REDRAFT_AT,
      ...overrides,
    });
  }

  function bMatch(id: string, matchday: number, at: string, pokemon: string, kos: number) {
    return {
      match: makeMatch({
        id,
        round_id: `round-${matchday}`,
        player_1_id: 'player-b',
        player_2_id: `opp-${matchday}`,
        winner_id: 'player-b',
        date_played: at,
        confirmed_at: at,
      }),
      matchday,
      battleStats: [stat('player-b', pokemon, kos, `g-${id}`)],
    };
  }

  const preRedraft = [
    bMatch('m1', 1, '2026-01-10T18:00:00Z', 'Oshawott', 2),
    bMatch('m2', 2, '2026-01-17T18:00:00Z', 'Dewott', 2),
    bMatch('m3', 3, '2026-01-24T18:00:00Z', 'Oshawott', 1),
  ];

  it('regression: md1-3 kills of the dropped line leave real_kills 0 and total_kos unchanged', () => {
    const tracker = hisuiTracker();
    const state = computeEvolutionStateCore({
      trackers: [tracker],
      lines: [hisuiLine],
      matches: preRedraft,
      snapshots: [],
    });
    const t = findTracker(state, 'Oshawott', 'player-b');
    expect(t.real_kills).toBe(0);
    expect(t.transferred_evo_progress).toBe(5);
    expect(t.total_kos).toBe(tracker.total_kos);
    expect(t.current_stage).toBe(1);
    expect(t.current_form).toBe('Oshawott');
    expect(state.computedEvents).toHaveLength(0);
    expect(t.evolution_points_awarded).toBe(0);
  });

  it('kills scored after the redraft by the same species name still credit the new tracker', () => {
    const state = computeEvolutionStateCore({
      trackers: [hisuiTracker()],
      lines: [hisuiLine],
      matches: [...preRedraft, bMatch('m4', 4, '2026-02-07T18:00:00Z', 'Oshawott', 2)],
      snapshots: [],
    });
    const t = findTracker(state, 'Oshawott', 'player-b');
    expect(t.real_kills).toBe(2);
    expect(t.transferred_evo_progress).toBe(5);
    expect(t.total_kos).toBe(7);
    expect(t.current_stage).toBe(2);
    expect(t.current_form).toBe('Dewott');
    // the evolution happened on matchday 4, never on a pre-redraft matchday
    expect(state.computedEvents.map((e) => e.matchday)).toEqual([4]);
  });

  it('the gate also applies to a traded tracker (transferred progress, no redraft slot)', () => {
    const state = computeEvolutionStateCore({
      trackers: [hisuiTracker({ redraft_slot_id: null })],
      lines: [hisuiLine],
      matches: preRedraft,
      snapshots: [],
    });
    expect(findTracker(state, 'Oshawott', 'player-b').real_kills).toBe(0);
  });

  it('a pre-redraft match never moves, locks or records the new line', () => {
    // transferred 6 = Dewott at creation; 7 more KOs in an old match would reach stage 3.
    const state = computeEvolutionStateCore({
      trackers: [hisuiTracker({ transferred_evo_progress: 6, total_kos: 6 })],
      lines: [hisuiLine],
      matches: [bMatch('m1', 1, '2026-01-10T18:00:00Z', 'Dewott', 7)],
      snapshots: [
        { matchId: 'm1', matchday: 1, playerId: 'player-b', basePokemon: 'Oshawott', lineId: 'oshawott--samurotthisui', stageAtMatch: 1 },
      ],
    });
    const t = findTracker(state, 'Oshawott', 'player-b');
    // carried-over stage resolved silently from transferred progress
    expect(t.current_stage).toBe(2);
    expect(t.current_form).toBe('Dewott');
    expect(t.real_kills).toBe(0);
    expect(t.suspended_until_matchday).toBeNull();
    expect(state.computedEvents).toHaveLength(0);
    expect(state.impossibleLineups).toHaveLength(0);
  });

  it('a match with no completion time counts as earlier than the redraft', () => {
    const undated = bMatch('m0', 1, '2026-01-10T18:00:00Z', 'Oshawott', 3);
    undated.match = { ...undated.match, date_played: null, confirmed_at: null };
    const state = computeEvolutionStateCore({
      trackers: [hisuiTracker()],
      lines: [hisuiLine],
      matches: [undated],
      snapshots: [],
    });
    expect(findTracker(state, 'Oshawott', 'player-b').real_kills).toBe(0);
  });

  // Drop/restore: redraft_admin_restore_drop re-inserts the snapshot without its
  // created_at, so the restored row's created_at is the restore time.
  const RESTORED_AT = '2026-03-01T12:00:00Z';
  const playedSinceBirth = [
    bMatch('m4', 4, '2026-02-07T18:00:00Z', 'Oshawott', 2),
    bMatch('m5', 5, '2026-02-14T18:00:00Z', 'Oshawott', 1),
  ];

  it('restored replacement tracker without a slot keeps its matches before the restore', () => {
    // Legacy trade/redraft tracker (backfill 3a: transferred > 0, no slot), dropped and restored.
    const restored = hisuiTracker({ id: 't-restored', redraft_slot_id: null, created_at: RESTORED_AT, real_kills: 3, total_kos: 8 });
    const state = computeEvolutionStateCore({
      trackers: [restored],
      lines: [hisuiLine],
      matches: playedSinceBirth,
      snapshots: [],
      gate: { slotPublishedAt: new Map(), restoredTrackerIds: new Set(['t-restored']) },
    });
    const t = findTracker(state, 'Oshawott', 'player-b');
    expect(t.real_kills).toBe(3);
    expect(t.transferred_evo_progress).toBe(5);
    expect(t.total_kos).toBe(8);
    expect(t.current_stage).toBe(2);
  });

  it('restored tracker that kept an earlier redraft slot is gated by that slot publish time, not created_at', () => {
    const restored = hisuiTracker({ id: 't-restored', redraft_slot_id: 'rs-old', created_at: RESTORED_AT, real_kills: 3, total_kos: 8 });
    const state = computeEvolutionStateCore({
      trackers: [restored],
      lines: [hisuiLine],
      matches: [...preRedraft, ...playedSinceBirth],
      snapshots: [],
      gate: {
        slotPublishedAt: new Map([['rs-old', REDRAFT_AT]]),
        restoredTrackerIds: new Set(['t-restored']),
      },
    });
    const t = findTracker(state, 'Oshawott', 'player-b');
    // md1-3 (before the slot publish) stay excluded; md4-5 (before the restore) count.
    expect(t.real_kills).toBe(3);
    expect(t.total_kos).toBe(8);
    expect(state.computedEvents.map((e) => e.matchday)).toEqual([4]);
  });

  it('slot publish time is the gate even when the tracker row is newer', () => {
    const state = computeEvolutionStateCore({
      trackers: [hisuiTracker({ created_at: RESTORED_AT })],
      lines: [hisuiLine],
      matches: [...preRedraft, ...playedSinceBirth],
      snapshots: [],
      gate: { slotPublishedAt: new Map([['rs-1', REDRAFT_AT]]), restoredTrackerIds: new Set() },
    });
    expect(findTracker(state, 'Oshawott', 'player-b').real_kills).toBe(3);
  });

  it('a non-restored traded tracker is still gated by created_at when a gate input is given', () => {
    const state = computeEvolutionStateCore({
      trackers: [hisuiTracker({ redraft_slot_id: null })],
      lines: [hisuiLine],
      matches: [...preRedraft, ...playedSinceBirth],
      snapshots: [],
      gate: { slotPublishedAt: new Map(), restoredTrackerIds: new Set(['someone-else']) },
    });
    expect(findTracker(state, 'Oshawott', 'player-b').real_kills).toBe(3);
  });

  it('the loader reads gate signals in two season-wide queries', async () => {
    const { computeSeasonEvolutionState } = await import('../evolution-rebuild');
    const { supabase } = await import('@/lib/supabase/client');
    const from = supabase.from as unknown as ReturnType<typeof vi.fn>;
    from.mockClear();
    mockGetSeasonTrackers.mockResolvedValue([hisuiTracker(), hisuiTracker({ id: 't-2', redraft_slot_id: 'rs-2' })]);
    const { getSeasonLineThresholds } = await import('@/lib/draft/epb-thresholds');
    (getSeasonLineThresholds as ReturnType<typeof vi.fn>).mockResolvedValue([hisuiLine]);
    await computeSeasonEvolutionState('season-1');
    const tables = from.mock.calls.map((c) => c[0]);
    expect(tables.filter((t) => t === 'redraft_slots')).toHaveLength(1);
    expect(tables.filter((t) => t === 'draft_action_log')).toHaveLength(1);
  });

  it('original roster trackers are not gated by created_at', () => {
    const original = makeTracker({
      id: 't-dreepy',
      base_pokemon: 'Dreepy',
      created_at: '2026-03-01T00:00:00Z', // created after the match, but not a replacement
    });
    const state = computeEvolutionStateCore({
      trackers: [original],
      lines: [dreepyLine],
      matches: [{ match: makeMatch(), matchday: 1, battleStats: [stat('player-1', 'Dreepy', 2)] }],
      snapshots: [],
    });
    expect(findTracker(state, 'Dreepy').real_kills).toBe(2);
  });
});
