/**
 * The pairing aids of POST /api/generate-round/[tid]: a filter stage pairs by its `allow` expression (a rejected pair is
 * dropped and the round opens a `pairing_forbidden` check), a bipartite stage pairs side A against side B, a challenge
 * ladder has no generated round, and a league that does not run a kit format reads no aid at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
  AuthError: class AuthError extends Error {},
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getParticipants: vi.fn(),
  updateTournament: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn(), updateSeason: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
  createRound: vi.fn(),
  updateRoundByePlayers: vi.fn(),
  updateRoundStatus: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  createMatchBatch: vi.fn(),
  getCompletedMatchRecords: vi.fn(),
  getPairedMatchRecords: vi.fn(),
  getMatchesByTournament: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({
  getGroupsByTournament: vi.fn(),
  createGroupBatch: vi.fn(),
  deleteGroupsByTournament: vi.fn(),
  addGroupMembersBatch: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroups: vi.fn(), seasonHasGroups: vi.fn() }));
vi.mock('@/lib/tournament', () => ({ generateRound: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/discord/notify', () => ({ emitDiscordEvent: vi.fn() }));
vi.mock('@/lib/social/notify', () => ({ emitSocialEvent: vi.fn() }));
vi.mock('@/lib/ai/trigger', () => ({ triggerTournamentReport: vi.fn() }));
vi.mock('@/lib/feature-flags', () => ({ ENABLE_KALE_CABBAGE: false }));
vi.mock('@/lib/format-studio/attach', () => ({ assertSeasonFormatAttached: vi.fn() }));
vi.mock('@/lib/format-engine/load', () => ({ loadKitPhase: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/hooks', () => ({ onRoundGenerated: vi.fn() }));
vi.mock('@/lib/format-engine/pairing-server', () => ({
  loadPairingAids: vi.fn(),
  openForbiddenPairingCheck: vi.fn(),
}));

import { revalidateTag } from 'next/cache';
import { POST } from '@/app/api/generate-round/[tid]/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { createRound, getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import {
  createMatchBatch,
  getCompletedMatchRecords,
  getMatchesByTournament,
  getPairedMatchRecords,
} from '@/lib/supabase/queries/matches';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { getSeasonGroups } from '@/lib/supabase/queries/season-groups';
import { generateRound } from '@/lib/tournament';
import { logAuditEvent } from '@/lib/audit/log';
import { loadKitPhase, type KitPhase } from '@/lib/format-engine/load';
import { loadPairingAids, openForbiddenPairingCheck } from '@/lib/format-engine/pairing-server';
import type { Pairing, Stage } from '@/lib/format-kit/types';

const TID = 'ae13bc20-d43b-42b5-8de0-4944cb4025e3';
const SEASON = 's-1';
const routeParams = { params: Promise.resolve({ tid: TID }) };
const request = {} as NextRequest;
const PLAYERS = ['p1', 'p2', 'p3', 'p4'];
const filterPairing = { kind: 'filter', base: { kind: 'round_robin', legs: 1, mirror_legs: true }, allow: { k: 'bool', v: true } } as const;

function stage(pairing: Pairing): Stage {
  return {
    key: 'main',
    name: { en: { v: 'Main', s: 'human' }, base: 'en' },
    participants: { from: 'roster', seeding: 'signup' },
    pairing,
    series: { best_of: 1, allow_draw: false, overrides: [] },
    ruleset: { kind: 'season_default' },
    doubles: false,
    players_per_match: 2,
    scoring: { win: 3, loss: 0, bye: 3 },
    rank: [{ kind: 'metric', metric: 'points', direction: 'desc' }],
    columns: [],
  };
}

function phase(pairing: Pairing): KitPhase {
  return { engine: 'kit', seed: 'seed-0123456789', stage: stage(pairing), outcomes: {}, tableExtras: {} };
}

function tournament(bracket_type: 'swiss' | 'round_robin', current_round: number, formatType = 'custom') {
  return {
    id: TID,
    name: 'Kit Cup',
    status: 'active',
    season_id: SEASON,
    season_format_type: formatType,
    bracket_type,
    current_round,
    best_of_default: 1,
    bo_overrides: {},
  };
}

function writtenPairs(): string[] {
  const inputs = vi.mocked(createMatchBatch).mock.calls[0]?.[0] ?? [];
  return inputs.map((m: { player_1_id: string; player_2_id: string }) => `${m.player_1_id}-${m.player_2_id}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
  vi.mocked(getParticipants).mockResolvedValue(PLAYERS.map((id) => ({ id, name: id.toUpperCase() })) as never);
  vi.mocked(getCompletedMatchRecords).mockResolvedValue([] as never);
  vi.mocked(getPairedMatchRecords).mockResolvedValue([] as never);
  vi.mocked(getGroupsByTournament).mockResolvedValue([] as never);
  vi.mocked(getSeasonGroups).mockResolvedValue([]);
  vi.mocked(getMatchesByTournament).mockResolvedValue([]);
  vi.mocked(loadPairingAids).mockResolvedValue({});
  vi.mocked(createRound).mockImplementation(
    async (input: { name: string; round_number: number }) =>
      ({ id: `r-${input.round_number}`, tournament_id: TID, name: input.name, round_number: input.round_number, status: 'pending' }) as never,
  );
});

describe('generate-round pairing aids', () => {
  it('drops the pairs a filter rejects, warns and opens one forbidden-pairing check', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('round_robin', 1) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ round_number: 1, status: 'completed', bye_player_ids: [] }] as never);
    vi.mocked(loadKitPhase).mockResolvedValue(phase(filterPairing));
    // Side A of the pair env is the first name only: `loadPairingAids` tries both orders, so one verdict is enough.
    vi.mocked(loadPairingAids).mockResolvedValue({ allowPair: (a, b) => a !== 'p1' && b !== 'p1' });

    const response = await POST(request, routeParams);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(generateRound).not.toHaveBeenCalled();
    expect(loadPairingAids).toHaveBeenCalledWith(
      expect.objectContaining({ seasonId: SEASON, roundNumber: 2, playerIds: PLAYERS }),
    );
    // A four-player round robin pairs two matches; the rejected one is dropped, not replaced.
    expect(writtenPairs()).toHaveLength(1);
    expect(writtenPairs()[0]).not.toContain('p1');
    expect(body.warnings).toEqual([{ code: 'pairing_forbidden', params: { count: 1 } }]);
    expect(openForbiddenPairingCheck).toHaveBeenCalledTimes(1);
    expect(openForbiddenPairingCheck).toHaveBeenCalledWith({ seasonId: SEASON, stageKey: 'main', round: 2, forbidden: 1 });
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toMatchObject({ engine: 'kit', forbidden: 1 });
    expect(revalidateTag).toHaveBeenCalledWith(`tournament:${TID}`, { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(`season:${SEASON}`, { expire: 0 });
  });

  it('pairs a bipartite stage side A against side B and keeps side A as player 1', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('swiss', 1) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ round_number: 1, status: 'completed', bye_player_ids: [] }] as never);
    vi.mocked(loadKitPhase).mockResolvedValue(
      phase({ kind: 'bipartite', attr: 'side', side_a: ['core'], side_b: ['casual'], rounds: 3, avoid_repeats: true }),
    );
    vi.mocked(loadPairingAids).mockResolvedValue({ sides: { p1: 'a', p2: 'b', p3: 'a', p4: 'b' } });

    const response = await POST(request, routeParams);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(loadPairingAids).toHaveBeenCalledWith(
      expect.objectContaining({ seasonId: SEASON, roundNumber: 2, playerIds: PLAYERS }),
    );
    const pairs = writtenPairs();
    expect(pairs).toHaveLength(2);
    for (const pair of pairs) {
      const [first, second] = pair.split('-');
      expect(['p1', 'p3']).toContain(first);
      expect(['p2', 'p4']).toContain(second);
    }
    expect(openForbiddenPairingCheck).not.toHaveBeenCalled();
    expect(body.warnings).toBeUndefined();
  });

  it('refuses a challenge ladder: its matches come from accepted challenges', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('round_robin', 0) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([] as never);
    vi.mocked(loadKitPhase).mockResolvedValue(
      phase({ kind: 'challenge', rounds: 8, rank_range: 3, max_open: 1, cooldown_rounds: 1, accept_window_hours: 72 }),
    );

    const response = await POST(request, routeParams);

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('rounds_challenge_ladder');
    expect(createRound).not.toHaveBeenCalled();
    expect(loadPairingAids).not.toHaveBeenCalled();
    expect(generateRound).not.toHaveBeenCalled();
  });

  it('keeps the legacy pairing for a league that does not run a kit format', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('round_robin', 0, 'round_robin') as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([] as never);
    vi.mocked(generateRound).mockReturnValue({
      pairings: [
        { player_1_id: 'p1', player_2_id: 'p2' },
        { player_1_id: 'p3', player_2_id: 'p4' },
      ],
      round_name: 'Round 1',
      bye_player_ids: [],
    } as never);

    const response = await POST(request, routeParams);

    expect(response.status).toBe(201);
    expect(loadKitPhase).not.toHaveBeenCalled();
    expect(loadPairingAids).not.toHaveBeenCalled();
    expect(generateRound).toHaveBeenCalledTimes(1);
    expect(writtenPairs()).toEqual(['p1-p2', 'p3-p4']);
    expect(revalidateTag).toHaveBeenCalledWith(`tournament:${TID}`, { expire: 0 });
  });
});
