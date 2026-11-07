/**
 * The pairing aids of POST /api/tournaments/[id]/generate-all-rounds: a challenge ladder has no generated round, and a
 * filter over a round robin drops the rejected pairs of every round it writes and opens one `pairing_forbidden` check per
 * round that had any.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({ requireResourceAdmin: vi.fn(), AuthError: class AuthError extends Error {} }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getParticipants: vi.fn(),
  updateTournament: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
  createRoundWithMatches: vi.fn(),
  addMatchesToRound: vi.fn(),
  updateRoundStatus: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByTournament: vi.fn(),
  getPairedMatchRecords: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({
  getGroupsByTournament: vi.fn(),
  createGroupBatch: vi.fn(),
  deleteGroupsByTournament: vi.fn(),
  addGroupMembersBatch: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroups: vi.fn(), seasonHasGroups: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/format-studio/attach', () => ({ assertSeasonFormatAttached: vi.fn() }));
vi.mock('@/lib/format-engine/load', () => ({ loadKitPhase: vi.fn() }));
vi.mock('@/lib/format-engine/pairing-server', () => ({
  loadPairingAids: vi.fn(),
  openForbiddenPairingCheck: vi.fn(),
}));

import { revalidateTag } from 'next/cache';
import { POST } from '@/app/api/tournaments/[id]/generate-all-rounds/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { addMatchesToRound, createRoundWithMatches, getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getMatchesByTournament, getPairedMatchRecords } from '@/lib/supabase/queries/matches';
import { writtenBatches } from '@/test/round-writes';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { getSeasonGroups } from '@/lib/supabase/queries/season-groups';
import { loadKitPhase, type KitPhase } from '@/lib/format-engine/load';
import { loadPairingAids, openForbiddenPairingCheck } from '@/lib/format-engine/pairing-server';
import type { Pairing, Stage } from '@/lib/format-kit/types';

const ID = 'a5cb20ac-a127-482d-855d-d802e29185bc';
const SEASON = 's-1';
const routeParams = { params: Promise.resolve({ id: ID }) };
const PLAYERS = ['p1', 'p2', 'p3', 'p4'];

function phase(pairing: Pairing): KitPhase {
  const stage: Stage = {
    key: 'league',
    name: { en: { v: 'League', s: 'human' }, base: 'en' },
    participants: { from: 'roster', seeding: 'signup' },
    pairing,
    series: { best_of: 1, allow_draw: false, overrides: [] },
    ruleset: { kind: 'season_default' },
    doubles: false,
    players_per_match: 2,
    scoring: { win: 3, loss: 0, bye: 0 },
    rank: [{ kind: 'metric', metric: 'points', direction: 'desc' }],
    columns: [],
  };
  return { engine: 'kit', seed: 'seed-0123456789', stage, outcomes: {}, tableExtras: {} };
}

/** The matches of each written round, in call order. */
function written(): string[][] {
  return writtenBatches(vi.mocked(createRoundWithMatches), vi.mocked(addMatchesToRound)).map((batch) =>
    batch.map((m) => `${m.player_1_id}-${m.player_2_id}`),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
  vi.mocked(getTournamentById).mockResolvedValue({
    id: ID,
    name: 'League',
    bracket_type: 'round_robin',
    status: 'active',
    current_round: 0,
    season_id: SEASON,
    season_format_type: 'custom',
    best_of_default: 1,
    bo_overrides: {},
  } as never);
  vi.mocked(getParticipants).mockResolvedValue(PLAYERS.map((id) => ({ id })) as never);
  vi.mocked(getRoundsByTournament).mockResolvedValue([]);
  vi.mocked(getMatchesByTournament).mockResolvedValue([]);
  vi.mocked(getPairedMatchRecords).mockResolvedValue([]);
  vi.mocked(getGroupsByTournament).mockResolvedValue([]);
  vi.mocked(getSeasonGroups).mockResolvedValue([]);
  vi.mocked(loadPairingAids).mockResolvedValue({});
  vi.mocked(createRoundWithMatches).mockImplementation(async (input) => ({ id: `r-${input.round_number}`, ...input }) as never);
});

describe('generate-all-rounds pairing aids', () => {
  it('refuses a challenge ladder: its matches come from accepted challenges', async () => {
    vi.mocked(loadKitPhase).mockResolvedValue(
      phase({ kind: 'challenge', rounds: 8, rank_range: 3, max_open: 1, cooldown_rounds: 1, accept_window_hours: 72 }),
    );

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('rounds_challenge_ladder');
    expect(createRoundWithMatches).not.toHaveBeenCalled();
    expect(loadPairingAids).not.toHaveBeenCalled();
  });

  it('drops the rejected pairs of every round and opens one check per round', async () => {
    vi.mocked(loadKitPhase).mockResolvedValue(
      phase({ kind: 'filter', base: { kind: 'round_robin', legs: 1, mirror_legs: true }, allow: { k: 'bool', v: true } }),
    );
    // One verdict for any round: a pair with p1 in it is never played, so every round loses exactly one match.
    vi.mocked(loadPairingAids).mockResolvedValue({ allowPairFor: () => (a, b) => a !== 'p1' && b !== 'p1' });

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(201);
    expect(loadPairingAids).toHaveBeenCalledTimes(1);
    expect(loadPairingAids).toHaveBeenCalledWith(expect.objectContaining({ seasonId: SEASON, roundNumber: 1, playerIds: PLAYERS }));

    const rounds = vi.mocked(createRoundWithMatches).mock.calls.map((call) => call[0].round_number);
    expect(rounds).toEqual([1, 2, 3]);
    // A four-player round robin pairs two matches a round; the filter drops p1's match from each.
    expect(written()).toHaveLength(3);
    for (const pairs of written()) {
      expect(pairs).toHaveLength(1);
      expect(pairs[0]).not.toContain('p1');
    }
    expect(vi.mocked(openForbiddenPairingCheck).mock.calls.map((call) => call[0])).toEqual([
      { seasonId: SEASON, stageKey: 'league', round: 1, forbidden: 1 },
      { seasonId: SEASON, stageKey: 'league', round: 2, forbidden: 1 },
      { seasonId: SEASON, stageKey: 'league', round: 3, forbidden: 1 },
    ]);
    expect(revalidateTag).toHaveBeenCalledWith(`tournament:${ID}`, { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(`season:${SEASON}`, { expire: 0 });
  });

  it('opens no check when every pair the filter is asked about is allowed', async () => {
    vi.mocked(loadKitPhase).mockResolvedValue(
      phase({ kind: 'filter', base: { kind: 'round_robin', legs: 1, mirror_legs: true }, allow: { k: 'bool', v: true } }),
    );
    vi.mocked(loadPairingAids).mockResolvedValue({ allowPairFor: () => () => true });

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(201);
    expect(written().flat()).toHaveLength(6);
    expect(openForbiddenPairingCheck).not.toHaveBeenCalled();
  });
});
