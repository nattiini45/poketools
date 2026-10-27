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

// A public read goes through the exposure check; the builder bridge (version-aware edit / delete) has its own tests.
vi.mock('@/lib/ruleset-studio/exposure', () => ({
  readExposedRuleset: vi.fn(),
}));

vi.mock('@/lib/ruleset-studio/legacy-bridge', () => ({
  updateLegacyRuleset: vi.fn(),
  deleteLegacyRuleset: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { GET, PATCH, DELETE } from '@/app/api/rulesets/[id]/route';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import { readExposedRuleset } from '@/lib/ruleset-studio/exposure';
import { updateLegacyRuleset, deleteLegacyRuleset } from '@/lib/ruleset-studio/legacy-bridge';
import { toPublicRuleset } from '@/lib/ruleset-studio/view';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { safeErrorResponse } from '@/lib/api/error-response';

const mockRuleset: Ruleset = makeRuleset({
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Standard OU',
  base_format: 'gen9ou',
  clauses: ['Species Clause', 'Sleep Clause'],
  created_by: 'admin-1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  version: { definition_id: 'definition-1', version_no: 2 },
});

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
    vi.mocked(readExposedRuleset).mockResolvedValue(mockRuleset);

    const request = {} as unknown as NextRequest;
    const response = await GET(request, makeRouteArgs('33333333-3333-4333-8333-333333333333'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    // `id` is a version id (what a league pins); the answer is the flat shape without the frozen rules.
    expect(body.data).toEqual(toPublicRuleset(mockRuleset));
    expect(body.data).not.toHaveProperty('rules');
    expect(vi.mocked(requireAdmin)).not.toHaveBeenCalled();
  });

  it('returns 404 when ruleset not found', async () => {
    // Unknown id, or a private ruleset that no league pins: the same 404.
    vi.mocked(readExposedRuleset).mockResolvedValue(null);

    const request = {} as unknown as NextRequest;
    const response = await GET(request, makeRouteArgs('99999999-9999-4999-8999-999999999999'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Ruleset not found');
    expect(body.code).toBe('ruleset_not_found');
  });

  it('delegates unexpected error to safeErrorResponse', async () => {
    const dbErr = new Error('DB error');
    vi.mocked(readExposedRuleset).mockRejectedValue(dbErr);
    vi.mocked(safeErrorResponse).mockReturnValue(
      new (await import('next/server')).NextResponse(
        JSON.stringify({ success: false, error: 'Failed to fetch ruleset' }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ),
    );

    const request = {} as unknown as NextRequest;
    const response = await GET(request, makeRouteArgs('33333333-3333-4333-8333-333333333333'));

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

    const response = await PATCH(request, makeRouteArgs('33333333-3333-4333-8333-333333333333'));

    expect(response.status).toBe(403);
    expect(vi.mocked(safeErrorResponse)).toHaveBeenCalledWith(authErr, 'Failed to update ruleset');
  });

  it('updates ruleset successfully', async () => {
    const updated = {
      ...mockRuleset,
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Updated OU',
      version: { definition_id: 'definition-1', version_no: 3 },
    };
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(updateLegacyRuleset).mockResolvedValue(updated);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Updated OU' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('33333333-3333-4333-8333-333333333333'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    // The edit is published as a NEW version (a new id); leagues pinned to the old version keep it.
    expect(body.data).toEqual(toPublicRuleset(updated));
    expect(vi.mocked(updateLegacyRuleset)).toHaveBeenCalledWith('admin-1', '33333333-3333-4333-8333-333333333333', { name: 'Updated OU' });
  });

  it('delegates unexpected error to safeErrorResponse', async () => {
    const dbErr = new Error('DB error');
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(updateLegacyRuleset).mockRejectedValue(dbErr);
    vi.mocked(safeErrorResponse).mockReturnValue(
      new (await import('next/server')).NextResponse(
        JSON.stringify({ success: false, error: 'Failed to update ruleset' }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ),
    );

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Fail' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('33333333-3333-4333-8333-333333333333'));

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
    const response = await DELETE(request, makeRouteArgs('33333333-3333-4333-8333-333333333333'));

    expect(response.status).toBe(403);
    expect(vi.mocked(safeErrorResponse)).toHaveBeenCalledWith(authErr, 'Failed to delete ruleset');
  });

  it('deletes ruleset and returns null data', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(deleteLegacyRuleset).mockResolvedValue(undefined);

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('33333333-3333-4333-8333-333333333333'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
    expect(vi.mocked(deleteLegacyRuleset)).toHaveBeenCalledWith(adminPlayer, '33333333-3333-4333-8333-333333333333');
  });

  it('delegates unexpected error to safeErrorResponse', async () => {
    const dbErr = new Error('FK constraint');
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(deleteLegacyRuleset).mockRejectedValue(dbErr);
    vi.mocked(safeErrorResponse).mockReturnValue(
      new (await import('next/server')).NextResponse(
        JSON.stringify({ success: false, error: 'Failed to delete ruleset' }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ),
    );

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('33333333-3333-4333-8333-333333333333'));

    expect(response.status).toBe(500);
    expect(vi.mocked(safeErrorResponse)).toHaveBeenCalledWith(dbErr, 'Failed to delete ruleset');
  });

  it('answers a precise 409 when a league in the trash still uses the ruleset (junction key)', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(deleteLegacyRuleset).mockRejectedValue({
      code: '23503',
      message:
        'update or delete on table "rulesets" violates foreign key constraint "league_trash_rulesets_ruleset_id_fkey" on table "league_trash_rulesets"',
    });
    vi.mocked(safeErrorResponse).mockReturnValue(
      new (await import('next/server')).NextResponse(JSON.stringify({ success: false }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await DELETE({} as unknown as NextRequest, makeRouteArgs('33333333-3333-4333-8333-333333333333'));

    expect(response.status).toBe(409);
    expect(vi.mocked(safeErrorResponse)).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ruleset_in_trashed_league', statusCode: 409 }),
      'Failed to delete ruleset',
    );
  });

  it('leaves another foreign-key violation to the generic handler', async () => {
    const other = { code: '23503', message: 'violates foreign key constraint "tournaments_ruleset_id_fkey"' };
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(deleteLegacyRuleset).mockRejectedValue(other);
    vi.mocked(safeErrorResponse).mockReturnValue(
      new (await import('next/server')).NextResponse(JSON.stringify({ success: false }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await DELETE({} as unknown as NextRequest, makeRouteArgs('33333333-3333-4333-8333-333333333333'));

    expect(vi.mocked(safeErrorResponse)).toHaveBeenCalledWith(other, 'Failed to delete ruleset');
  });
});
