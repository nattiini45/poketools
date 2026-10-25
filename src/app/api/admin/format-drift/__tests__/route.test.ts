import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/lib/supabase/queries/format-drift', () => ({
  listFormatRulesOrders: vi.fn(),
  listLeaguePhasesForDrift: vi.fn(),
}));

import { GET } from '@/app/api/admin/format-drift/route';
import { AuthError, requireAdmin } from '@/lib/auth/helpers';
import { listFormatRulesOrders, listLeaguePhasesForDrift } from '@/lib/supabase/queries/format-drift';
import { epbPack } from '@/lib/format-pack';

const phaseRow = (id: string, order: number, rule: unknown) => ({
  id,
  season_id: 's1',
  season_name: 'Spring',
  archived: false,
  is_test: false,
  name: `Phase ${order}`,
  stage_order: order,
  status: 'upcoming',
  advancement_rule: rule as never,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
  vi.mocked(listFormatRulesOrders).mockResolvedValue({
    rows: [
      {
        season_id: 's1',
        season_name: 'Spring',
        archived: false,
        is_test: false,
        tiebreaker_order: ['match_points', 'head_to_head'],
      },
    ],
    truncated: false,
  });
  vi.mocked(listLeaguePhasesForDrift).mockResolvedValue({
    rows: [phaseRow('p1', 1, { type: 'top_n', count: 4, per_group: false }), phaseRow('p2', 2, null)],
    truncated: true,
  });
});

describe('GET /api/admin/format-drift', () => {
  it('checks for a site admin before reading anything', async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new AuthError('Admin access required', 403));

    const res = await GET();

    expect(res.status).toBe(403);
    expect(listFormatRulesOrders).not.toHaveBeenCalled();
    expect(listLeaguePhasesForDrift).not.toHaveBeenCalled();
  });

  it('refuses a league or tournament admin (requireAdmin rejects), who would see every league', async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new AuthError('Forbidden', 403));

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.data).toBeUndefined();
    expect(listFormatRulesOrders).not.toHaveBeenCalled();
  });

  it('returns the report with the pack chain, both findings and the truncation flags', async () => {
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.packChain).toEqual([...epbPack.tiebreakerChain]);
    expect(json.data.tiebreaker.checked).toBe(1);
    expect(json.data.tiebreaker.cases).toHaveLength(1);
    expect(json.data.advancement.cases.map((c: { kind: string }) => c.kind)).toEqual(['source_only']);
    expect(json.data.truncated).toEqual({ formatRules: false, phases: true });
    expect(Number.isNaN(Date.parse(json.data.generatedAt))).toBe(false);
  });

  it('answers a query failure with the static fallback, never the error message', async () => {
    vi.mocked(listLeaguePhasesForDrift).mockRejectedValueOnce(new Error('relation "secret_table" does not exist'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await GET();
    const json = await res.json();
    errorSpy.mockRestore();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to build the format drift report');
    expect(JSON.stringify(json)).not.toContain('secret_table');
  });

  it('contains league and phase names and ids only, no player fields', async () => {
    const res = await GET();
    const text = JSON.stringify(await res.json());

    expect(text).not.toMatch(/player/i);
    expect(text).not.toMatch(/email|discord/i);
  });
});
