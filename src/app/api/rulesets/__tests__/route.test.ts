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
  listRulesets: vi.fn(),
}));

// The builder bridge (flat body -> a gallery ruleset, version 1) has its own tests.
vi.mock('@/lib/ruleset-studio/legacy-bridge', () => ({
  createLegacyRuleset: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { GET, POST } from '@/app/api/rulesets/route';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import { listRulesets } from '@/lib/supabase/queries/rulesets';
import { createLegacyRuleset } from '@/lib/ruleset-studio/legacy-bridge';
import { toPublicRuleset } from '@/lib/ruleset-studio/view';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { safeErrorResponse } from '@/lib/api/error-response';

const mockRuleset: Ruleset = makeRuleset({
  id: 'ruleset-1',
  name: 'Standard OU',
  base_format: 'gen9ou',
  clauses: ['Species Clause', 'Sleep Clause'],
  bans: { pokemon: ['Koraidon'], moves: [], items: [], abilities: [] },
  created_by: 'admin-1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  version: { definition_id: 'definition-1', version_no: 1 },
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

describe('GET /api/rulesets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns rulesets list (public, no auth)', async () => {
    vi.mocked(listRulesets).mockResolvedValue([mockRuleset]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    // The flat shape of the old API; the frozen `rules` are not part of the public answer.
    expect(body.data).toEqual([toPublicRuleset(mockRuleset)]);
    expect(body.data[0]).not.toHaveProperty('rules');
    expect(body.data[0]).toMatchObject({ bans: { pokemon: ['Koraidon'] }, gen: 9, version: { version_no: 1 } });
    expect(vi.mocked(requireAdmin)).not.toHaveBeenCalled();
    // No actor: only what is shared with everyone.
    expect(vi.mocked(listRulesets)).toHaveBeenCalledWith();
  });

  it('delegates unexpected error to safeErrorResponse', async () => {
    const dbErr = new Error('DB error');
    vi.mocked(listRulesets).mockRejectedValue(dbErr);
    vi.mocked(safeErrorResponse).mockReturnValue(
      new (await import('next/server')).NextResponse(
        JSON.stringify({ success: false, error: 'Failed to fetch rulesets' }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ),
    );

    const response = await GET();

    expect(response.status).toBe(500);
    expect(vi.mocked(safeErrorResponse)).toHaveBeenCalledWith(dbErr, 'Failed to fetch rulesets');
  });
});

describe('POST /api/rulesets', () => {
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
      json: vi.fn().mockResolvedValue({ name: 'New Ruleset', base_format: 'gen9ou' }),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(vi.mocked(safeErrorResponse)).toHaveBeenCalledWith(authErr, 'Failed to create ruleset');
  });

  it('returns 400 when name is missing', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);

    const request = {
      json: vi.fn().mockResolvedValue({ base_format: 'gen9ou' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('name');
    expect(body.code).toBe('validation_failed');
  });

  it('creates ruleset and returns 201', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(createLegacyRuleset).mockResolvedValue(mockRuleset);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Standard OU', base_format: 'gen9ou' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(toPublicRuleset(mockRuleset));
    expect(vi.mocked(createLegacyRuleset)).toHaveBeenCalledWith(
      'admin-1',
      expect.objectContaining({ name: 'Standard OU', base_format: 'gen9ou' }),
    );
  });

  it('delegates unexpected error to safeErrorResponse', async () => {
    const dbErr = new Error('DB error');
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(createLegacyRuleset).mockRejectedValue(dbErr);
    vi.mocked(safeErrorResponse).mockReturnValue(
      new (await import('next/server')).NextResponse(
        JSON.stringify({ success: false, error: 'Failed to create ruleset' }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ),
    );

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Standard OU', base_format: 'gen9ou' }),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(500);
    expect(vi.mocked(safeErrorResponse)).toHaveBeenCalledWith(dbErr, 'Failed to create ruleset');
  });
});
