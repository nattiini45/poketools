import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────

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

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
}));

vi.mock('@/lib/players/roster-access', () => ({
  canViewAdminRoster: vi.fn(),
}));

// The write paths expire the public read cache (SD); revalidateTag needs a
// Next request scope, which a unit test does not have.
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));

vi.mock('@/lib/revalidation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/revalidation')>()),
  expireTournamentReads: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { GET, POST, DELETE, PATCH } from '@/app/api/tournaments/[id]/participants/route';
import { requireResourceAdmin, AuthError } from '@/lib/auth/helpers';
import {
  getTournamentById,
  getParticipants,
  addParticipant,
  removeParticipant,
  updateParticipantSeeds,
} from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { canViewAdminRoster } from '@/lib/players/roster-access';
import { expireTournamentReads } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import { SeedConflictError, SeedUpdatePartialError } from '@/lib/tournament/seed-errors';
import { apiErrorText } from '@/i18n/api-errors';
import { errorsTournaments } from '@/i18n/messages/errors';
import { expectNoPrivatePlayerData, fullPlayerRow } from '@/lib/players/__tests__/private-player-fields';
import type { ParticipantWithSeed } from '@/types/tournament';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: Record<string, unknown>) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

const routeParams = { params: Promise.resolve({ id: '22222222-2222-4222-8222-222222222222' }) };

const ADMIN = { playerId: 'admin-1', name: 'Admin' };

const PLAYER_1 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01';
const PLAYER_2 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02';

const mockParticipants = [
  { id: PLAYER_1, name: 'Ash', seed: 1, starting_bracket: 'winners' as const },
  { id: PLAYER_2, name: 'Gary', seed: 2, starting_bracket: 'winners' as const },
];

const mockUpcomingTournament = { id: '22222222-2222-4222-8222-222222222222', status: 'upcoming' as const };
const mockActiveTournament = { id: '22222222-2222-4222-8222-222222222222', status: 'active' as const };

function mockUpcomingTournamentFetch() {
  vi.mocked(getTournamentById).mockResolvedValue(mockUpcomingTournament as never);
}

// ─── Tests ──────────────────────────────────────────────────────────

/** Full participant rows (what getParticipants returns), private columns set to sentinels. */
const fullRows: ParticipantWithSeed[] = [
  { ...fullPlayerRow({ id: PLAYER_1, name: 'Ash' }), seed: 1, starting_bracket: 'winners' },
  { ...fullPlayerRow({ id: PLAYER_2, name: 'Gary', is_guest: true }), seed: null, starting_bracket: 'losers' },
];

describe('GET /api/tournaments/[id]/participants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(canViewAdminRoster).mockResolvedValue(false);
  });

  it('returns participants (public endpoint) as { id, name, avatar_url, seed, starting_bracket }', async () => {
    vi.mocked(getParticipants).mockResolvedValue(fullRows);

    const res = await GET({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual([
      { id: PLAYER_1, name: 'Ash', avatar_url: fullRows[0].avatar_url, seed: 1, starting_bracket: 'winners' },
      { id: PLAYER_2, name: 'Gary', avatar_url: fullRows[1].avatar_url, seed: null, starting_bracket: 'losers' },
    ]);
    expect(canViewAdminRoster).toHaveBeenCalledWith('tournament', '22222222-2222-4222-8222-222222222222');
  });

  it('the public response carries no private player column (JSON.stringify check)', async () => {
    vi.mocked(getParticipants).mockResolvedValue(fullRows);

    const res = await GET({} as NextRequest, routeParams);

    expectNoPrivatePlayerData(await res.json());
  });

  it('a confirmed tournament admin also gets the guest flag, and nothing private', async () => {
    vi.mocked(canViewAdminRoster).mockResolvedValue(true);
    vi.mocked(getParticipants).mockResolvedValue(fullRows);

    const res = await GET({} as NextRequest, routeParams);
    const json = await res.json();

    expect(json.data[1]).toEqual({
      id: PLAYER_2,
      name: 'Gary',
      avatar_url: fullRows[1].avatar_url,
      seed: null,
      starting_bracket: 'losers',
      is_guest: true,
    });
    expectNoPrivatePlayerData(json);
  });

  it('returns 500 on fetch failure', async () => {
    vi.mocked(getParticipants).mockRejectedValue(new Error('DB error'));

    const res = await GET({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to fetch participants');
  });

  it('a failed admin check fails the request instead of guessing a shape', async () => {
    vi.mocked(canViewAdminRoster).mockRejectedValue(new Error('live player read failed'));

    const res = await GET({} as NextRequest, routeParams);

    expect(res.status).toBe(500);
    expect(getParticipants).not.toHaveBeenCalled();
  });
});

describe('POST /api/tournaments/[id]/participants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTournamentById).mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      bracket_type: 'single_elim',
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
  });

  it('returns auth error when not resource admin', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authorized', 403),
    );

    const res = await POST(makeRequest({ player_id: PLAYER_1 }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
  });

  it('returns 400 when player_id missing', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    mockUpcomingTournamentFetch();

    const res = await POST(makeRequest({}), routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('player_id');
    expect(json.code).toBe('validation_failed');
  });

  it('adds a participant successfully', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    mockUpcomingTournamentFetch();
    vi.mocked(addParticipant).mockResolvedValue(undefined as never);

    const res = await POST(makeRequest({ player_id: PLAYER_1 }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(addParticipant).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', PLAYER_1);
    expect(expireTournamentReads).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', undefined);
  });

  it('returns 400 when tournament has already started', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockActiveTournament as never);

    const res = await POST(makeRequest({ player_id: PLAYER_1 }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Cannot add participants after the tournament has started');
    expect(json.code).toBe('tournament_participant_add_locked');
    expect(addParticipant).not.toHaveBeenCalled();
  });

  it('rejects add when elim bracket already has rounds', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      status: 'upcoming',
      bracket_type: 'single_elim',
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'round-1' }] as never);

    const res = await POST(makeRequest({ player_id: PLAYER_1 }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('BRACKET_LOCKED_USE_SUBSTITUTE');
    expect(addParticipant).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/tournaments/[id]/participants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTournamentById).mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      bracket_type: 'double_elim',
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
  });

  it('returns auth error when not resource admin', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authorized', 403),
    );

    const res = await DELETE(makeRequest({ player_id: PLAYER_1 }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
  });

  it('returns 400 when player_id missing', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    mockUpcomingTournamentFetch();

    const res = await DELETE(makeRequest({}), routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('player_id');
    expect(json.code).toBe('validation_failed');
  });

  it('removes a participant successfully', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    mockUpcomingTournamentFetch();
    vi.mocked(removeParticipant).mockResolvedValue(undefined as never);

    const res = await DELETE(makeRequest({ player_id: PLAYER_1 }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(removeParticipant).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', PLAYER_1);
    expect(expireTournamentReads).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', undefined);
  });

  it('returns 400 when tournament has already started', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockActiveTournament as never);

    const res = await DELETE(makeRequest({ player_id: PLAYER_1 }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Cannot remove participants after the tournament has started');
    expect(json.code).toBe('tournament_participant_remove_locked');
    expect(removeParticipant).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/tournaments/[id]/participants', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns auth error when not resource admin', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authorized', 403),
    );

    const res = await PATCH(makeRequest({ seeds: [{ player_id: PLAYER_1, seed: 1 }] }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
  });

  it('returns 400 when seeds array missing or empty', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);

    const res = await PATCH(makeRequest({ seeds: [] }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('seeds');
    expect(json.code).toBe('validation_failed');
  });

  it('returns 400 for invalid seed value', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);

    const res = await PATCH(
      makeRequest({ seeds: [{ player_id: PLAYER_1, seed: -1 }] }),
      routeParams,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('seed');
  });

  it('returns 400 for duplicate seed values', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    mockUpcomingTournamentFetch();

    const res = await PATCH(
      makeRequest({
        seeds: [
          { player_id: PLAYER_1, seed: 1 },
          { player_id: PLAYER_2, seed: 1 },
        ],
      }),
      routeParams,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Duplicate seed values');
    expect(json.code).toBe('tournament_seed_duplicate');
  });

  it('returns 400 when player is not a participant', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    mockUpcomingTournamentFetch();
    vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);

    const NOT_PARTICIPANT = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380aff';
    const res = await PATCH(
      makeRequest({ seeds: [{ player_id: NOT_PARTICIPANT, seed: 1 }] }),
      routeParams,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('not a participant');
    expect(json.code).toBe('tournament_player_not_participant');
    expect(json.params).toEqual({ player: NOT_PARTICIPANT });
  });

  it('updates seeds successfully', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    mockUpcomingTournamentFetch();
    vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);
    vi.mocked(updateParticipantSeeds).mockResolvedValue(undefined as never);

    const seeds = [
      { player_id: PLAYER_1, seed: 2 },
      { player_id: PLAYER_2, seed: 1 },
    ];
    const res = await PATCH(makeRequest({ seeds }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(updateParticipantSeeds).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', seeds);
    expect(expireTournamentReads).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', undefined);
  });

  it('forwards starting_bracket to updateParticipantSeeds', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    mockUpcomingTournamentFetch();
    vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);
    vi.mocked(updateParticipantSeeds).mockResolvedValue(undefined as never);

    const seeds = [
      { player_id: PLAYER_1, seed: 1, starting_bracket: 'winners' as const },
      { player_id: PLAYER_2, seed: 2, starting_bracket: 'losers' as const },
    ];
    const res = await PATCH(makeRequest({ seeds }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(updateParticipantSeeds).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', seeds);
  });

  it('returns 400 when seeding is locked after tournament start', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockActiveTournament as never);

    const res = await PATCH(
      makeRequest({ seeds: [{ player_id: PLAYER_1, seed: 1 }] }),
      routeParams,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Seeding is locked — the tournament has already started');
    expect(json.code).toBe('tournament_seeding_locked');
    expect(getParticipants).not.toHaveBeenCalled();
    expect(updateParticipantSeeds).not.toHaveBeenCalled();
  });

  it('allows null seeds', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    mockUpcomingTournamentFetch();
    vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);
    vi.mocked(updateParticipantSeeds).mockResolvedValue(undefined as never);

    const seeds = [{ player_id: PLAYER_1, seed: null }];
    const res = await PATCH(makeRequest({ seeds }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it('returns 409 SEED_CONFLICT (nothing written, no tag expiry) when a seed is held outside the request', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    mockUpcomingTournamentFetch();
    vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);
    vi.mocked(updateParticipantSeeds).mockRejectedValue(new SeedConflictError(2));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await PATCH(makeRequest({ seeds: [{ player_id: PLAYER_1, seed: 2 }] }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('SEED_CONFLICT');
    expect(json.params).toEqual({ seed: 2 });
    expect(apiErrorText(json, { locale: 'de', catalogs: [errorsTournaments] })).toBe(
      'Setzplatz 2 ist bereits an einen anderen Teilnehmer vergeben – nimm ihn in die Neusetzung auf oder wähle einen freien Setzplatz.',
    );
    expect(expireTournamentReads).not.toHaveBeenCalled();
  });

  it('returns 500 SEED_UPDATE_PARTIAL and still expires the tags when a write lands half-way', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    mockUpcomingTournamentFetch();
    vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);
    vi.mocked(updateParticipantSeeds).mockRejectedValue(
      new SeedUpdatePartialError([PLAYER_2], [new Error('write err')]),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await PATCH(
      makeRequest({
        seeds: [
          { player_id: PLAYER_1, seed: 2 },
          { player_id: PLAYER_2, seed: 1 },
        ],
      }),
      routeParams,
    );
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.code).toBe('SEED_UPDATE_PARTIAL');
    expect(json.params).toEqual({ count: 1 });
    expect(apiErrorText(json, { locale: 'de', catalogs: [errorsTournaments] })).toContain(
      '1 Teilnehmer konnte nicht aktualisiert werden',
    );
    expect(json.error).toContain('only partly saved');
    expect(expireTournamentReads).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', undefined);
  });

  it('keeps the static 500 fallback for an unexpected seed write error', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    mockUpcomingTournamentFetch();
    vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);
    vi.mocked(updateParticipantSeeds).mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await PATCH(makeRequest({ seeds: [{ player_id: PLAYER_1, seed: 1 }] }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to update seeds');
    expect(json.code).toBeUndefined();
    expect(expireTournamentReads).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/tournaments/[id]/participants — audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
    vi.mocked(getTournamentById).mockResolvedValue({ ...mockUpcomingTournament, name: 'Spring Open' } as never);
    vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);
    vi.mocked(updateParticipantSeeds).mockResolvedValue(undefined as never);
  });

  it('records one tournament.seeds.update event after a successful save', async () => {
    const res = await PATCH(
      makeRequest({
        seeds: [
          { player_id: PLAYER_1, seed: 2 },
          { player_id: PLAYER_2, seed: null },
        ],
      }),
      routeParams,
    );

    expect(res.status).toBe(200);
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith({
      actor_id: 'admin-1',
      actor_name: 'Admin',
      action: 'tournament.seeds.update',
      resource_type: 'tournament',
      resource_id: '22222222-2222-4222-8222-222222222222',
      resource_name: 'Spring Open',
      metadata: { participants: 2, seeded: 1 },
    });
    // Written after the seeds, never before.
    expect(vi.mocked(updateParticipantSeeds).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(logAuditEvent).mock.invocationCallOrder[0],
    );
  });

  it('records nothing for a duplicate-seed 400', async () => {
    const res = await PATCH(
      makeRequest({
        seeds: [
          { player_id: PLAYER_1, seed: 1 },
          { player_id: PLAYER_2, seed: 1 },
        ],
      }),
      routeParams,
    );

    expect(res.status).toBe(400);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('records nothing for a validation error', async () => {
    const res = await PATCH(makeRequest({ seeds: [] }), routeParams);

    expect(res.status).toBe(400);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('records nothing once seeding is locked', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(mockActiveTournament as never);

    const res = await PATCH(makeRequest({ seeds: [{ player_id: PLAYER_1, seed: 1 }] }), routeParams);

    expect(res.status).toBe(400);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('records nothing when the write is only partly saved or conflicts', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(updateParticipantSeeds).mockRejectedValueOnce(new SeedUpdatePartialError([PLAYER_2], [new Error('write err')]));
    const partial = await PATCH(makeRequest({ seeds: [{ player_id: PLAYER_1, seed: 1 }] }), routeParams);
    expect(partial.status).toBe(500);

    vi.mocked(updateParticipantSeeds).mockRejectedValueOnce(new SeedConflictError(2));
    const conflict = await PATCH(makeRequest({ seeds: [{ player_id: PLAYER_1, seed: 1 }] }), routeParams);
    expect(conflict.status).toBe(409);

    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
