import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Ruleset } from '@/types/ruleset';

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/rulesets', () => ({
  getRulesetById: vi.fn(),
  updateRuleset: vi.fn(),
  deleteRuleset: vi.fn(),
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { GET, PATCH, DELETE } from '@/app/api/rulesets/[id]/route';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import { getRulesetById, updateRuleset, deleteRuleset } from '@/lib/supabase/queries/rulesets';
import { safeErrorResponse } from '@/lib/api/error-response';

const mockRuleset: Ruleset = {
  id: 'ruleset-1',
  name: 'Standard OU',
  base_format: 'gen9ou',
  is_doubles: false,
  clauses: ['Species Clause', 'Sleep Clause'],
  bans: { pokemon: [], moves: [], items: [], abilities: [] },
  additions: { pokemon: [] },
  custom_rules_string: '',
  min_shared_type_pct: 0,
  team_constraints: null,
  created_by: 'admin-1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const adminPlayer = {
  playerId: 'admin-1',
  name: 'Admin',
  isAdmin: true,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active' as const,
};

const makeRouteArgs = (id: string) => ({ params: Promise.resolve({ id }) });

describe('GET /api/rulesets/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ruleset by id (public, no auth)', async () => {
    vi.mocked(getRulesetById).mockResolvedValue(mockRuleset);

    const request = {} as unknown as NextRequest;
    const response = await GET(request, makeRouteArgs('ruleset-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(mockRuleset);
    expect(vi.mocked(requireAdmin)).not.toHaveBeenCalled();
  });

  it('returns 404 when ruleset not found', async () => {
    vi.mocked(getRulesetById).mockResolvedValue(null);

    const request = {} as unknown as NextRequest;
    const response = await GET(request, makeRouteArgs('nonexistent'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Ruleset not found');
    expect(body.code).toBe('ruleset_not_found');
  });

  it('delegates unexpected error to safeErrorResponse', async () => {
    const dbErr = new Error('DB error');
    vi.mocked(getRulesetById).mockRejectedValue(dbErr);
    vi.mocked(safeErrorResponse).mockReturnValue(
      new (await import('next/server')).NextResponse(
        JSON.stringify({ success: false, error: 'Failed to fetch ruleset' }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ),
    );

    const request = {} as unknown as NextRequest;
    const response = await GET(request, makeRouteArgs('ruleset-1'));

    expect(response.status).toBe(500);
    expect(vi.mocked(safeErrorResponse)).toHaveBeenCalledWith(dbErr, 'Failed to fetch ruleset');
  });
});

describe('PATCH /api/rulesets/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns auth error via safeErrorResponse when not admin', async () => {
    const authErr = new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required', 403);
    vi.mocked(requireAdmin).mockRejectedValue(authErr);
    vi.mocked(safeErrorResponse).mockReturnValue(
      new (await import('next/server')).NextResponse(
        JSON.stringify({ success: false, error: 'Admin access required' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    );

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Updated' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('ruleset-1'));

    expect(response.status).toBe(403);
    expect(vi.mocked(safeErrorResponse)).toHaveBeenCalledWith(authErr, 'Failed to update ruleset');
  });

  it('updates ruleset successfully', async () => {
    const updated = { ...mockRuleset, name: 'Updated OU' };
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(updateRuleset).mockResolvedValue(updated);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Updated OU' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('ruleset-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(updated);
    expect(vi.mocked(updateRuleset)).toHaveBeenCalledWith('ruleset-1', { name: 'Updated OU' });
  });

  it('delegates unexpected error to safeErrorResponse', async () => {
    const dbErr = new Error('DB error');
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(updateRuleset).mockRejectedValue(dbErr);
    vi.mocked(safeErrorResponse).mockReturnValue(
      new (await import('next/server')).NextResponse(
        JSON.stringify({ success: false, error: 'Failed to update ruleset' }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ),
    );

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Fail' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('ruleset-1'));

    expect(response.status).toBe(500);
    expect(vi.mocked(safeErrorResponse)).toHaveBeenCalledWith(dbErr, 'Failed to update ruleset');
  });
});

describe('DELETE /api/rulesets/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns auth error via safeErrorResponse when not admin', async () => {
    const authErr = new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required', 403);
    vi.mocked(requireAdmin).mockRejectedValue(authErr);
    vi.mocked(safeErrorResponse).mockReturnValue(
      new (await import('next/server')).NextResponse(
        JSON.stringify({ success: false, error: 'Admin access required' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    );

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('ruleset-1'));

    expect(response.status).toBe(403);
    expect(vi.mocked(safeErrorResponse)).toHaveBeenCalledWith(authErr, 'Failed to delete ruleset');
  });

  it('deletes ruleset and returns null data', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(deleteRuleset).mockResolvedValue(undefined);

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('ruleset-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
    expect(vi.mocked(deleteRuleset)).toHaveBeenCalledWith('ruleset-1');
  });

  it('delegates unexpected error to safeErrorResponse', async () => {
    const dbErr = new Error('FK constraint');
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(deleteRuleset).mockRejectedValue(dbErr);
    vi.mocked(safeErrorResponse).mockReturnValue(
      new (await import('next/server')).NextResponse(
        JSON.stringify({ success: false, error: 'Failed to delete ruleset' }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ),
    );

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('ruleset-1'));

    expect(response.status).toBe(500);
    expect(vi.mocked(safeErrorResponse)).toHaveBeenCalledWith(dbErr, 'Failed to delete ruleset');
  });
});
