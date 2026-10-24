import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/matches', () => ({
  createMatchBatch: vi.fn(),
  deleteMatchesByIds: vi.fn(),
  getMatchesByTournament: vi.fn(),
  updateMatchPlayers: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getGamesByMatch: vi.fn(),
}));

import {
  buildSlotResolutionsFromMatches,
  findMatchForSlot,
  findSlotForMatch,
  materializeReadySlots,
  propagateBracketOnMatchComplete,
  repairBracket,
  syncBracketResetSetting,
  unpropagateBracketOnMatchReset,
  type SlotResolution,
} from '../bracket-propagation';
import {
  buildBracketStructureForParticipants,
  buildDoubleElimStructure,
  buildSingleElimStructure,
} from '../bracket-structure';
import {
  createMatchBatch,
  deleteMatchesByIds,
  getMatchesByTournament,
  updateMatchPlayers,
} from '@/lib/supabase/queries/matches';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getGamesByMatch } from '@/lib/supabase/queries/games';
import type { MatchWithPlayers } from '@/types/match';
import type { ParticipantWithSeed, Tournament } from '@/types/tournament';
import type { Round } from '@/types/round';

interface Store {
  matches: MatchWithPlayers[];
  rounds: Round[];
  nextId: number;
}

function makeParticipants(n: number, lbStarterIds: string[] = []): ParticipantWithSeed[] {
  const lb = new Set(lbStarterIds);
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    seed: i + 1,
    starting_bracket: lb.has(`p${i + 1}`) ? 'losers' : 'winners',
    discord_id: null,
    auth_user_id: null,
    ps_username: '',
    champions_username: '',
    is_admin: false,
    is_creator: false,
    is_guest: false,
    is_test_account: false,
    joined_date: null,
    avatar_url: null,
    avatar_config: null,
    status: 'active',
    suspended_until: null,
    ban_reason: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }));
}

function makeTournament(bracketType: 'single_elim' | 'double_elim'): Tournament {
  return {
    id: 't1',
    name: 'Test Cup',
    description: '',
    season_id: null,
    bracket_type: bracketType,
    ruleset_id: 'ruleset-1',
    best_of_default: 3,
    bo_overrides: {},
    is_doubles: false,
    team_visibility: 'hidden_until_match',
    status: 'active',
    current_round: 1,
    stage_order: 1,
    advancement_rule: null,
    enrollment_source: null,
    archived: false,
    legacy: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function makeMatch(partial: {
  id: string;
  round_id: string;
  player_1_id: string;
  player_2_id: string;
  bracket_side?: MatchWithPlayers['bracket_side'];
  bracket_pos?: number | null;
  status?: MatchWithPlayers['status'];
  winner_id?: string | null;
  games?: MatchWithPlayers['games'];
}): MatchWithPlayers {
  return {
    id: partial.id,
    round_id: partial.round_id,
    tournament_id: 't1',
    player_1_id: partial.player_1_id,
    player_2_id: partial.player_2_id,
    winner_id: partial.winner_id ?? null,
    status: partial.status ?? 'scheduled',
    submitter_id: null,
    date_played: null,
    scheduled_at: null,
    auto_confirm_at: null,
    confirmed_at: null,
    notes: '',
    social_image_url: null,
    bracket_side: partial.bracket_side ?? null,
    bracket_pos: partial.bracket_pos ?? null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    player_1_name: '',
    player_2_name: '',
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_name: null,
    round_status: 'pending',
    games: partial.games ?? [],
  };
}

function setupStore(structure: ReturnType<typeof buildSingleElimStructure>): Store {
  const store: Store = {
    matches: [],
    rounds: structure.rounds.map((r) => ({
      id: `round-${r.round_number}`,
      tournament_id: 't1',
      name: r.name,
      round_number: r.round_number,
      best_of: 3,
      status: 'pending',
      pairings_generated: true,
      deadline: null,
      bracket_side: r.bracket_side,
      bye_player_ids: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })),
    nextId: 1,
  };

  vi.mocked(getRoundsByTournament).mockImplementation(async () => store.rounds);
  vi.mocked(getMatchesByTournament).mockImplementation(async () => [...store.matches]);
  vi.mocked(createMatchBatch).mockImplementation(async (inputs) => {
    return inputs.map((input) => {
      const created = makeMatch({
        id: `m-${store.nextId++}`,
        round_id: input.round_id,
        player_1_id: input.player_1_id,
        player_2_id: input.player_2_id,
        bracket_side: (input.bracket_side as MatchWithPlayers['bracket_side']) ?? null,
        bracket_pos: input.bracket_pos ?? null,
      });
      store.matches.push(created);
      return created;
    });
  });
  vi.mocked(updateMatchPlayers).mockImplementation(async (id, p1, p2) => {
    const idx = store.matches.findIndex((m) => m.id === id);
    if (idx < 0) throw new Error(`match ${id} missing`);
    store.matches[idx] = {
      ...store.matches[idx],
      player_1_id: p1,
      player_2_id: p2,
      winner_id: null,
      status: 'scheduled',
    };
    return store.matches[idx];
  });
  vi.mocked(deleteMatchesByIds).mockImplementation(async (ids) => {
    store.matches = store.matches.filter((m) => !ids.includes(m.id));
  });
  vi.mocked(getGamesByMatch).mockImplementation(async (id) => {
    const summaries = store.matches.find((m) => m.id === id)?.games ?? [];
    // getGamesByMatch returns full Game rows — widen the stored GameSummary
    // fixtures with the fields Game adds.
    return summaries.map((g) => ({
      ...g,
      match_id: id,
      replay_hash: null,
      parsed: true,
      exclude_all_time: false,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }));
  });

  return store;
}

function roundIdMap(store: Store): Map<number, string> {
  return new Map(store.rounds.map((r) => [r.round_number, r.id]));
}

function assertNoSelfMatches(matches: MatchWithPlayers[]): void {
  for (const match of matches) {
    expect(match.player_1_id).not.toBe(match.player_2_id);
  }
}

function pairingKey(match: MatchWithPlayers): string {
  return [match.player_1_id, match.player_2_id].sort().join('|');
}

async function materializeInitial(
  store: Store,
  tournament: Tournament,
  participants: ParticipantWithSeed[],
  structure: ReturnType<typeof buildSingleElimStructure>
): Promise<void> {
  await materializeReadySlots(
    tournament.id,
    tournament,
    participants,
    structure,
    roundIdMap(store),
    store.matches,
    new Map()
  );
}

async function completeAndPropagate(
  store: Store,
  matchId: string,
  winnerId: string,
  tournament: Tournament,
  participants: ParticipantWithSeed[]
): Promise<void> {
  const match = store.matches.find((m) => m.id === matchId);
  if (!match) throw new Error(`match ${matchId} missing`);
  match.status = 'completed';
  match.winner_id = winnerId;
  await propagateBracketOnMatchComplete(match, tournament, participants);
}

function findMatchByPlayers(
  store: Store,
  a: string,
  b: string
): MatchWithPlayers | undefined {
  const key = [a, b].sort().join('|');
  const matches = store.matches.filter((m) => pairingKey(m) === key);
  return matches.find((m) => m.status === 'scheduled') ?? matches[0];
}

describe('findSlotForMatch / findMatchForSlot', () => {
  it('round-trips a slot to its materialized match', () => {
    const structure = buildSingleElimStructure(4);
    const slot = structure.slots[0];
    const match = makeMatch({
      id: 'm-1',
      round_id: 'round-1',
      player_1_id: 'p1',
      player_2_id: 'p4',
      bracket_side: slot.bracket_side,
      bracket_pos: slot.bracket_pos,
    });
    const foundSlot = findSlotForMatch(
      structure.slots,
      slot.global_round_number,
      match.bracket_side,
      match.bracket_pos
    );
    expect(foundSlot?.slotKey).toBe(slot.slotKey);

    const foundMatch = findMatchForSlot(
      [match],
      new Map([[slot.global_round_number, 'round-1']]),
      slot
    );
    expect(foundMatch?.id).toBe('m-1');
  });
});

describe('false-bye regression (5/6/7 SE out of order)', () => {
  it.each([5, 6, 7])(
    'does not crown an unplayed player when a non-bye R1 match completes first (n=%i)',
    async (n) => {
      const structure = buildSingleElimStructure(n);
      const store = setupStore(structure);
      const tournament = makeTournament('single_elim');
      const participants = makeParticipants(n);
      await materializeInitial(store, tournament, participants, structure);

      const finalsSlot = structure.slots.find((s) => s.round_name === 'Finals');
      expect(finalsSlot).toBeDefined();

      const r1Matches = store.matches.filter((m) => m.round_id === 'round-1');
      expect(r1Matches.length).toBeGreaterThan(0);
      const first = r1Matches[0];

      await completeAndPropagate(store, first.id, first.player_1_id, tournament, participants);

      assertNoSelfMatches(store.matches);
      expect(store.matches.filter((m) => m.status === 'completed')).toHaveLength(1);

      const finalsMatch = findMatchForSlot(store.matches, roundIdMap(store), finalsSlot!);
      expect(finalsMatch).toBeUndefined();

      const crowned = store.matches.some(
        (m) => m.status === 'completed' && m.round_id !== first.round_id
      );
      expect(crowned).toBe(false);
    }
  );
});

describe('4-player DE hand-sim', () => {
  it('plays through WB-finals loser winning the drop-in without X-vs-X', async () => {
    const structure = buildDoubleElimStructure(4);
    const store = setupStore(structure);
    const tournament = makeTournament('double_elim');
    const participants = makeParticipants(4);
    await materializeInitial(store, tournament, participants, structure);

    const m14 = findMatchByPlayers(store, 'p1', 'p4');
    const m23 = findMatchByPlayers(store, 'p2', 'p3');
    expect(m14 && m23).toBeTruthy();

    await completeAndPropagate(store, m14!.id, 'p1', tournament, participants);
    await completeAndPropagate(store, m23!.id, 'p2', tournament, participants);
    assertNoSelfMatches(store.matches);

    const lbR1 = findMatchByPlayers(store, 'p4', 'p3');
    expect(lbR1).toBeDefined();
    await completeAndPropagate(store, lbR1!.id, 'p4', tournament, participants);

    const wbFinal = findMatchByPlayers(store, 'p1', 'p2');
    expect(wbFinal).toBeDefined();
    await completeAndPropagate(store, wbFinal!.id, 'p1', tournament, participants);

    const losersFinals = findMatchByPlayers(store, 'p4', 'p2');
    expect(losersFinals).toBeDefined();
    await completeAndPropagate(store, losersFinals!.id, 'p2', tournament, participants);

    const gf = findMatchByPlayers(store, 'p1', 'p2');
    const gfSlot = structure.slots.find((s) => s.bracket_side === 'grand_finals');
    const gfMatch = findMatchForSlot(store.matches, roundIdMap(store), gfSlot!);
    expect(gfMatch).toBeDefined();
    expect(gfMatch?.id).not.toBe(wbFinal!.id);
    expect([gfMatch?.player_1_id, gfMatch?.player_2_id].sort()).toEqual(['p1', 'p2']);
    expect(gf).toBeDefined();
    assertNoSelfMatches(store.matches);
  });
});

describe('8-player DE hand-sim', () => {
  it('avoids same-index rematch when the WB semis favorite drops', async () => {
    const structure = buildDoubleElimStructure(8);
    const store = setupStore(structure);
    const tournament = makeTournament('double_elim');
    const participants = makeParticipants(8);
    await materializeInitial(store, tournament, participants, structure);

    const r1: Array<[string, string, string]> = [
      ['p1', 'p8', 'p1'],
      ['p4', 'p5', 'p4'],
      ['p3', 'p6', 'p3'],
      ['p2', 'p7', 'p2'],
    ];
    for (const [a, b, winner] of r1) {
      const match = findMatchByPlayers(store, a, b);
      expect(match).toBeDefined();
      await completeAndPropagate(store, match!.id, winner, tournament, participants);
    }
    assertNoSelfMatches(store.matches);

    const lbA = findMatchByPlayers(store, 'p8', 'p5');
    const lbB = findMatchByPlayers(store, 'p6', 'p7');
    expect(lbA && lbB).toBeTruthy();
    await completeAndPropagate(store, lbA!.id, 'p8', tournament, participants);
    await completeAndPropagate(store, lbB!.id, 'p6', tournament, participants);

    const semiA = findMatchByPlayers(store, 'p1', 'p4');
    const semiB = findMatchByPlayers(store, 'p3', 'p2');
    expect(semiA && semiB).toBeTruthy();
    await completeAndPropagate(store, semiA!.id, 'p4', tournament, participants);
    await completeAndPropagate(store, semiB!.id, 'p2', tournament, participants);

    const dropInRematch = store.matches.filter(
      (m) => pairingKey(m) === 'p1|p8' && m.status === 'scheduled'
    );
    expect(dropInRematch).toHaveLength(0);

    const dropP1 = findMatchByPlayers(store, 'p1', 'p6');
    expect(dropP1).toBeDefined();
    expect(findMatchByPlayers(store, 'p8', 'p3')).toBeDefined();
    assertNoSelfMatches(store.matches);

    await completeAndPropagate(store, dropP1!.id, 'p1', tournament, participants);
    const otherDrop = findMatchByPlayers(store, 'p8', 'p3')!;
    await completeAndPropagate(store, otherDrop.id, 'p8', tournament, participants);

    const consol = findMatchByPlayers(store, 'p1', 'p8');
    expect(consol).toBeDefined();
    await completeAndPropagate(store, consol!.id, 'p1', tournament, participants);

    const wbFinal = findMatchByPlayers(store, 'p4', 'p2');
    expect(wbFinal).toBeDefined();
    await completeAndPropagate(store, wbFinal!.id, 'p4', tournament, participants);

    const losersFinals = findMatchByPlayers(store, 'p1', 'p2');
    expect(losersFinals).toBeDefined();
    await completeAndPropagate(store, losersFinals!.id, 'p1', tournament, participants);

    const gfSlot = structure.slots.find((s) => s.bracket_side === 'grand_finals');
    const gf = findMatchForSlot(store.matches, roundIdMap(store), gfSlot!);
    expect(gf).toBeDefined();
    expect([gf?.player_1_id, gf?.player_2_id].sort()).toEqual(['p1', 'p4']);
    assertNoSelfMatches(store.matches);
  });
});

describe('force-complete from in_progress', () => {
  it('propagates when the stored row still has a null winner', async () => {
    const structure = buildSingleElimStructure(5);
    const store = setupStore(structure);
    const tournament = makeTournament('single_elim');
    const participants = makeParticipants(5);
    await materializeInitial(store, tournament, participants, structure);

    const r1 = store.matches.find((m) => m.round_id === 'round-1');
    expect(r1).toBeDefined();
    r1!.status = 'in_progress';
    r1!.winner_id = null;

    await propagateBracketOnMatchComplete(
      { ...r1!, winner_id: r1!.player_1_id, status: 'completed' },
      tournament,
      participants
    );

    const downstream = store.matches.filter((m) => m.round_id !== 'round-1');
    expect(downstream.length).toBeGreaterThan(0);
    assertNoSelfMatches(store.matches);
  });
});

describe('reset then re-complete', () => {
  it('un-materializes downstream and re-creates after re-complete', async () => {
    const structure = buildSingleElimStructure(4);
    const store = setupStore(structure);
    const tournament = makeTournament('single_elim');
    const participants = makeParticipants(4);
    await materializeInitial(store, tournament, participants, structure);

    const first = store.matches.find((m) => m.round_id === 'round-1')!;
    const second = store.matches.find((m) => m.round_id === 'round-1' && m.id !== first.id)!;
    await completeAndPropagate(store, first.id, first.player_1_id, tournament, participants);
    await completeAndPropagate(store, second.id, second.player_1_id, tournament, participants);

    const finalsBefore = store.matches.filter((m) => m.round_id !== 'round-1');
    expect(finalsBefore.length).toBeGreaterThan(0);
    const finalsIds = finalsBefore.map((m) => m.id);

    const deleted = await unpropagateBracketOnMatchReset(first, tournament, participants);
    expect(deleted.length).toBeGreaterThan(0);
    expect(store.matches.some((m) => finalsIds.includes(m.id))).toBe(false);

    first.status = 'completed';
    first.winner_id = first.player_1_id;
    await propagateBracketOnMatchComplete(first, tournament, participants);
    expect(store.matches.some((m) => m.round_id !== 'round-1')).toBe(true);
  });
});

describe('materializeReadySlots safety', () => {
  it('refuses to rewrite a played match and logs a conflict', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const structure = buildSingleElimStructure(4);
    const store = setupStore(structure);
    const tournament = makeTournament('single_elim');
    const participants = makeParticipants(4);
    await materializeInitial(store, tournament, participants, structure);

    const existing = store.matches[0];
    existing.player_1_id = 'intruder';
    existing.status = 'completed';
    existing.winner_id = existing.player_2_id;
    existing.games = [
      {
        id: 'g-1',
        game_number: 1,
        winner_id: existing.player_1_id,
        replay_url: '',
        source: 'manual',
        stats_locked: false,
      },
    ];

    const slot = structure.slots[0];
    const resolutions = buildSlotResolutionsFromMatches(
      structure.slots,
      store.matches,
      new Map(store.rounds.map((r) => [r.id, r.round_number]))
    );
    await materializeReadySlots(
      tournament.id,
      tournament,
      participants,
      structure,
      roundIdMap(store),
      store.matches,
      resolutions
    );

    expect(updateMatchPlayers).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tournamentId: 't1',
        slotKey: slot.slotKey,
        matchId: existing.id,
        status: 'completed',
      })
    );
    errorSpy.mockRestore();
  });
});

describe('8-player DE with 2 LB starters', () => {
  it('keeps LB starters out of Winners Round 1 and plays through Grand Finals', async () => {
    const participants = makeParticipants(8, ['p7', 'p8']);
    const structure = buildBracketStructureForParticipants('double_elim', participants);
    expect(structure).toBeTruthy();
    const store = setupStore(structure!);
    const tournament = makeTournament('double_elim');
    await materializeInitial(store, tournament, participants, structure!);

    const wbR1Ids = new Set(
      store.matches
        .filter((m) => m.round_id === 'round-1')
        .flatMap((m) => [m.player_1_id, m.player_2_id])
    );
    expect(wbR1Ids.has('p7')).toBe(false);
    expect(wbR1Ids.has('p8')).toBe(false);

    const gfSlot = structure!.slots.find((s) => s.bracket_side === 'grand_finals');
    expect(gfSlot).toBeDefined();

    for (let i = 0; i < 24; i++) {
      const gf = findMatchForSlot(store.matches, roundIdMap(store), gfSlot!);
      if (gf) break;
      const scheduled = store.matches.filter((m) => m.status === 'scheduled');
      if (scheduled.length === 0) break;
      for (const match of scheduled) {
        if (match.status !== 'scheduled') continue;
        await completeAndPropagate(
          store,
          match.id,
          match.player_1_id,
          tournament,
          participants
        );
      }
      assertNoSelfMatches(store.matches);
    }

    const gf = findMatchForSlot(store.matches, roundIdMap(store), gfSlot!);
    expect(gf).toBeDefined();
    expect(gf?.player_1_id).not.toBe(gf?.player_2_id);
    const lbMatches = store.matches.filter((m) => m.bracket_side === 'losers');
    expect(lbMatches.some((m) => m.player_1_id === 'p7' || m.player_2_id === 'p7' || m.player_1_id === 'p8' || m.player_2_id === 'p8')).toBe(true);
  });

  it('un-materializes downstream after resetting a match on an LB-start bracket', async () => {
    const participants = makeParticipants(8, ['p7', 'p8']);
    const structure = buildBracketStructureForParticipants('double_elim', participants);
    const store = setupStore(structure!);
    const tournament = makeTournament('double_elim');
    await materializeInitial(store, tournament, participants, structure!);

    const first = store.matches.find((m) => m.round_id === 'round-1');
    expect(first).toBeDefined();
    await completeAndPropagate(store, first!.id, first!.player_1_id, tournament, participants);

    const afterComplete = store.matches.length;
    expect(afterComplete).toBeGreaterThan(store.matches.filter((m) => m.round_id === 'round-1').length);

    const deleted = await unpropagateBracketOnMatchReset(first!, tournament, participants);
    expect(deleted.length).toBeGreaterThan(0);
    expect(store.matches.some((m) => deleted.includes(m.id))).toBe(false);
  });
});

describe('bracket reset ("if necessary")', () => {
  it('materializes the reset when the Losers Bracket champion wins the Grand Finals', async () => {
    const participants = makeParticipants(8, ['p7', 'p8']);
    const structure = buildBracketStructureForParticipants('double_elim', participants)!;
    const store = setupStore(structure);
    const tournament = makeTournament('double_elim');

    const gf = structure.slots.find(
      (s) => s.bracket_side === 'grand_finals' && !s.isBracketReset
    )!;
    const reset = structure.slots.find(
      (s) => s.bracket_side === 'grand_finals' && s.isBracketReset
    )!;
    const wbFinalKey = gf.feeder1.slotKey!;

    // WB final: p1 (undefeated) wins. Grand Finals: the LB champion (p7) wins,
    // handing p1 their first loss — the reset must be played.
    const resolutions = new Map<string, SlotResolution>([
      [wbFinalKey, { winnerId: 'p1', loserId: 'p2', via: 'match' }],
      [gf.slotKey, { winnerId: 'p7', loserId: 'p1', via: 'match' }],
    ]);

    await materializeReadySlots(
      tournament.id,
      tournament,
      participants,
      structure,
      roundIdMap(store),
      store.matches,
      resolutions
    );

    const resetMatch = findMatchForSlot(store.matches, roundIdMap(store), reset);
    expect(resetMatch).toBeDefined();
    expect([resetMatch!.player_1_id, resetMatch!.player_2_id].sort()).toEqual(['p1', 'p7']);
  });

  it('skips the reset when the Winners Bracket champion wins the Grand Finals', async () => {
    const participants = makeParticipants(8, ['p7', 'p8']);
    const structure = buildBracketStructureForParticipants('double_elim', participants)!;
    const store = setupStore(structure);
    const tournament = makeTournament('double_elim');

    const gf = structure.slots.find(
      (s) => s.bracket_side === 'grand_finals' && !s.isBracketReset
    )!;
    const reset = structure.slots.find(
      (s) => s.bracket_side === 'grand_finals' && s.isBracketReset
    )!;
    const wbFinalKey = gf.feeder1.slotKey!;

    // WB final: p1 wins. Grand Finals: p1 wins again — no reset needed.
    const resolutions = new Map<string, SlotResolution>([
      [wbFinalKey, { winnerId: 'p1', loserId: 'p2', via: 'match' }],
      [gf.slotKey, { winnerId: 'p1', loserId: 'p7', via: 'match' }],
    ]);

    await materializeReadySlots(
      tournament.id,
      tournament,
      participants,
      structure,
      roundIdMap(store),
      store.matches,
      resolutions
    );

    expect(findMatchForSlot(store.matches, roundIdMap(store), reset)).toBeUndefined();
  });
});

describe('bracket reset toggle on standard all-WB DE (no LB starters)', () => {
  it('materializes the reset when the Losers Bracket champion wins the Grand Finals', async () => {
    const participants = makeParticipants(8);
    const structure = buildBracketStructureForParticipants('double_elim', participants)!;
    const store = setupStore(structure);
    const tournament = makeTournament('double_elim');

    const gf = structure.slots.find(
      (s) => s.bracket_side === 'grand_finals' && !s.isBracketReset
    )!;
    const reset = structure.slots.find(
      (s) => s.bracket_side === 'grand_finals' && s.isBracketReset
    )!;
    const wbFinalKey = gf.feeder1.slotKey!;

    const resolutions = new Map<string, SlotResolution>([
      [wbFinalKey, { winnerId: 'p1', loserId: 'p2', via: 'match' }],
      [gf.slotKey, { winnerId: 'p7', loserId: 'p1', via: 'match' }],
    ]);

    await materializeReadySlots(
      tournament.id,
      tournament,
      participants,
      structure,
      roundIdMap(store),
      store.matches,
      resolutions
    );

    const resetMatch = findMatchForSlot(store.matches, roundIdMap(store), reset);
    expect(resetMatch).toBeDefined();
    expect([resetMatch!.player_1_id, resetMatch!.player_2_id].sort()).toEqual(['p1', 'p7']);
  });

  it('skips the reset when the WB champion wins the Grand Finals', async () => {
    const participants = makeParticipants(8);
    const structure = buildBracketStructureForParticipants('double_elim', participants)!;
    const store = setupStore(structure);
    const tournament = makeTournament('double_elim');

    const gf = structure.slots.find(
      (s) => s.bracket_side === 'grand_finals' && !s.isBracketReset
    )!;
    const reset = structure.slots.find(
      (s) => s.bracket_side === 'grand_finals' && s.isBracketReset
    )!;
    const wbFinalKey = gf.feeder1.slotKey!;

    const resolutions = new Map<string, SlotResolution>([
      [wbFinalKey, { winnerId: 'p1', loserId: 'p2', via: 'match' }],
      [gf.slotKey, { winnerId: 'p1', loserId: 'p7', via: 'match' }],
    ]);

    await materializeReadySlots(
      tournament.id,
      tournament,
      participants,
      structure,
      roundIdMap(store),
      store.matches,
      resolutions
    );

    expect(findMatchForSlot(store.matches, roundIdMap(store), reset)).toBeUndefined();
  });

  it('builds no reset slot when bracketResetEnabled is false', async () => {
    const participants = makeParticipants(8);
    const structure = buildBracketStructureForParticipants('double_elim', participants, {
      bracketResetEnabled: false,
    })!;
    expect(structure.slots.some((s) => s.isBracketReset)).toBe(false);

    const store = setupStore(structure);
    const tournament = makeTournament('double_elim');

    const gf = structure.slots.find((s) => s.bracket_side === 'grand_finals')!;
    const wbFinalKey = gf.feeder1.slotKey!;
    const lbFinalKey = gf.feeder2.slotKey!;
    const resolutions = new Map<string, SlotResolution>([
      [wbFinalKey, { winnerId: 'p1', loserId: 'p2', via: 'match' }],
      [lbFinalKey, { winnerId: 'p7', loserId: 'p8', via: 'match' }],
      [gf.slotKey, { winnerId: 'p7', loserId: 'p1', via: 'match' }],
    ]);

    await materializeReadySlots(
      tournament.id,
      tournament,
      participants,
      structure,
      roundIdMap(store),
      store.matches,
      resolutions
    );

    // Grand Finals materializes (both feeders resolved) — but no reset match.
    const gfMatches = store.matches.filter((m) => m.bracket_side === 'grand_finals');
    expect(gfMatches).toHaveLength(1);
    expect([gfMatches[0].player_1_id, gfMatches[0].player_2_id].sort()).toEqual(['p1', 'p7']);
  });
});

describe('syncBracketResetSetting', () => {
  it('deletes scheduled reset matches when disabled', async () => {
    const participants = makeParticipants(8);
    const structure = buildBracketStructureForParticipants('double_elim', participants)!;
    const store = setupStore(structure);
    const tournament = makeTournament('double_elim');

    const gf = structure.slots.find(
      (s) => s.bracket_side === 'grand_finals' && !s.isBracketReset
    )!;
    const reset = structure.slots.find(
      (s) => s.bracket_side === 'grand_finals' && s.isBracketReset
    )!;
    const wbFinalKey = gf.feeder1.slotKey!;
    const resolutions = new Map<string, SlotResolution>([
      [wbFinalKey, { winnerId: 'p1', loserId: 'p2', via: 'match' }],
      [gf.slotKey, { winnerId: 'p7', loserId: 'p1', via: 'match' }],
    ]);
    await materializeReadySlots(
      tournament.id,
      tournament,
      participants,
      structure,
      roundIdMap(store),
      store.matches,
      resolutions
    );
    expect(findMatchForSlot(store.matches, roundIdMap(store), reset)).toBeDefined();

    const result = await syncBracketResetSetting(
      { ...tournament, bracket_reset_enabled: false },
      participants
    );
    expect(result.reset_matches_removed).toBe(1);
    expect(findMatchForSlot(store.matches, roundIdMap(store), reset)).toBeUndefined();
  });

  it('materializes a decidable reset when enabled after the fact', async () => {
    const participants = makeParticipants(4);
    const structure = buildBracketStructureForParticipants('double_elim', participants, {
      bracketResetEnabled: false,
    })!;
    const store = setupStore(structure);
    const tournament = { ...makeTournament('double_elim'), bracket_reset_enabled: false };
    await materializeInitial(store, tournament, participants, structure);

    const m14 = findMatchByPlayers(store, 'p1', 'p4');
    const m23 = findMatchByPlayers(store, 'p2', 'p3');
    expect(m14 && m23).toBeTruthy();
    await completeAndPropagate(store, m14!.id, 'p1', tournament, participants);
    await completeAndPropagate(store, m23!.id, 'p2', tournament, participants);

    const lbR1 = findMatchByPlayers(store, 'p4', 'p3');
    expect(lbR1).toBeDefined();
    await completeAndPropagate(store, lbR1!.id, 'p4', tournament, participants);

    const wbFinal = findMatchByPlayers(store, 'p1', 'p2');
    expect(wbFinal).toBeDefined();
    await completeAndPropagate(store, wbFinal!.id, 'p1', tournament, participants);

    const losersFinals = findMatchByPlayers(store, 'p4', 'p2');
    expect(losersFinals).toBeDefined();
    await completeAndPropagate(store, losersFinals!.id, 'p2', tournament, participants);

    const gfSlot = structure.slots.find((s) => s.bracket_side === 'grand_finals')!;
    const gfMatch = findMatchForSlot(store.matches, roundIdMap(store), gfSlot);
    expect(gfMatch).toBeDefined();
    // Losers Bracket champion (p2) wins the Grand Finals — reset becomes necessary.
    await completeAndPropagate(store, gfMatch!.id, 'p2', tournament, participants);

    const enabledStructure = buildBracketStructureForParticipants('double_elim', participants)!;
    const resetSlot = enabledStructure.slots.find(
      (s) => s.bracket_side === 'grand_finals' && s.isBracketReset
    )!;
    expect(findMatchForSlot(store.matches, roundIdMap(store), resetSlot)).toBeUndefined();

    const result = await syncBracketResetSetting(
      { ...tournament, bracket_reset_enabled: true },
      participants
    );
    expect(result.slots_materialized).toBeGreaterThanOrEqual(1);

    const resetMatch = findMatchForSlot(store.matches, roundIdMap(store), resetSlot);
    expect(resetMatch).toBeDefined();
    expect([resetMatch!.player_1_id, resetMatch!.player_2_id].sort()).toEqual(['p1', 'p2']);
  });
});

describe('repairBracket', () => {
  it('re-materializes ready slots from current match results', async () => {
    const structure = buildSingleElimStructure(4);
    const store = setupStore(structure);
    const tournament = makeTournament('single_elim');
    const participants = makeParticipants(4);
    await materializeInitial(store, tournament, participants, structure);

    const first = store.matches[0];
    first.status = 'completed';
    first.winner_id = first.player_1_id;

    const before = store.matches.length;
    const result = await repairBracket(tournament, participants);
    expect(result.slots_materialized).toBeGreaterThanOrEqual(0);
    expect(store.matches.length).toBeGreaterThanOrEqual(before);
  });
});
