import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('@/lib/ruleset-studio/pin-change', () => ({
  assertRulesetChangeAllowed: vi.fn(),
  assertRulesetUsableForCreate: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';

// --------------- mocks ---------------

vi.mock('@/lib/auth/helpers', () => ({
  requireAnyAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/api/error-response', async () => {
  const { AuthError } = await import('@/lib/auth/helpers');
  const { NextResponse } = await import('next/server');
  return {
    safeErrorResponse: vi.fn((err: unknown, fallback: string) => {
      if (err instanceof AuthError) {
        return NextResponse.json(
          { success: false, error: (err as InstanceType<typeof AuthError>).message },
          { status: (err as InstanceType<typeof AuthError>).statusCode }
        );
      }
      return NextResponse.json({ success: false, error: fallback }, { status: 500 });
    }),
  };
});

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  listTournaments: vi.fn(),
  listArchivedTournaments: vi.fn(),
  getStagesBySeasonId: vi.fn(),
  createTournament: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  addResourceAdmin: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));

// --------------- imports (after mocks) ---------------

import { GET, POST } from '@/app/api/tournaments/route';
import { requireAnyAdmin, AuthError } from '@/lib/auth/helpers';
import {
  listTournaments,
  listArchivedTournaments,
  getStagesBySeasonId,
  createTournament,
} from '@/lib/supabase/queries/tournaments';
import { addResourceAdmin } from '@/lib/supabase/queries/resource-admins';
import { logAuditEvent } from '@/lib/audit/log';
import { revalidateTag } from 'next/cache';

// --------------- helpers ---------------

function makeGetRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/tournaments');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return { url: url.toString(), nextUrl: url } as unknown as NextRequest;
}

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

// --------------- tests ---------------

describe('GET /api/tournaments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the public tournament list (no filters)', async () => {
    const tournaments = [{ id: 't1', name: 'Open' }];
    vi.mocked(listTournaments).mockResolvedValue(tournaments as never);

    const response = await GET(makeGetRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data).toEqual(tournaments);
    expect(listTournaments).toHaveBeenCalled();
  });

  it('filters by season_id when provided', async () => {
    const stages = [{ id: 't2', name: 'Stage A' }];
    vi.mocked(getStagesBySeasonId).mockResolvedValue(stages as never);

    const response = await GET(makeGetRequest({ season_id: 's1' }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual(stages);
    expect(getStagesBySeasonId).toHaveBeenCalledWith('s1');
  });

  it('requires admin for archived tournaments', async () => {
    const archived = [{ id: 't3', name: 'Old' }];
    vi.mocked(listArchivedTournaments).mockResolvedValue(archived as never);

    const response = await GET(makeGetRequest({ archived: 'true' }));
    const payload = await response.json();

    expect(requireAnyAdmin).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(payload.data).toEqual(archived);
  });

  it('returns 401 when non-admin requests archived', async () => {
    vi.mocked(requireAnyAdmin).mockRejectedValue(new AuthError('Unauthorized', 401));

    const response = await GET(makeGetRequest({ archived: 'true' }));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.success).toBe(false);
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(listTournaments).mockRejectedValue(new Error('db down'));

    const response = await GET(makeGetRequest());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.success).toBe(false);
  });
});

describe('POST /api/tournaments', () => {
  beforeEach(() => vi.clearAllMocks());

  const validBody = {
    name: 'Weekly #5',
    ruleset_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    bracket_type: 'swiss',
  };

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(requireAnyAdmin).mockRejectedValue(new AuthError('Unauthorized', 401));

    const response = await POST(makePostRequest(validBody));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.success).toBe(false);
  });

  it('returns 400 when name is missing', async () => {
    vi.mocked(requireAnyAdmin).mockResolvedValue({
      playerId: 'p1',
      isAdmin: true,
      name: 'Admin',
    } as never);

    const response = await POST(makePostRequest({ ruleset_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', bracket_type: 'swiss' }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('name');
    expect(payload.code).toBe('validation_failed');
  });

  it('returns 400 when ruleset_id is missing', async () => {
    vi.mocked(requireAnyAdmin).mockResolvedValue({
      playerId: 'p1',
      isAdmin: true,
      name: 'Admin',
    } as never);

    const response = await POST(makePostRequest({ name: 'T', bracket_type: 'swiss' }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('ruleset_id');
    expect(payload.code).toBe('validation_failed');
  });

  it('returns 400 when bracket_type is missing', async () => {
    vi.mocked(requireAnyAdmin).mockResolvedValue({
      playerId: 'p1',
      isAdmin: true,
      name: 'Admin',
    } as never);

    const response = await POST(makePostRequest({ name: 'T', ruleset_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('bracket_type');
    expect(payload.code).toBe('validation_failed');
  });

  it('creates a tournament and returns 201', async () => {
    vi.mocked(requireAnyAdmin).mockResolvedValue({
      playerId: 'p1',
      isAdmin: true,
      name: 'Admin',
    } as never);
    const created = { id: 't-new', ...validBody };
    vi.mocked(createTournament).mockResolvedValue(created as never);

    const response = await POST(makePostRequest(validBody));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.data.id).toBe('t-new');
    // D37: the new tournament shows in the list on the next view.
    expect(revalidateTag).toHaveBeenCalledWith('tournaments', { expire: 0 });
  });

  it('logs tournament.create with the actor and the new tournament', async () => {
    vi.mocked(requireAnyAdmin).mockResolvedValue({
      playerId: 'p1',
      isAdmin: true,
      name: 'Admin',
    } as never);
    vi.mocked(createTournament).mockResolvedValue({ id: 't-new', ...validBody } as never);

    await POST(makePostRequest(validBody));

    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith({
      actor_id: 'p1',
      actor_name: 'Admin',
      action: 'tournament.create',
      resource_type: 'tournament',
      resource_id: 't-new',
      resource_name: 'Weekly #5',
      metadata: { bracket_type: 'swiss', ruleset_id: validBody.ruleset_id },
    });
  });

  it('logs no creation event for a rejected or failed create', async () => {
    vi.mocked(requireAnyAdmin).mockResolvedValue({
      playerId: 'p1',
      isAdmin: true,
      name: 'Admin',
    } as never);

    await POST(makePostRequest({ ...validBody, season_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12' }));
    vi.mocked(createTournament).mockRejectedValue(new Error('DB error'));
    await POST(makePostRequest(validBody));

    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('rejects season_id payloads (league phases use the phases API)', async () => {
    vi.mocked(requireAnyAdmin).mockResolvedValue({
      playerId: 'p1',
      isAdmin: true,
      name: 'Admin',
    } as never);

    const bodyWithSeason = { ...validBody, season_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12' };
    const response = await POST(makePostRequest(bodyWithSeason));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(createTournament).not.toHaveBeenCalled();
  });

  it('assigns resource admin for non-site-admins', async () => {
    vi.mocked(requireAnyAdmin).mockResolvedValue({
      playerId: 'p1',
      isAdmin: false,
      name: 'Creator',
    } as never);
    vi.mocked(createTournament).mockResolvedValue({ id: 't-new', ...validBody } as never);

    await POST(makePostRequest(validBody));

    expect(addResourceAdmin).toHaveBeenCalledWith('p1', 'tournament', 't-new');
  });

  it('does not assign resource admin for site admins', async () => {
    vi.mocked(requireAnyAdmin).mockResolvedValue({
      playerId: 'p1',
      isAdmin: true,
      name: 'Admin',
    } as never);
    vi.mocked(createTournament).mockResolvedValue({ id: 't-new', ...validBody } as never);

    await POST(makePostRequest(validBody));

    expect(addResourceAdmin).not.toHaveBeenCalled();
  });
});
