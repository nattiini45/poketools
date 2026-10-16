import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn(),
  requireAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/team-roles', () => ({
  getActiveRoles: vi.fn(),
  bulkCreateRoles: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { POST } from '../route';
import { revalidateTag } from 'next/cache';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import { bulkCreateRoles } from '@/lib/supabase/queries/team-roles';

const ROLE = { species_form: 'Garchomp', stage: 3, category: 'hazard_setting', move_name: 'Stealth Rock' };

function makeRequest(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

describe('POST /api/team-roles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
    vi.mocked(bulkCreateRoles).mockResolvedValue(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('imports the roles and expires the cached role catalogue (D37)', async () => {
    const res = await POST(makeRequest({ roles: [ROLE] }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual({ success: true, data: { imported: 1 } });
    // The league matchup page reads the catalogue from the public read cache.
    expect(revalidateTag).toHaveBeenCalledWith('team-roles', { expire: 0 });
    expect(vi.mocked(bulkCreateRoles).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(revalidateTag).mock.invocationCallOrder[0]);
  });

  it('expires nothing when validation fails', async () => {
    const res = await POST(makeRequest({ roles: [] }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^Validation failed: /);
    expect(json.code).toBe('validation_failed');
    expect(json.error).toBe(`Validation failed: ${json.params.issues}`);
    expect(bulkCreateRoles).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('expires nothing when the write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(bulkCreateRoles).mockRejectedValue(new Error('db down'));

    const res = await POST(makeRequest({ roles: [ROLE] }));

    expect(res.status).toBe(500);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('expires nothing for a non-admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new AuthError('Admin access required', 403));

    const res = await POST(makeRequest({ roles: [ROLE] }));

    expect(res.status).toBe(403);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
