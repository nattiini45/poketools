import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePlayer, MockAuthError } from '@/lib/__tests__/helpers/auth-mock';
import { makeParams, makeRequest } from '@/lib/__tests__/helpers/api-request';

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn(),
  requireAdmin: vi.fn(),
  AuthError: MockAuthError,
}));

vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({
  getPointBuyListVersions: vi.fn(),
  createListVersion: vi.fn(),
  getPointBuyListById: vi.fn(),
  deactivateListVersion: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { POST } from '../route';
import { GET as getOne, PATCH } from '../[id]/route';
import { requireAdmin, requireAuth } from '@/lib/auth/helpers';
import { createListVersion, deactivateListVersion, getPointBuyListById } from '@/lib/supabase/queries/point-buy-lists';

const admin = makePlayer({ playerId: 'admin-1', isAdmin: true });

describe('point-buy list routes error codes (errors/draft-legacy)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(admin as never);
    vi.mocked(requireAdmin).mockResolvedValue(admin);
    vi.mocked(getPointBuyListById).mockResolvedValue(null);
  });

  it('POST: validation_failed keeps the English text and sends the issues as its param', async () => {
    const res = await POST(makeRequest({ name: '' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(json.error).toBe(`Validation failed: ${json.params.issues}`);
    expect(createListVersion).not.toHaveBeenCalled();
  });

  it('GET [id]: point_buy_list_not_found', async () => {
    const res = await getOne(makeRequest(), { params: makeParams({ id: 'missing' }) });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toMatchObject({ error: 'Point-buy list not found', code: 'point_buy_list_not_found' });
  });

  it('PATCH [id]: point_buy_list_not_found', async () => {
    const res = await PATCH(makeRequest({}), { params: makeParams({ id: 'missing' }) });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toMatchObject({ error: 'Point-buy list not found', code: 'point_buy_list_not_found' });
    expect(deactivateListVersion).not.toHaveBeenCalled();
  });
});
