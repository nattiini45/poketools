import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) =>
    NextResponse.json({ success: false, error: fallback }, { status: 500 })
  ),
}));

vi.mock('@/lib/utils/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 19, retryAfterSeconds: 0 })),
}));

vi.mock('@/lib/pkmn/game-pipeline', () => ({
  recordGameResult: vi.fn(),
}));

vi.mock('@/lib/match/result-effects', () => ({
  emitMatchResultEffects: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  isResourceAdminFor: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock('@/lib/pkmn/replay', () => ({
  fetchReplay: vi.fn(),
  parseReplayLog: vi.fn(),
}));

import { POST } from '@/app/api/admin/matches/[id]/replay-import/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { recordGameResult } from '@/lib/pkmn/game-pipeline';
import { emitMatchResultEffects } from '@/lib/match/result-effects';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { logAuditEvent } from '@/lib/audit/log';
import { fetchReplay, parseReplayLog } from '@/lib/pkmn/replay';
import { computeReplayHash } from '@/lib/pkmn/replay-identity';

const MATCH_ID = '12345678-1234-4123-8123-123456789abc';
const P1_ID = '11111111-1111-4111-8111-111111111111';
const P2_ID = '22222222-2222-4222-8222-222222222222';
const REPLAY_URL = 'https://replay.pokemonshowdown.com/test';

const ADMIN = { playerId: 'admin1', name: 'Admin', isAdmin: true, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active' } as const;
const NON_ADMIN = { playerId: 'user1', name: 'User', isAdmin: false, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active' } as const;

const fakeMatch = {
  id: MATCH_ID,
  tournament_id: 't1',
  round_id: 'r1',
  player_1_id: P1_ID,
  player_2_id: P2_ID,
  player_1_name: 'Alice',
  player_2_name: 'Bob',
};

const REPLAY_LOG = ['|player|p1|subby', '|player|p2|bob_ps', '|turn|1', '|win|subby'].join('\n');
const REPLAY_HASH = computeReplayHash(REPLAY_LOG);

const fakeParsed = {
  winner_ps_username: 'subby',
  players: [
    { ps_username: 'subby', pokemon: [{ pokemon_name: 'Pikachu', was_brought: true, was_lead: true, kos_dealt: 1, was_koed: false, moves_used: ['Thunderbolt'], turns_active: 5 }] },
    { ps_username: 'bob_ps', pokemon: [{ pokemon_name: 'Garchomp', was_brought: true, was_lead: true, kos_dealt: 0, was_koed: true, moves_used: ['Earthquake'], turns_active: 3 }] },
  ],
};

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    replay_url: REPLAY_URL,
    replay_hash: REPLAY_HASH,
    side_player_ids: [P1_ID, P2_ID],
    ...overrides,
  };
}

function makeRequest(body: Record<string, unknown>): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: { get: vi.fn().mockReturnValue(null) },
  } as unknown as NextRequest;
}

function makeParams() {
  return { params: Promise.resolve({ id: MATCH_ID }) };
}

describe('POST /api/admin/matches/[id]/replay-import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue(ADMIN);
    vi.mocked(emitMatchResultEffects).mockResolvedValue(undefined);
    vi.mocked(fetchReplay).mockResolvedValue({ log: REPLAY_LOG, id: 'test', format: 'gen9', players: ['subby', 'bob_ps'], winner: 'subby' });
    vi.mocked(parseReplayLog).mockReturnValue(fakeParsed);
  });

  it('returns 404 when match not found', async () => {
    vi.mocked(getMatchById).mockResolvedValue(null);
    const res = await POST(makeRequest(validBody()), makeParams());
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('match_not_found');
  });

  it('returns 403 when caller is neither admin nor resource admin', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(NON_ADMIN);
    vi.mocked(getMatchById).mockResolvedValue(fakeMatch as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);

    const res = await POST(makeRequest(validBody()), makeParams());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden');
    expect(vi.mocked(recordGameResult)).not.toHaveBeenCalled();
  });

  it('refuses the old client-supplied winner and stats body (validation_failed)', async () => {
    vi.mocked(getMatchById).mockResolvedValue(fakeMatch as never);
    const res = await POST(
      makeRequest({
        replay_url: REPLAY_URL,
        winner_id: P1_ID,
        pokemon_stats: [
          { player_id: P1_ID, pokemon: [{ pokemon_name: 'Pikachu' }] },
          { player_id: P2_ID, pokemon: [{ pokemon_name: 'Garchomp' }] },
        ],
      }),
      makeParams()
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
    expect(vi.mocked(fetchReplay)).not.toHaveBeenCalled();
    expect(vi.mocked(recordGameResult)).not.toHaveBeenCalled();
  });

  it('refuses a replay that hashes differently from the preview (409, nothing recorded)', async () => {
    vi.mocked(getMatchById).mockResolvedValue(fakeMatch as never);
    vi.mocked(fetchReplay).mockResolvedValue({ log: REPLAY_LOG.replace('|turn|1', '|turn|2'), id: 'test', format: 'gen9', players: ['subby', 'bob_ps'], winner: 'subby' });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(makeRequest(validBody()), makeParams());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('replay_changed_since_preview');
    expect(errorSpy).toHaveBeenCalled();
    expect(vi.mocked(recordGameResult)).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('records the game as a ps_replay with is_admin bypass and audits it', async () => {
    vi.mocked(getMatchById).mockResolvedValue(fakeMatch as never);
    const gameResult = { game_id: 'g1', game_winner_id: P1_ID, bo_reached: true, match_status: 'pending_confirmation', match_winner_id: P1_ID } as never;
    vi.mocked(recordGameResult).mockResolvedValue(gameResult);

    const res = await POST(makeRequest(validBody()), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(gameResult);

    // The organizer's side assignment and the bound replay: no winner or stats from the client.
    const input = vi.mocked(recordGameResult).mock.calls[0][0];
    expect(input).toMatchObject({
      match_id: MATCH_ID,
      source: 'ps_replay',
      side_player_ids: [P1_ID, P2_ID],
      submitter_id: 'admin1',
      is_admin: true,
    });
    expect(input).not.toHaveProperty('winner_id');
    expect(input).not.toHaveProperty('battle_stats');
    if (input.source !== 'ps_replay') throw new Error('expected a replay input');
    expect(input.replay).toMatchObject({ url: REPLAY_URL, hash: REPLAY_HASH, parsed: fakeParsed });

    expect(vi.mocked(emitMatchResultEffects)).toHaveBeenCalledWith(
      MATCH_ID,
      expect.objectContaining({ boReached: true, replayUrl: REPLAY_URL })
    );

    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'game.import_replay',
        resource_id: 'g1',
        metadata: expect.objectContaining({
          replay_hash: REPLAY_HASH,
          winner_id: P1_ID,
          assignments: [
            { ps_username: 'subby', player_id: P1_ID, pokemon_count: 1 },
            { ps_username: 'bob_ps', player_id: P2_ID, pokemon_count: 1 },
          ],
        }),
      })
    );
  });

  it('allows a tournament resource admin (non-site-admin)', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(NON_ADMIN);
    vi.mocked(getMatchById).mockResolvedValue(fakeMatch as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(true);
    vi.mocked(recordGameResult).mockResolvedValue({ game_id: 'g1', bo_reached: false, match_status: 'in_progress', match_winner_id: null } as never);

    const res = await POST(makeRequest(validBody()), makeParams());
    expect(res.status).toBe(200);
    expect(vi.mocked(recordGameResult)).toHaveBeenCalledWith(
      expect.objectContaining({ submitter_id: 'user1', is_admin: true })
    );
  });
});
