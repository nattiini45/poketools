import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Mocks ───────────────────────────────────────────────────────────

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

vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  getResourceAdmins: vi.fn(),
  addResourceAdmin: vi.fn(),
  removeResourceAdmin: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { GET, POST, DELETE } from '@/app/api/resource-admins/route';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import {
  getResourceAdmins,
  addResourceAdmin,
  removeResourceAdmin,
} from '@/lib/supabase/queries/resource-admins';

// ─── Helpers ─────────────────────────────────────────────────────────

const UUID_1 = '00000000-0000-4000-8000-000000000001';
const UUID_2 = '00000000-0000-4000-8000-000000000002';

const mockAdmin = {
  playerId: 'p-1',
  name: 'Admin User',
  isAdmin: true,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: 'admin',
  championsUsername: null,
  avatarUrl: null,
};

const makeRequest = (body: Record<string, unknown>) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

const makeGetRequest = (params: Record<string, string>) => {
  const url = new URL('http://localhost/api/resource-admins');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { url: url.toString() } as unknown as NextRequest;
};

// ─── Tests ───────────────────────────────────────────────────────────

describe('GET /api/resource-admins', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authorized', 403),
    );

    const res = await GET(makeGetRequest({ resource_type: 'tournament', resource_id: UUID_1 }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
  });

  it('returns 400 when params missing', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const res = await GET(makeGetRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('required');
    expect(json.code).toBe('resource_admin_target_required');
  });

  it('returns 400 for invalid resource_type', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const res = await GET(makeGetRequest({ resource_type: 'invalid', resource_id: UUID_1 }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('tournament');
    expect(json.code).toBe('validation_failed');
  });

  it('returns resource admins successfully', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    const admins = [{ id: 'ra-1', player_id: UUID_1 }];
    vi.mocked(getResourceAdmins).mockResolvedValue(admins as never);

    const res = await GET(makeGetRequest({ resource_type: 'tournament', resource_id: UUID_1 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(admins);
  });
});

describe('POST /api/resource-admins', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authorized', 403),
    );

    const res = await POST(makeRequest({
      player_id: UUID_1,
      resource_type: 'tournament',
      resource_id: UUID_2,
    }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
  });

  it('returns 400 when required fields missing', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const res = await POST(makeRequest({ player_id: UUID_1 }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('resource_type');
    expect(json.code).toBe('validation_failed');
  });

  it('returns 400 for invalid resource_type', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const res = await POST(makeRequest({
      player_id: UUID_1,
      resource_type: 'invalid',
      resource_id: UUID_2,
    }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('tournament');
    expect(json.code).toBe('validation_failed');
  });

  it('assigns resource admin successfully', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    const adminRecord = { id: 'ra-1', player_id: UUID_1 };
    vi.mocked(addResourceAdmin).mockResolvedValue(adminRecord as never);

    const res = await POST(makeRequest({
      player_id: UUID_1,
      resource_type: 'tournament',
      resource_id: UUID_2,
    }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(adminRecord);
  });
});

describe('DELETE /api/resource-admins', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authorized', 403),
    );

    const res = await DELETE(makeRequest({
      player_id: UUID_1,
      resource_type: 'tournament',
      resource_id: UUID_2,
    }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
  });

  it('returns 400 when required fields missing', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const res = await DELETE(makeRequest({ player_id: UUID_1 }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('resource_type');
    expect(json.code).toBe('validation_failed');
  });

  it('returns 400 for invalid resource_type', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const res = await DELETE(makeRequest({
      player_id: UUID_1,
      resource_type: 'invalid',
      resource_id: UUID_2,
    }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('tournament');
    expect(json.code).toBe('validation_failed');
  });

  it('removes resource admin successfully', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(removeResourceAdmin).mockResolvedValue(undefined as never);

    const res = await DELETE(makeRequest({
      player_id: UUID_1,
      resource_type: 'season',
      resource_id: UUID_2,
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(removeResourceAdmin).toHaveBeenCalledWith(UUID_1, 'season', UUID_2);
  });
});