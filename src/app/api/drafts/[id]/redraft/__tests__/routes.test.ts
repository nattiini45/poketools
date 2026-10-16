/**
 * Redraft routes (draft-backend §8.1 #18–#23; B-RED): guards, zod 400
 * `validation_failed`, RPC argument mapping, tag expiry, rule-error mapping,
 * and the submission DTO (`own_lines`, `droppable`, `locked`, `max`,
 * `leftover_budget`). No DB: the query layer and `callDraftRpc` are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => ({
  submissions: [] as Record<string, unknown>[],
  reads: [] as [string, unknown][][],
}));

/** Only `redraft_submissions` is read through the client here (own list, filtered by `.eq`). */
vi.mock('@/lib/supabase/client', () => {
  function builder() {
    const filters: [string, unknown][] = [];
    db.reads.push(filters);
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, value: unknown) => {
        filters.push([col, value]);
        return chain;
      },
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: db.submissions.filter((r) => filters.every(([c, v]) => r[c] === v)), error: null }),
    };
    return chain;
  }
  return { supabase: { from: () => builder(), rpc: vi.fn() } };
});
vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  requireDraftAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));
vi.mock('@/lib/supabase/queries/drafts', () => ({ getDraftPoolById: vi.fn() }));
vi.mock('@/lib/supabase/queries/drafts-redraft', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase/queries/drafts-redraft')>(
    '@/lib/supabase/queries/drafts-redraft',
  );
  return {
    ...actual,
    isPoolParticipant: vi.fn(),
    listRedraftSubmissions: vi.fn(),
  };
});
vi.mock('@/lib/supabase/queries/evolutions', () => ({ getPlayerTrackers: vi.fn() }));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({ getListEntries: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-rules', () => ({ getFormatRules: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn(), getSeasonParticipants: vi.fn() }));
vi.mock('@/lib/draft/progress-engine', () => ({ computeRemainingPoints: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ expireDraftReads: vi.fn() }));
vi.mock('@/lib/draft/notify', () => ({ dispatchDraftNotifications: vi.fn(), scheduleDraftNotifications: vi.fn() }));
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: vi.fn() };
});
vi.mock('@/lib/draft/rpc-errors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/draft/rpc-errors')>('@/lib/draft/rpc-errors');
  return { ...actual, callDraftRpc: vi.fn() };
});

import { after } from 'next/server';
import { GET as getSubmission, PUT as putSubmission } from '@/app/api/drafts/[id]/redraft/submission/route';
import { GET as getSubmissions } from '@/app/api/drafts/[id]/redraft/submissions/route';
import { PATCH as patchRedraft } from '@/app/api/drafts/[id]/redraft/route';
import { POST as publish } from '@/app/api/drafts/[id]/redraft/publish/route';
import { POST as restore } from '@/app/api/drafts/[id]/redraft/slots/[redraftSlotId]/restore/route';
import { requireDraftAdmin, requirePlayer, AuthError } from '@/lib/auth/helpers';
import { getDraftPoolById } from '@/lib/supabase/queries/drafts';
import {
  isPoolParticipant,
  isSubmissionLocked,
  listRedraftSubmissions,
} from '@/lib/supabase/queries/drafts-redraft';
import { getPlayerTrackers } from '@/lib/supabase/queries/evolutions';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { computeRemainingPoints } from '@/lib/draft/progress-engine';
import { expireDraftReads } from '@/lib/revalidation';
import { dispatchDraftNotifications, scheduleDraftNotifications } from '@/lib/draft/notify';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { DraftRuleError } from '@/lib/draft/errors';
import { SQL_REDRAFT_MAX_LINES_FALLBACK } from '@/lib/draft/sql-fallbacks';

const POOL = '11111111-1111-4111-8111-111111111111';
const SLOT = '22222222-2222-4222-8222-222222222222';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FUTURE = '2099-01-01T00:00:00.000Z';

const ctx = { params: Promise.resolve({ id: POOL }) };
const slotCtx = (redraftSlotId = SLOT) => ({ params: Promise.resolve({ id: POOL, redraftSlotId }) });
const req = (path: string, method = 'GET', body?: unknown) =>
  new NextRequest(`http://localhost/api/drafts/${POOL}/redraft${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const forbidden = () =>
  new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required for this draft', 403);

const redraftPool = (extra: Record<string, unknown> = {}) => ({
  id: POOL, season_id: 'season-1', engine: 'queue', kind: 'redraft', phase: 'submissions',
  list_version_id: 'list-1', redraft_max_lines: null, submission_deadline_at: FUTURE, ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(requirePlayer).mockResolvedValue({ playerId: P1, isAdmin: false } as never);
  vi.mocked(requireDraftAdmin).mockResolvedValue({ playerId: ADMIN, isAdmin: true } as never);
  vi.mocked(getDraftPoolById).mockResolvedValue(redraftPool() as never);
  vi.mocked(isPoolParticipant).mockResolvedValue(true);
  db.reads = [];
  db.submissions = [
    { draft_pool_id: POOL, player_id: P1, line_id: 'dratini--dragonite', updated_at: '2026-10-12T10:00:00Z' },
    { draft_pool_id: POOL, player_id: P2, line_id: 'ralts--gallade', updated_at: '2026-10-12T11:00:00Z' },
  ];
  vi.mocked(getPlayerTrackers).mockResolvedValue([
    { id: 't1', line_id: 'dratini--dragonite', real_kills: 9 },
    { id: 't2', line_id: 'cosmog--solgaleo', real_kills: 0 },
    { id: 't3', line_id: null, real_kills: 2 },
    { id: 't4', line_id: 'ralts--gallade', real_kills: 1 },
  ] as never);
  vi.mocked(getListEntries).mockResolvedValue([
    { line_id: 'dratini--dragonite', price: 22, special_rules: null },
    { line_id: 'cosmog--solgaleo', price: 15, special_rules: { cosmog: true, no_redraft: true } },
    { line_id: 'ralts--gallade', price: 15, special_rules: null },
  ] as never);
  vi.mocked(getFormatRules).mockResolvedValue({ draft_budget: 180, draft_token_ratio: 3 } as never);
  vi.mocked(computeRemainingPoints).mockResolvedValue(7);
});

describe('GET /api/drafts/[id]/redraft/submission (#18)', () => {
  it('builds the DTO from the own list, own trackers, list prices and the season ledger', async () => {
    const res = await getSubmission(req('/submission'), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      line_ids: ['dratini--dragonite'],
      updated_at: '2026-10-12T10:00:00Z',
      locked: false,
      deadline_at: FUTURE,
      // NULL pool cap: the DTO mirrors redraft_set_submission's SQL fallback, not the pack default.
      max: SQL_REDRAFT_MAX_LINES_FALLBACK,
      own_lines: [
        { line_id: 'dratini--dragonite', real_kills: 9, price: 22, droppable: true },
        { line_id: 'cosmog--solgaleo', real_kills: 0, price: 15, droppable: false },
        { line_id: 'ralts--gallade', real_kills: 1, price: 15, droppable: true },
      ],
      leftover_budget: 7,
    });
    expect(db.reads).toEqual([[['draft_pool_id', POOL], ['player_id', P1]]]);
    expect(getListEntries).toHaveBeenCalledWith('list-1');
  });

  it('reports locked after the deadline and the pool max when set', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(
      redraftPool({ submission_deadline_at: '2020-01-01T00:00:00Z', redraft_max_lines: 2 }) as never,
    );
    const data = (await (await getSubmission(req('/submission'), ctx)).json()).data;
    expect(data.locked).toBe(true);
    expect(data.max).toBe(2);
  });

  it('refuses an initial pool (DRAFT_NOT_ACTIVE) and a legacy pool', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(redraftPool({ kind: 'initial' }) as never);
    expect((await (await getSubmission(req('/submission'), ctx)).json()).code).toBe('DRAFT_NOT_ACTIVE');
    vi.mocked(getDraftPoolById).mockResolvedValue(redraftPool({ engine: 'legacy' }) as never);
    expect((await (await getSubmission(req('/submission'), ctx)).json()).code).toBe('POOL_ENGINE_LEGACY');
  });

  it('rejects a malformed player_id with 400 validation_failed', async () => {
    const res = await getSubmission(req('/submission?player_id=nope'), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
  });
});

describe('PUT /api/drafts/[id]/redraft/submission (#19)', () => {
  it('passes the list to the RPC and returns the saved list without re-reading it', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue({ line_ids: ['dratini--dragonite'], updated_at: '2026-10-13T08:00:00Z' });
    const res = await putSubmission(req('/submission', 'PUT', { line_ids: ['dratini--dragonite'] }), ctx);
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data.line_ids).toEqual(['dratini--dragonite']);
    expect(data.updated_at).toBe('2026-10-13T08:00:00Z');
    expect(db.reads).toHaveLength(0);
    expect(expireDraftReads).not.toHaveBeenCalled();
  });

  it('withdraws with an empty list', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue({ line_ids: [], updated_at: null });
    const data = (await (await putSubmission(req('/submission', 'PUT', { line_ids: [] }), ctx)).json()).data;
    expect(data.line_ids).toEqual([]);
    expect(data.updated_at).toBeNull();
  });

  it('rejects repeated lines and malformed line ids', async () => {
    const dup = await putSubmission(req('/submission', 'PUT', { line_ids: ['a--b', 'a--b'] }), ctx);
    expect(dup.status).toBe(400);
    const bad = await putSubmission(req('/submission', 'PUT', { line_ids: ['Not A Line'] }), ctx);
    expect(bad.status).toBe(400);
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it.each([
    ['SUBMISSION_LOCKED', 409, undefined],
    ['REDRAFT_MAX_EXCEEDED', 422, { max: 3 }],
  ] as const)('maps %s', async (code, status, params) => {
    vi.mocked(callDraftRpc).mockRejectedValue(new DraftRuleError(code, params as never));
    const res = await putSubmission(req('/submission', 'PUT', { line_ids: ['dratini--dragonite'] }), ctx);
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.code).toBe(code);
    if (params) expect(body.params).toEqual(params);
  });

  it('maps LINE_NOT_DROPPABLE with the line as detail', async () => {
    vi.mocked(callDraftRpc).mockRejectedValue(
      new DraftRuleError('LINE_NOT_DROPPABLE', undefined, { line_id: 'cosmog--solgaleo' }),
    );
    const body = await (await putSubmission(req('/submission', 'PUT', { line_ids: ['cosmog--solgaleo'] }), ctx)).json();
    expect(body.code).toBe('LINE_NOT_DROPPABLE');
    expect(body.detail).toEqual({ line_id: 'cosmog--solgaleo' });
  });
});

describe('GET /api/drafts/[id]/redraft/submissions (#20)', () => {
  it('returns the admin list', async () => {
    vi.mocked(listRedraftSubmissions).mockResolvedValue([
      { player_id: P2, player_name: 'Misty', line_ids: ['ralts--gallade'], updated_at: '2026-10-12T10:00:00Z' },
    ]);
    const res = await getSubmissions(req('/submissions'), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
    expect(listRedraftSubmissions).toHaveBeenCalledWith(POOL);
  });

  it('is admin-only', async () => {
    vi.mocked(requireDraftAdmin).mockRejectedValue(forbidden());
    expect((await getSubmissions(req('/submissions'), ctx)).status).toBe(403);
    expect(listRedraftSubmissions).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/drafts/[id]/redraft (#21)', () => {
  it('maps deadline_at → submission_deadline_at and max into draft_configure, no expiry (EXEMPT)', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue({ state_version: 5 });
    const res = await patchRedraft(req('', 'PATCH', { deadline_at: FUTURE, redraft_max_lines: 2 }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ state_version: 5 });
    expect(callDraftRpc).toHaveBeenCalledWith('draft_configure', {
      p_pool_id: POOL,
      p_actor_id: ADMIN,
      p_patch: { submission_deadline_at: FUTURE, redraft_max_lines: 2 },
      p_seats: null,
    });
    expect(expireDraftReads).not.toHaveBeenCalled();
  });

  it('turns participant_order into seats checked against the season participants', async () => {
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: P1 }, { id: P2 }] as never);
    vi.mocked(callDraftRpc).mockResolvedValue({ state_version: 6 });
    await patchRedraft(req('', 'PATCH', { participant_order: [P2, P1] }), ctx);
    expect(callDraftRpc).toHaveBeenCalledWith('draft_configure', expect.objectContaining({
      p_patch: {},
      p_seats: [{ player_id: P2, seat: 1 }, { player_id: P1, seat: 2 }],
    }));
  });

  it('refuses an order that is not the participant set (SEATS_INVALID)', async () => {
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: P1 }, { id: P2 }, { id: ADMIN }] as never);
    const res = await patchRedraft(req('', 'PATCH', { participant_order: [P2, P1] }), ctx);
    expect((await res.json()).code).toBe('SEATS_INVALID');
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('rejects an `open` field, a past deadline and unknown keys', async () => {
    for (const body of [{ open: true }, { deadline_at: '2020-01-01T00:00:00Z' }, { budget: 10 }]) {
      const res = await patchRedraft(req('', 'PATCH', body), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('validation_failed');
    }
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('refuses initial pools and passes DRAFT_ALREADY_STARTED through after publish', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(redraftPool({ kind: 'initial' }) as never);
    expect((await (await patchRedraft(req('', 'PATCH', { redraft_max_lines: 1 }), ctx)).json()).code).toBe('DRAFT_NOT_ACTIVE');

    vi.mocked(getDraftPoolById).mockResolvedValue(redraftPool({ phase: 'drafting' }) as never);
    vi.mocked(callDraftRpc).mockRejectedValue(new DraftRuleError('DRAFT_ALREADY_STARTED'));
    const res = await patchRedraft(req('', 'PATCH', { redraft_max_lines: 1 }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('DRAFT_ALREADY_STARTED');
  });

  it('is admin-only', async () => {
    vi.mocked(requireDraftAdmin).mockRejectedValue(forbidden());
    expect((await patchRedraft(req('', 'PATCH', { redraft_max_lines: 1 }), ctx)).status).toBe(403);
    expect(callDraftRpc).not.toHaveBeenCalled();
  });
});

describe('POST /api/drafts/[id]/redraft/publish (#22)', () => {
  it('publishes, expires the draft reads and claims notifications after the response', async () => {
    vi.mocked(callDraftRpc).mockImplementation(async (fn) =>
      fn === 'redraft_publish' ? { state_version: 12, drops: 4, published: true, active_slot_id: 's1' } : [{ type: 'redraft_published' }],
    );
    const res = await publish(req('/publish', 'POST', { force: true, reason: 'Everyone submitted early' }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ state_version: 12, drops: 4 });
    expect(callDraftRpc).toHaveBeenCalledWith('redraft_publish', {
      p_pool_id: POOL, p_actor_id: ADMIN, p_force: true, p_reason: 'Everyone submitted early',
    });
    expect(expireDraftReads).toHaveBeenCalledWith('season-1');

    expect(after).toHaveBeenCalledTimes(1);
    const task = vi.mocked(after).mock.calls[0][0] as () => Promise<void>;
    await task();
    expect(callDraftRpc).toHaveBeenCalledWith('draft_claim_notifications', { p_pool_id: POOL });
    expect(dispatchDraftNotifications).toHaveBeenCalledWith([{ type: 'redraft_published' }]);
  });

  it('defaults to no force and no reason', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue({ state_version: 3, drops: 0 });
    await publish(req('/publish', 'POST', {}), ctx);
    expect(callDraftRpc).toHaveBeenCalledWith('redraft_publish', {
      p_pool_id: POOL, p_actor_id: ADMIN, p_force: false, p_reason: null,
    });
  });

  it('maps SUBMISSIONS_NOT_DUE (deadline as detail) and does not expire or notify', async () => {
    vi.mocked(callDraftRpc).mockRejectedValue(
      new DraftRuleError('SUBMISSIONS_NOT_DUE', undefined, { deadline_at: FUTURE }),
    );
    const res = await publish(req('/publish', 'POST', {}), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('SUBMISSIONS_NOT_DUE');
    expect(body.detail).toEqual({ deadline_at: FUTURE });
    expect(expireDraftReads).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it('a failing notification claim is logged, never thrown', async () => {
    vi.mocked(callDraftRpc).mockImplementation(async (fn) => {
      if (fn === 'redraft_publish') return { state_version: 2, drops: 1 };
      throw new Error('claim failed');
    });
    await publish(req('/publish', 'POST', {}), ctx);
    const task = vi.mocked(after).mock.calls[0][0] as () => Promise<void>;
    await expect(task()).resolves.toBeUndefined();
  });

  it('rejects a too-short reason and unknown keys', async () => {
    expect((await publish(req('/publish', 'POST', { force: true, reason: 'x' }), ctx)).status).toBe(400);
    expect((await publish(req('/publish', 'POST', { now: true }), ctx)).status).toBe(400);
    expect(callDraftRpc).not.toHaveBeenCalled();
  });
});

describe('POST /api/drafts/[id]/redraft/slots/[redraftSlotId]/restore (#23)', () => {
  it('restores the drop with the reason and expires the draft reads', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue({ state_version: 14, tracker_id: 't9', forfeited_slot_id: 's9' });
    const res = await restore(req(`/slots/${SLOT}/restore`, 'POST', { reason: 'Dropped by mistake' }), slotCtx());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ state_version: 14 });
    expect(callDraftRpc).toHaveBeenCalledWith('redraft_admin_restore_drop', {
      p_pool_id: POOL, p_redraft_slot_id: SLOT, p_actor_id: ADMIN, p_reason: 'Dropped by mistake',
    });
    expect(expireDraftReads).toHaveBeenCalledWith('season-1');
    // The forfeited queue slot can move the clock: the turn ping is claimed after the response.
    expect(scheduleDraftNotifications).toHaveBeenCalledWith(POOL);
  });

  it('refuses a malformed slot id with REDRAFT_SLOT_INVALID before any RPC', async () => {
    const res = await restore(req('/slots/x/restore', 'POST', { reason: 'Dropped by mistake' }), slotCtx('x'));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('REDRAFT_SLOT_INVALID');
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('requires a reason', async () => {
    const res = await restore(req(`/slots/${SLOT}/restore`, 'POST', {}), slotCtx());
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
  });

  it.each(['CORRECTION_REQUIRES_PAUSE', 'REDRAFT_SLOT_FILLED', 'RESTORE_WOULD_OVERDRAW'] as const)(
    'maps %s and does not expire',
    async (code) => {
      vi.mocked(callDraftRpc).mockRejectedValue(new DraftRuleError(code));
      const res = await restore(req(`/slots/${SLOT}/restore`, 'POST', { reason: 'Dropped by mistake' }), slotCtx());
      expect((await res.json()).code).toBe(code);
      expect(expireDraftReads).not.toHaveBeenCalled();
    },
  );

  it('is admin-only', async () => {
    vi.mocked(requireDraftAdmin).mockRejectedValue(forbidden());
    const res = await restore(req(`/slots/${SLOT}/restore`, 'POST', { reason: 'Dropped by mistake' }), slotCtx());
    expect(res.status).toBe(403);
    expect(callDraftRpc).not.toHaveBeenCalled();
  });
});

describe('isSubmissionLocked', () => {
  const now = new Date('2026-10-18T21:59:58Z');
  it('is open before the deadline in the submission phase only', () => {
    expect(isSubmissionLocked({ phase: 'submissions', submission_deadline_at: '2026-10-18T21:59:59Z' }, now)).toBe(false);
    expect(isSubmissionLocked({ phase: 'submissions', submission_deadline_at: '2026-10-18T21:59:58Z' }, now)).toBe(true);
    expect(isSubmissionLocked({ phase: 'drafting', submission_deadline_at: '2026-10-18T21:59:59Z' }, now)).toBe(true);
    expect(isSubmissionLocked({ phase: 'submissions', submission_deadline_at: null }, now)).toBe(true);
  });
});
