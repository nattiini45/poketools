/**
 * Characterization of /api/seasons/[id]/format-rules: the contract the Format Rules editor relies on.
 * The route itself is unchanged by the editor; these tests pin its guard order, validation, the body
 * that reaches the store, the audit entry and the empty answer for a league without a row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { epbPack } from '@/lib/format-pack';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { defaultFormatRulesPayload } from '@/lib/league-admin/format-rules-form';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  requireResourceAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));
vi.mock('@/lib/supabase/queries/format-rules', () => ({
  getFormatRules: vi.fn(),
  upsertFormatRules: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn(), getSeasonStageIds: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn() }));

import { GET, PUT } from '../route';
import { AuthError, requirePlayer, requireResourceAdmin } from '@/lib/auth/helpers';
import { getFormatRules, upsertFormatRules } from '@/lib/supabase/queries/format-rules';
import { getSeasonById, getSeasonStageIds } from '@/lib/supabase/queries/seasons';
import { logAuditEvent } from '@/lib/audit/log';
import { expireSeasonReads } from '@/lib/revalidation';

const SEASON_ID = '5e150000-0000-4000-8000-000000000001';
const ADMIN = { playerId: 'admin-1', name: 'Admin' };
const routeArgs = { params: Promise.resolve({ id: SEASON_ID }) };

const FULL_BODY = {
  banned_moves: ['Baton Pass'],
  banned_items: ['Soul Dew'],
  tiebreaker_order: ['match_points', 'kill_difference', 'decision_match'],
  draft_budget: 180,
  draft_picks: 9,
  draft_token_ratio: 3,
  draft_token_max: 2,
  draft_token_max_per_line: 1,
};

const STORED = {
  id: 'fr-1',
  season_id: SEASON_ID,
  ...FULL_BODY,
  tera_rules: { ...epbPack.teraByStage },
  redraft_phase_open: false,
  created_at: '2026-01-01T00:00:00Z',
};

function putRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/seasons/x/format-rules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlayer).mockResolvedValue(ADMIN as never);
  vi.mocked(requireResourceAdmin).mockResolvedValue(ADMIN as never);
  vi.mocked(getSeasonById).mockResolvedValue({ id: SEASON_ID, format_type: 'evolution_point_buy' } as never);
  vi.mocked(upsertFormatRules).mockResolvedValue(STORED as never);
  vi.mocked(getFormatRules).mockResolvedValue(null);
  vi.mocked(getSeasonStageIds).mockResolvedValue(['stage-1', 'stage-2']);
});

describe('PUT /api/seasons/[id]/format-rules', () => {
  it('asks the resource-admin guard first; a rejected guard answers its status without reading the body', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(new AuthError('Forbidden', 403));
    const json = vi.fn();

    const response = await PUT({ json } as unknown as NextRequest, routeArgs);

    expect(requireResourceAdmin).toHaveBeenCalledWith('season', SEASON_ID);
    expect(response.status).toBe(403);
    expect(json).not.toHaveBeenCalled();
    expect(getSeasonById).not.toHaveBeenCalled();
    expect(upsertFormatRules).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('refuses a league that is not a point-buy league', async () => {
    vi.mocked(getSeasonById).mockResolvedValue({ id: SEASON_ID, format_type: 'singles' } as never);

    const response = await PUT(putRequest(FULL_BODY), routeArgs);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ success: false, code: 'format_mismatch' });
    expect(upsertFormatRules).not.toHaveBeenCalled();
  });

  it('answers 404 for a league that does not exist', async () => {
    vi.mocked(getSeasonById).mockRejectedValue(new UserFacingError('Season not found', { code: 'season_not_found', status: 404 }));
    const response = await PUT(putRequest(FULL_BODY), routeArgs);
    expect(response.status).toBe(404);
    expect(upsertFormatRules).not.toHaveBeenCalled();
  });

  it.each([
    ['a budget above 999', { ...FULL_BODY, draft_budget: 1000 }],
    ['zero picks', { ...FULL_BODY, draft_picks: 0 }],
    ['a fractional ratio', { ...FULL_BODY, draft_token_ratio: 1.5 }],
    ['an unknown tiebreaker step', { ...FULL_BODY, tiebreaker_order: ['match_points', 'coin_flip'] }],
    [
      'Tera rules that differ from the pack',
      {
        ...FULL_BODY,
        tera_rules: {
          ...epbPack.teraByStage,
          stage1: (['any', 'stab_only', 'none'] as const).find((v) => v !== epbPack.teraByStage.stage1),
        },
      },
    ],
  ])('rejects %s with a 400 validation_failed and writes nothing', async (_label, body) => {
    const response = await PUT(putRequest(body), routeArgs);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({ success: false, code: 'validation_failed' });
    expect(json.params.issues).toEqual(expect.any(String));
    expect(upsertFormatRules).not.toHaveBeenCalled();
    expect(expireSeasonReads).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('passes a valid full payload to the store unchanged, expires the reads and audits the update', async () => {
    const response = await PUT(putRequest(FULL_BODY), routeArgs);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ success: true, data: STORED });
    expect(upsertFormatRules).toHaveBeenCalledTimes(1);
    expect(upsertFormatRules).toHaveBeenCalledWith(SEASON_ID, FULL_BODY);
    // The stored tiebreaker order ranks the league's and each phase's tables: both sets of reads expire.
    expect(expireSeasonReads).toHaveBeenCalledWith(SEASON_ID, ['stage-1', 'stage-2']);
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith({
      actor_id: ADMIN.playerId,
      actor_name: ADMIN.name,
      action: 'season.format_rules.update',
      resource_type: 'season',
      resource_id: SEASON_ID,
      metadata: { format_rules: FULL_BODY },
    });
  });

  it('reads the phase ids before the write: a failed read saves nothing and expires nothing', async () => {
    vi.mocked(getSeasonStageIds).mockRejectedValue(new Error('stages unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await PUT(putRequest(FULL_BODY), routeArgs);

    expect(response.status).toBe(500);
    expect(upsertFormatRules).not.toHaveBeenCalled();
    expect(expireSeasonReads).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('a body without redraft_phase_open does not carry that key to the store', async () => {
    await PUT(putRequest(FULL_BODY), routeArgs);
    const [, input] = vi.mocked(upsertFormatRules).mock.calls[0];
    expect(input).not.toHaveProperty('redraft_phase_open');
    expect(input).not.toHaveProperty('tera_rules');
  });

  it('accepts the exact body the Initialize button sends', async () => {
    const response = await PUT(putRequest(defaultFormatRulesPayload()), routeArgs);
    expect(response.status).toBe(200);
    expect(upsertFormatRules).toHaveBeenCalledWith(SEASON_ID, defaultFormatRulesPayload());
  });

  it('silently strips keys the schema does not know', async () => {
    await PUT(putRequest({ ...FULL_BODY, stranger: 'danger' }), routeArgs);
    const [, input] = vi.mocked(upsertFormatRules).mock.calls[0];
    expect(input).not.toHaveProperty('stranger');
  });

  it('hides a store failure behind the static message', async () => {
    vi.mocked(upsertFormatRules).mockRejectedValue(new Error('connection string leaked'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await PUT(putRequest(FULL_BODY), routeArgs);
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(json)).not.toContain('connection string');
    expect(logAuditEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('rejects a path id that is no uuid', async () => {
    const response = await PUT(putRequest(FULL_BODY), { params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(response.status).toBe(404);
    expect(upsertFormatRules).not.toHaveBeenCalled();
  });
});

describe('GET /api/seasons/[id]/format-rules', () => {
  it('answers success with data null for a point-buy league without a row', async () => {
    const response = await GET({} as NextRequest, routeArgs);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: null });
    expect(requirePlayer).toHaveBeenCalled();
    expect(getFormatRules).toHaveBeenCalledWith(SEASON_ID);
  });

  it('returns the stored row', async () => {
    vi.mocked(getFormatRules).mockResolvedValue(STORED as never);
    const response = await GET({} as NextRequest, routeArgs);
    expect(await response.json()).toEqual({ success: true, data: STORED });
  });

  it('refuses a league that is not a point-buy league instead of answering empty', async () => {
    vi.mocked(getSeasonById).mockResolvedValue({ id: SEASON_ID, format_type: 'draft' } as never);
    const response = await GET({} as NextRequest, routeArgs);
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(getFormatRules).not.toHaveBeenCalled();
  });

  it('a signed-out request is refused', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(new AuthError('Unauthorized', 401));
    const response = await GET({} as NextRequest, routeArgs);
    expect(response.status).toBe(401);
    expect(getFormatRules).not.toHaveBeenCalled();
  });
});
