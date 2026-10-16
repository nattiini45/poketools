import { describe, it, expect, vi, beforeEach } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// ── Mocks ──────────────────────────────────────────────────────────

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

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getCorePool: vi.fn(),
  getSeasonParticipants: vi.fn(),
  setParticipantCores: vi.fn(),
}));

import { POST } from '../route';
import { requireResourceAdmin, AuthError } from '@/lib/auth/helpers';
import {
  getCorePool,
  getSeasonParticipants,
  setParticipantCores,
} from '@/lib/supabase/queries/seasons';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';
import { revalidateTag } from 'next/cache';

const POOL = [
  ['Fire', 'Water', 'Grass'],
  ['Fairy', 'Fighting', 'Steel'],
  ['Psychic', 'Rock', 'Bug'],
  ['Dark', 'Dragon', 'Ghost'],
] as const;

function mockParticipants(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    discord_id: '0',
    auth_user_id: null,
    ps_username: '',
    champions_username: '',
    is_admin: false,
    is_creator: false,
    is_test_account: false,
    is_guest: false,
    joined_date: '2024-01-01',
    avatar_url: null,
    avatar_config: null,
    status: 'active' as const,
    suspended_until: null,
    ban_reason: null,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    gym_type: null,
    core_types: null,
    core_assigned_at: null,
  }));
}

describe('POST /api/seasons/[id]/cores/assign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
  });

  it('rejects unauthorized requests', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(new AuthError('Forbidden', 403));

    const req = makeRequest({ force: false });
    const res = await POST(req, { params: makeParams({ id: 's1' }) });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Forbidden');
  });

  it('returns 400 when the season has no core pool', async () => {
    vi.mocked(getCorePool).mockResolvedValue(null);
    vi.mocked(getSeasonParticipants).mockResolvedValue(mockParticipants(3));

    const req = makeRequest({ force: false });
    const res = await POST(req, { params: makeParams({ id: 's1' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/no core pool/);
    expect(json.code).toBe('core_pool_missing');
  });

  it('returns 400 when the season has no participants', async () => {
    vi.mocked(getCorePool).mockResolvedValue(POOL.map((t) => [...t] as never) as never);
    vi.mocked(getSeasonParticipants).mockResolvedValue([]);

    const req = makeRequest({ force: false });
    const res = await POST(req, { params: makeParams({ id: 's1' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/no participants/);
    expect(json.code).toBe('core_no_participants');
  });

  it('returns 400 when the pool is smaller than required', async () => {
    vi.mocked(getCorePool).mockResolvedValue([['Fire', 'Water', 'Grass']] as never);
    vi.mocked(getSeasonParticipants).mockResolvedValue(mockParticipants(3));

    const req = makeRequest({ force: false });
    const res = await POST(req, { params: makeParams({ id: 's1' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.code).toBe('core_assignment_error');
    // Specific cause must pass through — no generic collapse (CLAUDE.md:
    // no error generalization/masking).
    expect(json.error).toMatch(/Core pool has 1 available/);
    // The counts travel as params, so the client can word them in German.
    expect(json.params).toEqual({ available: 1, needed: 3 });
  });

  it('rejects a malformed body with validation_failed', async () => {
    const req = makeRequest({ force: 'yes' });
    const res = await POST(req, { params: makeParams({ id: 's1' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(json.params).toEqual({ issues: json.error });
  });

  it('assigns cores deterministically when a seed is provided', async () => {
    vi.mocked(getCorePool).mockResolvedValue(POOL.map((t) => [...t]) as never);
    vi.mocked(getSeasonParticipants).mockResolvedValue(mockParticipants(3));
    vi.mocked(setParticipantCores).mockResolvedValue(undefined as never);

    const reqA = makeRequest({ force: false, seed: 42 });
    const resA = await POST(reqA, { params: makeParams({ id: 's1' }) });
    const bodyA = await resA.json();

    vi.clearAllMocks();
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getCorePool).mockResolvedValue(POOL.map((t) => [...t]) as never);
    vi.mocked(getSeasonParticipants).mockResolvedValue(mockParticipants(3));
    vi.mocked(setParticipantCores).mockResolvedValue(undefined as never);

    const reqB = makeRequest({ force: false, seed: 42 });
    const resB = await POST(reqB, { params: makeParams({ id: 's1' }) });
    const bodyB = await resB.json();

    expect(resA.status).toBe(200);
    expect(bodyA.success).toBe(true);
    expect(bodyA.data.assignedCount).toBe(3);
    expect(bodyA.data.skippedCount).toBe(0);
    expect(bodyB.data.assignments).toEqual(bodyA.data.assignments);
  });

  it('persists assignments via setParticipantCores', async () => {
    vi.mocked(getCorePool).mockResolvedValue(POOL.map((t) => [...t]) as never);
    vi.mocked(getSeasonParticipants).mockResolvedValue(mockParticipants(2));
    vi.mocked(setParticipantCores).mockResolvedValue(undefined as never);

    const req = makeRequest({ force: false, seed: 1 });
    const res = await POST(req, { params: makeParams({ id: 's1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(setParticipantCores).toHaveBeenCalledTimes(1);
    const [seasonArg, assignmentsArg] = vi.mocked(setParticipantCores).mock.calls[0];
    expect(seasonArg).toBe('s1');
    expect(assignmentsArg).toHaveLength(2);
    expect(body.data.assignedCount).toBe(2);
    // D37: the cores show on the league page's next view.
    expect(revalidateTag).toHaveBeenCalledWith('season:s1', { expire: 0 });
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getCorePool).mockRejectedValue(new Error('DB error'));

    const req = makeRequest({ force: false });
    const res = await POST(req, { params: makeParams({ id: 's1' }) });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to assign cores');
  });
});
