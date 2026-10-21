import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────

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

vi.mock('@/lib/players/roster-access', () => ({
  canViewAdminRoster: vi.fn(),
}));

// The write paths expire the public read cache (SD); revalidateTag needs a
// Next request scope, which a unit test does not have.
vi.mock('@/lib/revalidation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/revalidation')>()),
  expireSeasonReads: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonParticipants: vi.fn(),
  getPublicSeasonParticipants: vi.fn(),
  addSeasonParticipant: vi.fn(),
  updateParticipantGymType: vi.fn(),
  updateParticipantCoreTypes: vi.fn(),
}));

vi.mock('server-only', () => ({}));
// The roster's removal and the add refusal go through the league-group queries: the real error mapping, a mocked RPC.
vi.mock('@/lib/supabase/queries/season-groups', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase/queries/season-groups')>(
    '@/lib/supabase/queries/season-groups',
  );
  return { removeLeagueParticipant: vi.fn(), toRosterAddError: actual.toRosterAddError };
});

import { GET, POST, DELETE, PATCH } from '../route';
import { requireResourceAdmin, AuthError } from '@/lib/auth/helpers';
import { canViewAdminRoster } from '@/lib/players/roster-access';
import { expireSeasonReads } from '@/lib/revalidation';
import {
  getSeasonParticipants,
  getPublicSeasonParticipants,
  addSeasonParticipant,
  updateParticipantGymType,
  updateParticipantCoreTypes,
} from '@/lib/supabase/queries/seasons';
import { removeLeagueParticipant } from '@/lib/supabase/queries/season-groups';
import { DraftRuleError } from '@/lib/draft/errors';
import { CoreNotInPoolError, CoreTypesConflictError } from '@/lib/season/core-assignment';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';
import { expectNoPrivatePlayerData, fullPlayerRow } from '@/lib/players/__tests__/private-player-fields';
import type { SeasonParticipant } from '@/types/season';

// ── Test data ─────────────────────────────────────────────────────────

/** Full participant rows, private columns set to sentinels (what getSeasonParticipants returns). */
function fullParticipant(id: string, gym_type: string | null): SeasonParticipant {
  return {
    ...fullPlayerRow({ id, name: `Player ${id}`, is_guest: id === 'p2' }),
    gym_type,
    core_types: ['Fire', 'Water', 'Grass'],
    core_assigned_at: '2026-01-03T00:00:00.000Z',
  };
}

const fullRows = [fullParticipant('p1', null), fullParticipant('p2', 'Fire')];

const VALID_PLAYER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

describe('GET /api/seasons/[id]/participants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(canViewAdminRoster).mockResolvedValue(false);
  });

  it('returns the public roster: id, name, gym band, avatar and core only', async () => {
    // Even if the narrow getter handed back a full row, the route maps field by field.
    vi.mocked(getPublicSeasonParticipants).mockResolvedValue(fullRows as never);

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual([
      { id: 'p1', name: 'Player p1', gym_type: null, avatar_url: fullRows[0].avatar_url, core_types: ['Fire', 'Water', 'Grass'] },
      { id: 'p2', name: 'Player p2', gym_type: 'Fire', avatar_url: fullRows[1].avatar_url, core_types: ['Fire', 'Water', 'Grass'] },
    ]);
    expect(getPublicSeasonParticipants).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    expect(getSeasonParticipants).not.toHaveBeenCalled();
    expect(canViewAdminRoster).toHaveBeenCalledWith('season', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  });

  it('the public response carries no private player column (JSON.stringify check)', async () => {
    vi.mocked(getPublicSeasonParticipants).mockResolvedValue(fullRows as never);

    const res = await GET(makeRequest(), { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });

    expectNoPrivatePlayerData(await res.json());
  });

  it('a confirmed roster admin gets the admin shape: adds only the guest and test flags', async () => {
    vi.mocked(canViewAdminRoster).mockResolvedValue(true);
    vi.mocked(getSeasonParticipants).mockResolvedValue(fullRows);

    const res = await GET(makeRequest(), { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data[1]).toEqual({
      id: 'p2',
      name: 'Player p2',
      gym_type: 'Fire',
      avatar_url: fullRows[1].avatar_url,
      core_types: ['Fire', 'Water', 'Grass'],
      is_guest: true,
      is_test_account: true,
    });
    expect(getPublicSeasonParticipants).not.toHaveBeenCalled();
    // Identity and moderation columns stay out even for admins.
    expectNoPrivatePlayerData(json, { allowKeys: ['is_test_account'] });
  });

  it('returns 500 when query fails', async () => {
    vi.mocked(getPublicSeasonParticipants).mockRejectedValue(new Error('DB error'));

    const req = makeRequest();
    const res = await GET(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to fetch participants');
  });

  it('a failed admin check fails the request instead of guessing a shape', async () => {
    vi.mocked(canViewAdminRoster).mockRejectedValue(new Error('live player read failed'));

    const res = await GET(makeRequest(), { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });

    expect(res.status).toBe(500);
    expect(getPublicSeasonParticipants).not.toHaveBeenCalled();
    expect(getSeasonParticipants).not.toHaveBeenCalled();
  });
});

describe('POST /api/seasons/[id]/participants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns auth error when not authorized', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(
      new AuthError('Forbidden', 403),
    );

    const req = makeRequest({ player_id: VALID_PLAYER_ID });
    const res = await POST(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Forbidden');
  });

  it('returns 400 when player_id is missing', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);

    const req = makeRequest({});
    const res = await POST(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('player_id');
    expect(json.code).toBe('validation_failed');
    expect(json.params).toEqual({ issues: json.error });
  });

  it('adds participant and returns 201', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(addSeasonParticipant).mockResolvedValue(undefined as never);

    const req = makeRequest({ player_id: VALID_PLAYER_ID });
    const res = await POST(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(addSeasonParticipant).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc', VALID_PLAYER_ID);
    expect(requireResourceAdmin).toHaveBeenCalledWith('season', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    expect(expireSeasonReads).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(addSeasonParticipant).mockRejectedValue(new Error('DB error'));

    const req = makeRequest({ player_id: VALID_PLAYER_ID });
    const res = await POST(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to add participant');
  });

  it('a grouped league with rounds refuses a new trainer: the trigger refusal is the catalogued 409', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    // What PostgREST hands back for the season_participants__group_guard refusal (20261018202100).
    vi.mocked(addSeasonParticipant).mockRejectedValue({ code: 'P0001', message: 'SEASON_GROUPS_SCHEDULED', details: null });

    const res = await POST(makeRequest({ player_id: VALID_PLAYER_ID }), { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('SEASON_GROUPS_SCHEDULED');
    expect(expireSeasonReads).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/seasons/[id]/participants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns auth error when not authorized', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(
      new AuthError('Forbidden', 403),
    );

    const req = makeRequest({ player_id: VALID_PLAYER_ID });
    const res = await DELETE(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Forbidden');
  });

  it('returns 400 when player_id is missing', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);

    const req = makeRequest({});
    const res = await DELETE(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('player_id');
  });

  it('removes participant on happy path', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(removeLeagueParticipant).mockResolvedValue(true);

    const req = makeRequest({ player_id: VALID_PLAYER_ID });
    const res = await DELETE(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(removeLeagueParticipant).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc', VALID_PLAYER_ID);
    expect(expireSeasonReads).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(removeLeagueParticipant).mockRejectedValue(new Error('DB error'));

    const req = makeRequest({ player_id: VALID_PLAYER_ID });
    const res = await DELETE(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to remove participant');
  });

  it('a trainer not on the roster: 200, nothing removed (unchanged behaviour)', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(removeLeagueParticipant).mockResolvedValue(false);

    const res = await DELETE(makeRequest({ player_id: VALID_PLAYER_ID }), { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });

    expect(res.status).toBe(200);
  });

  it.each([
    ['SEASON_GROUPS_SCHEDULED', 409],
    ['SEASON_GROUP_LOCKED', 409],
    ['SEASON_GROUP_TOO_SMALL', 422],
  ] as const)('the group rules refuse the removal: %s -> %i, the cache is not expired', async (code, status) => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(removeLeagueParticipant).mockRejectedValue(new DraftRuleError(code));

    const res = await DELETE(makeRequest({ player_id: VALID_PLAYER_ID }), { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(status);
    expect(json.code).toBe(code);
    expect(expireSeasonReads).not.toHaveBeenCalled();
  });

  it('a malformed league id is a 404 before the removal runs', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);

    const res = await DELETE(makeRequest({ player_id: VALID_PLAYER_ID }), { params: makeParams({ id: 'not-a-uuid' }) });

    expect(res.status).toBe(404);
    expect(removeLeagueParticipant).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/seasons/[id]/participants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns auth error when not authorized', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(
      new AuthError('Forbidden', 403),
    );

    const req = makeRequest({ player_id: VALID_PLAYER_ID, gym_type: 'Fire' });
    const res = await PATCH(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Forbidden');
  });

  it('returns 400 when player_id is missing', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);

    const req = makeRequest({ gym_type: 'Fire' });
    const res = await PATCH(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('player_id');
  });

  it('returns 400 for invalid gym type', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);

    const req = makeRequest({ player_id: VALID_PLAYER_ID, gym_type: 'InvalidType' });
    const res = await PATCH(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('gym_type');
  });

  it('accepts valid gym type', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(updateParticipantGymType).mockResolvedValue(undefined as never);

    const req = makeRequest({ player_id: VALID_PLAYER_ID, gym_type: 'Fire' });
    const res = await PATCH(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(updateParticipantGymType).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc', VALID_PLAYER_ID, 'Fire');
    expect(expireSeasonReads).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  });

  it('accepts null gym type (clear assignment)', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(updateParticipantGymType).mockResolvedValue(undefined as never);

    const req = makeRequest({ player_id: VALID_PLAYER_ID, gym_type: null });
    const res = await PATCH(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(updateParticipantGymType).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc', VALID_PLAYER_ID, null);
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(updateParticipantGymType).mockRejectedValue(new Error('DB error'));

    const req = makeRequest({ player_id: VALID_PLAYER_ID, gym_type: 'Water' });
    const res = await PATCH(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to update participant');
  });

  it('returns 400 when neither gym_type nor core_types is provided', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);

    const req = makeRequest({ player_id: VALID_PLAYER_ID });
    const res = await PATCH(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('gym_type');
    expect(json.code).toBe('participant_update_empty');
  });

  it('accepts valid core_types triple', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(updateParticipantCoreTypes).mockResolvedValue(undefined as never);

    const req = makeRequest({
      player_id: VALID_PLAYER_ID,
      core_types: ['Fire', 'Water', 'Grass'],
    });
    const res = await PATCH(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(updateParticipantCoreTypes).toHaveBeenCalledWith(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      VALID_PLAYER_ID,
      ['Fire', 'Water', 'Grass'],
    );
    expect(updateParticipantGymType).not.toHaveBeenCalled();
  });

  it('accepts null core_types (clear assignment)', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(updateParticipantCoreTypes).mockResolvedValue(undefined as never);

    const req = makeRequest({ player_id: VALID_PLAYER_ID, core_types: null });
    const res = await PATCH(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(updateParticipantCoreTypes).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc', VALID_PLAYER_ID, null);
  });

  it('returns 400 for invalid core_types (duplicate types)', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);

    const req = makeRequest({
      player_id: VALID_PLAYER_ID,
      core_types: ['Fire', 'Fire', 'Grass'],
    });
    const res = await PATCH(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('core_types');
  });

  it('returns 400 when core triple is already assigned', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(updateParticipantCoreTypes).mockRejectedValue(
      new CoreTypesConflictError(['Fire', 'Grass', 'Water']),
    );

    const req = makeRequest({
      player_id: VALID_PLAYER_ID,
      core_types: ['Water', 'Fire', 'Grass'],
    });
    const res = await PATCH(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('core_types_conflict');
    // Specific triple passes through — no generic collapse.
    expect(json.error).toBe('Fire/Grass/Water is already assigned to another participant');
    expect(json.params).toEqual({ types: 'Fire/Grass/Water' });
  });

  it('returns 400 when core triple is not in pool', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(updateParticipantCoreTypes).mockRejectedValue(
      new CoreNotInPoolError(['Fire', 'Grass', 'Water']),
    );

    const req = makeRequest({
      player_id: VALID_PLAYER_ID,
      core_types: ['Fire', 'Water', 'Grass'],
    });
    const res = await PATCH(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('core_not_in_pool');
    expect(json.error).toBe('Fire/Grass/Water is not in the season core pool');
    expect(json.params).toEqual({ types: 'Fire/Grass/Water' });
  });

  it('updates gym_type and core_types in one request', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(updateParticipantGymType).mockResolvedValue(undefined as never);
    vi.mocked(updateParticipantCoreTypes).mockResolvedValue(undefined as never);

    const req = makeRequest({
      player_id: VALID_PLAYER_ID,
      gym_type: 'Electric',
      core_types: ['Electric', 'Flying', 'Steel'],
    });
    const res = await PATCH(req, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(updateParticipantGymType).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc', VALID_PLAYER_ID, 'Electric');
    expect(updateParticipantCoreTypes).toHaveBeenCalledWith(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      VALID_PLAYER_ID,
      ['Electric', 'Flying', 'Steel'],
    );
  });
});
