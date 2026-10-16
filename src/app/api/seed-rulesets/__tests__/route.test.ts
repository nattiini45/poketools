import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { NextResponse } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/client', () => ({
  supabase: createMockSupabase(),
}));
import { createMockSupabase } from '@/lib/__tests__/helpers/supabase-mock';
import { supabase } from '@/lib/supabase/client';

const mockRequireAdmin = vi.fn();
vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/pkmn/formats', () => ({
  FORMAT_DEFAULTS: {
    blank: { name: 'Blank', is_doubles: false, clauses: [], banned_pokemon: [], banned_moves: [], banned_items: [] },
    gen9ou: { name: 'Gen 9 OU', is_doubles: false, clauses: ['Species Clause'], banned_pokemon: ['Koraidon'], banned_moves: [], banned_items: [] },
    gen9uu: { name: 'Gen 9 UU', is_doubles: false, clauses: ['Species Clause'], banned_pokemon: [], banned_moves: [], banned_items: [] },
  },
}));

import { POST } from '../route';
import { safeErrorResponse } from '@/lib/api/error-response';
import { makeRequest } from '@/lib/__tests__/helpers/api-request';

const mock = supabase as unknown as ReturnType<typeof createMockSupabase>;

describe('POST /api/seed-rulesets', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    (mock as unknown as { __reset: () => void }).__reset();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.BOOTSTRAP_MODE_ENABLED;
    delete process.env.BOOTSTRAP_SECRET;
    // By default requireAdmin rejects (not authenticated)
    mockRequireAdmin.mockRejectedValue(new Error('Not authenticated'));
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('seeds rulesets when admin authenticated', async () => {
    mockRequireAdmin.mockResolvedValue(undefined);

    // We override .then to return different results in sequence
    let callCount = 0;
    const results = [
      { data: [], error: null },
      { data: [{ name: 'Gen 9 OU' }, { name: 'Gen 9 UU' }], error: null },
    ];
    (mock.then as ReturnType<typeof vi.fn>).mockImplementation(
      (resolve: (v: unknown) => void) => resolve(results[callCount++])
    );

    const req = makeRequest();
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.count).toBe(2);
    expect(json.data.message).toContain('Seeded 2');
  });

  it('returns 403 when not admin and bootstrap mode disabled', async () => {
    const req = makeRequest();
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Admin authentication required.');
    expect(json.code).toBe('seed_rulesets_admin_required');
  });

  it('allows bootstrap secret when BOOTSTRAP_MODE_ENABLED is true', async () => {
    process.env.BOOTSTRAP_MODE_ENABLED = 'true';
    process.env.BOOTSTRAP_SECRET = 'my-secret';

    let callCount = 0;
    const results = [
      { data: [], error: null },
      { data: [{ name: 'Gen 9 OU' }], error: null },
    ];
    (mock.then as ReturnType<typeof vi.fn>).mockImplementation(
      (resolve: (v: unknown) => void) => resolve(results[callCount++])
    );

    const req = makeRequest({ secret: 'my-secret' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
  });

  it('returns 403 when bootstrap secret is incorrect', async () => {
    process.env.BOOTSTRAP_MODE_ENABLED = 'true';
    process.env.BOOTSTRAP_SECRET = 'correct-secret';

    const req = makeRequest({ secret: 'wrong-secret' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Invalid or missing bootstrap secret.');
    expect(json.code).toBe('seed_rulesets_secret_invalid');
  });

  it('returns 403 when bootstrap secret is missing from body', async () => {
    process.env.BOOTSTRAP_MODE_ENABLED = 'true';
    process.env.BOOTSTRAP_SECRET = 'correct-secret';

    const req = makeRequest({});
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Invalid or missing bootstrap secret.');
    expect(json.code).toBe('seed_rulesets_secret_invalid');
  });

  it('returns "nothing to seed" when all rulesets already exist', async () => {
    mockRequireAdmin.mockResolvedValue(undefined);

    // Return existing names that match FORMAT_DEFAULTS (minus blank)
    const existingNames = [{ name: 'Gen 9 OU' }, { name: 'Gen 9 UU' }];
    (mock.then as ReturnType<typeof vi.fn>).mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: existingNames, error: null })
    );

    const req = makeRequest();
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.message).toContain('Nothing to seed');
  });

  it('delegates to safeErrorResponse on fetch error', async () => {
    mockRequireAdmin.mockResolvedValue(undefined);
    (mock.then as ReturnType<typeof vi.fn>).mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: new Error('DB down') })
    );

    const req = makeRequest();
    const res = await POST(req);

    expect(res.status).toBe(500);
    expect(safeErrorResponse).toHaveBeenCalled();
  });
});
