/**
 * GET /api/seasons/[id]/phases/[phaseId]/participants is public. It must map
 * each participant field by field to `{ id, name, avatar_url, seed,
 * starting_bracket }`: before, it spread the player row and dropped only
 * `discord_id` / `auth_user_id`, so moderation and admin columns went out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-storage', () => ({ readPhaseStorageMode: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getParticipants: vi.fn(),
  addParticipant: vi.fn(),
  removeParticipant: vi.fn(),
  updateParticipantSeeds: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonParticipants: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/league-phases', () => ({
  getPhaseById: vi.fn(),
  getPhaseParticipants: vi.fn(),
  addPhaseParticipant: vi.fn(),
  removePhaseParticipant: vi.fn(),
  updatePhaseParticipantSeeds: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/format-engine', () => ({ getKitPhases: vi.fn() }));
vi.mock('@/lib/supabase/queries/ratings', () => ({ getPlayerRatingsBatch: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));

import { DELETE, GET, PATCH, POST } from '../route';
import { POST as seedByRating } from '../seed-by-rating/route';
import { revalidateTag } from 'next/cache';
import { AuthError, requireResourceAdmin } from '@/lib/auth/helpers';
import { logAuditEvent } from '@/lib/audit/log';
import { addParticipant, getParticipants, getTournamentById, removeParticipant, updateParticipantSeeds } from '@/lib/supabase/queries/tournaments';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { addPhaseParticipant, getPhaseById, getPhaseParticipants, removePhaseParticipant, updatePhaseParticipantSeeds } from '@/lib/supabase/queries/league-phases';
import { getKitPhases } from '@/lib/supabase/queries/format-engine';
import { getPlayerRatingsBatch } from '@/lib/supabase/queries/ratings';
import { readPhaseStorageMode } from '@/lib/supabase/queries/phase-storage';
import { SeedUpdatePartialError } from '@/lib/tournament/seed-errors';
import { expectNoPrivatePlayerData, fullPlayerRow } from '@/lib/players/__tests__/private-player-fields';
import type { ParticipantWithSeed } from '@/types/tournament';

const SEASON = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PHASE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const args = (id = SEASON, phaseId = PHASE) => ({ params: Promise.resolve({ id, phaseId }) });
const req = (body: unknown = {}) => ({ json: vi.fn(async () => body) }) as unknown as NextRequest;
const routeArgs = args();

const fullRows: ParticipantWithSeed[] = [
  { ...fullPlayerRow({ id: 'p1', name: 'Ash' }), seed: 1, starting_bracket: 'winners' },
  { ...fullPlayerRow({ id: 'p2', name: 'Gary', avatar_url: null }), seed: null, starting_bracket: 'losers' },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('READ_PHASE_STORAGE_STATE', undefined);
  vi.mocked(getTournamentById).mockResolvedValue({ id: PHASE, season_id: SEASON, status: 'upcoming' } as never);
  vi.mocked(getPhaseById).mockResolvedValue({ id: PHASE, season_id: SEASON, status: 'upcoming', format_stage_key: null } as never);
  vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'admin', name: 'Admin' } as never);
  vi.mocked(getSeasonParticipants).mockResolvedValue([fullPlayerRow({ id: PLAYER })] as never);
});

afterEach(() => vi.unstubAllEnvs());

function nativeMode() {
  vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
  vi.mocked(readPhaseStorageMode).mockResolvedValue('phase');
}

describe('GET /api/seasons/[id]/phases/[phaseId]/participants', () => {
  it('returns only { id, name, avatar_url, seed, starting_bracket } per participant', async () => {
    vi.mocked(getParticipants).mockResolvedValue(fullRows);

    const res = await GET({} as NextRequest, routeArgs);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual([
      { id: 'p1', name: 'Ash', avatar_url: fullRows[0].avatar_url, seed: 1, starting_bracket: 'winners' },
      { id: 'p2', name: 'Gary', avatar_url: null, seed: null, starting_bracket: 'losers' },
    ]);
    expect(getParticipants).toHaveBeenCalledWith(PHASE);
    expect(readPhaseStorageMode).not.toHaveBeenCalled();
    expect(getPhaseById).not.toHaveBeenCalled();
  });

  it('the response carries no private player column (JSON.stringify check)', async () => {
    vi.mocked(getParticipants).mockResolvedValue(fullRows);

    const res = await GET({} as NextRequest, routeArgs);

    expectNoPrivatePlayerData(await res.json());
  });

  it('a phase of another league is a 404, not a participant list', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ id: PHASE, season_id: 'other' } as never);

    const res = await GET({} as NextRequest, routeArgs);

    expect(res.status).toBe(404);
    expect(getParticipants).not.toHaveBeenCalled();
  });

  it('returns 500 when the read fails', async () => {
    vi.mocked(getParticipants).mockRejectedValue(new Error('DB error'));

    const res = await GET({} as NextRequest, routeArgs);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to fetch phase participants');
  });

  it('returns the same public shape from the native phase only', async () => {
    nativeMode();
    vi.mocked(getPhaseParticipants).mockResolvedValue(fullRows);

    const res = await GET(req(), args(SEASON.toUpperCase(), PHASE.toUpperCase()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data[0]).toEqual({
      id: 'p1', name: 'Ash', avatar_url: fullRows[0].avatar_url, seed: 1, starting_bracket: 'winners',
    });
    expectNoPrivatePlayerData(body);
    expect(getPhaseById).toHaveBeenCalledExactlyOnceWith(PHASE);
    expect(getPhaseParticipants).toHaveBeenCalledExactlyOnceWith(PHASE);
    expect(getTournamentById).not.toHaveBeenCalled();
    expect(getParticipants).not.toHaveBeenCalled();
    expect(requireResourceAdmin).not.toHaveBeenCalled();
  });

  it.each([null, { id: PHASE, season_id: 'other' }])('refuses an unowned native phase: %j', async (phase) => {
    nativeMode();
    vi.mocked(getPhaseById).mockResolvedValue(phase as never);

    const res = await GET(req(), routeArgs);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'PHASE_NOT_FOUND' });
    expect(getPhaseParticipants).not.toHaveBeenCalled();
    expect(getTournamentById).not.toHaveBeenCalled();
    expect(getParticipants).not.toHaveBeenCalled();
  });

  it.each([
    ['bad-id', PHASE, 'INVALID_SEASON_ID'],
    [SEASON, 'bad-id', 'INVALID_PHASE_ID'],
  ])('validates %s / %s before asking either store', async (id, phaseId, code) => {
    nativeMode();
    const res = await GET(req(), args(id, phaseId));

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code });
    expect(readPhaseStorageMode).not.toHaveBeenCalled();
    expect(getPhaseById).not.toHaveBeenCalled();
    expect(getTournamentById).not.toHaveBeenCalled();
  });
});

describe('phase roster writes', () => {
  it.each([['POST', POST], ['DELETE', DELETE], ['PATCH', PATCH]] as const)('requires live auth before mode lookup in %s', async (_method, handler) => {
    nativeMode();
    vi.mocked(requireResourceAdmin).mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
    const request = req();

    expect((await handler(request, routeArgs)).status).toBe(403);
    expect(requireResourceAdmin).toHaveBeenCalledExactlyOnceWith('season', SEASON);
    expect(readPhaseStorageMode).not.toHaveBeenCalled();
    expect(getPhaseById).not.toHaveBeenCalled();
    expect(getTournamentById).not.toHaveBeenCalled();
    expect(request.json).not.toHaveBeenCalled();
  });

  it.each(['frozen_legacy', 'frozen_phase'] as const)('refuses reads and writes in %s before touching either store', async (mode) => {
    nativeMode();
    vi.mocked(readPhaseStorageMode).mockResolvedValue(mode);
    const request = req({ player_id: PLAYER });

    for (const handler of [GET, POST, DELETE, PATCH]) {
      const res = await handler(request, routeArgs);
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: 'phase_storage_unavailable' });
    }
    expect(getPhaseById).not.toHaveBeenCalled();
    expect(getTournamentById).not.toHaveBeenCalled();
    expect(getSeasonParticipants).not.toHaveBeenCalled();
    expect(request.json).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('dispatches manual adds, seeds and removal to native storage and expires native tags', async () => {
    nativeMode();
    const seeds = [{ player_id: PLAYER, seed: 1, starting_bracket: 'losers' }];
    vi.mocked(getPhaseParticipants).mockResolvedValue([{ ...fullRows[0], id: PLAYER }]);

    expect((await POST(req({ player_id: PLAYER }), routeArgs)).status).toBe(201);
    expect((await PATCH(req({ seeds }), routeArgs)).status).toBe(200);
    expect((await DELETE(req({ player_id: PLAYER }), routeArgs)).status).toBe(200);

    expect(addPhaseParticipant).toHaveBeenCalledExactlyOnceWith(PHASE, PLAYER);
    expect(updatePhaseParticipantSeeds).toHaveBeenCalledExactlyOnceWith(PHASE, seeds);
    expect(removePhaseParticipant).toHaveBeenCalledExactlyOnceWith(PHASE, PLAYER);
    expect(getTournamentById).not.toHaveBeenCalled();
    expect(getParticipants).not.toHaveBeenCalled();
    expect(addParticipant).not.toHaveBeenCalled();
    expect(updateParticipantSeeds).not.toHaveBeenCalled();
    expect(removeParticipant).not.toHaveBeenCalled();
    expect(vi.mocked(revalidateTag).mock.calls.filter(([tag]) => tag === `phase:${PHASE}`)).toEqual(
      Array.from({ length: 3 }, () => [`phase:${PHASE}`, { expire: 0 }]),
    );
    expect(revalidateTag).toHaveBeenCalledWith(`season:${SEASON}`, { expire: 0 });
    expect(revalidateTag).not.toHaveBeenCalledWith(`tournament:${PHASE}`, expect.anything());
  });

  it('enforces the native format lock without reading the legacy stage and audits a forced add', async () => {
    nativeMode();
    vi.mocked(getPhaseById).mockResolvedValue({ id: PHASE, season_id: SEASON, status: 'active', format_stage_key: 'groups' } as never);
    const body = { player_id: PLAYER };

    expect(await (await POST(req(body), routeArgs)).json()).toMatchObject({ code: 'format_phase_owned' });
    expect(getSeasonParticipants).not.toHaveBeenCalled();
    expect(addPhaseParticipant).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();

    expect((await POST(req({ ...body, force: true, reason: 'Manual correction' }), routeArgs)).status).toBe(201);
    expect(getKitPhases).not.toHaveBeenCalled();
    expect(addPhaseParticipant).toHaveBeenCalledExactlyOnceWith(PHASE, PLAYER);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'phase.roster.force', resource_id: PHASE,
      metadata: expect.objectContaining({ change: 'add', reason: 'Manual correction' }),
    }));
  });

  it('expires and audits a native bulk add that fails after adding one player', async () => {
    nativeMode();
    const second = '33333333-3333-4333-8333-333333333333';
    vi.mocked(getPhaseById).mockResolvedValue({ id: PHASE, season_id: SEASON, status: 'active', format_stage_key: 'groups' } as never);
    vi.mocked(getSeasonParticipants).mockResolvedValue([fullPlayerRow({ id: PLAYER }), fullPlayerRow({ id: second })] as never);
    vi.mocked(getPhaseParticipants).mockResolvedValue([]);
    vi.mocked(addPhaseParticipant).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('write failed'));

    const res = await POST(req({ player_ids: [PLAYER, second], force: true, reason: 'Manual correction' }), routeArgs);

    expect(res.status).toBe(500);
    expect(vi.mocked(addPhaseParticipant).mock.calls).toEqual([[PHASE, PLAYER], [PHASE, second]]);
    expect(revalidateTag).toHaveBeenCalledWith(`phase:${PHASE}`, { expire: 0 });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'phase.roster.force',
      metadata: expect.objectContaining({ change: 'add', added: 1 }),
    }));
  });

  it('refuses completed native phase edits before reading the body or roster', async () => {
    nativeMode();
    vi.mocked(getPhaseById).mockResolvedValue({ id: PHASE, season_id: SEASON, status: 'completed', format_stage_key: null } as never);
    const request = req({ player_id: PLAYER, force: true });

    const res = await DELETE(request, routeArgs);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'PHASE_PARTICIPANTS_LOCKED' });
    expect(request.json).not.toHaveBeenCalled();
    expect(removePhaseParticipant).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('seeds the verified native roster by rating without reading or writing a legacy row', async () => {
    nativeMode();
    vi.mocked(getPhaseParticipants).mockResolvedValue(fullRows);
    vi.mocked(getPlayerRatingsBatch).mockResolvedValue(new Map([
      ['p2', {
        id: 'rating-p2', player_id: 'p2', rating: 1600, rd: 100, volatility: 0.06, peak_rating: 1600,
        peak_date: null, wins: 0, losses: 0, draws: 0, last_match_at: null,
      }],
    ]));
    const response = await seedByRating(req(), args(SEASON.toUpperCase(), PHASE.toUpperCase()));
    expect(response.status).toBe(200);
    expect(updatePhaseParticipantSeeds).toHaveBeenCalledExactlyOnceWith(PHASE, [
      { player_id: 'p2', seed: 1 }, { player_id: 'p1', seed: 2 },
    ]);
    expect(getPlayerRatingsBatch).toHaveBeenCalledExactlyOnceWith(['p1', 'p2']);
    expect(getTournamentById).not.toHaveBeenCalled();
    expect(updateParticipantSeeds).not.toHaveBeenCalled();
    expect(revalidateTag).toHaveBeenCalledWith(`phase:${PHASE}`, { expire: 0 });
  });

  it('expires legacy tournament tags even when seeds only partially commit', async () => {
    vi.mocked(getParticipants).mockResolvedValue([{ ...fullRows[0], id: PLAYER }]);
    vi.mocked(updateParticipantSeeds).mockRejectedValue(new SeedUpdatePartialError([PLAYER], new Error('write failed')));

    const res = await PATCH(req({ seeds: [{ player_id: PLAYER, seed: 1 }] }), routeArgs);

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'SEED_UPDATE_PARTIAL' });
    expect(revalidateTag).toHaveBeenCalledWith(`tournament:${PHASE}`, { expire: 0 });
    expect(revalidateTag).not.toHaveBeenCalledWith(`phase:${PHASE}`, expect.anything());
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
