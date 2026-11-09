import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    constructor(
      message: string,
      public statusCode: number,
      public code?: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(),
}));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/adjust', () => ({ applyAdjustment: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/load', () => ({ loadFreshKitContext: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/views-server', () => ({ loadAdjustmentsPage: vi.fn() }));

import { logAuditEvent } from '@/lib/audit/log';
import { AuthError, requireResourceAdmin } from '@/lib/auth/helpers';
import { applyAdjustment, type AdjustIssue } from '@/lib/format-engine/runtime/adjust';
import { loadFreshKitContext, type KitContext } from '@/lib/format-engine/runtime/load';
import { FORMAT_REFUSALS, REFUSAL_OF_ISSUE } from '@/lib/format-engine/runtime/refusal';
import { loadAdjustmentsPage } from '@/lib/format-engine/runtime/views-server';
import type { AdjustmentsPage } from '@/lib/format-engine/runtime/view-types';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import { checkRateLimit, RateLimitUnavailableError } from '@/lib/utils/rate-limit';
import type { SessionPlayer } from '@/types/auth';
import { GET, POST } from '../route';

const SEASON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const P1 = '22222222-2222-4222-8222-222222222222';
const P2 = '33333333-3333-4333-8333-333333333333';
const P3 = '44444444-4444-4444-8444-444444444444';
const ADJUSTMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const admin: SessionPlayer = {
  playerId: ADMIN_ID,
  name: 'League Admin',
  isAdmin: false,
  isResourceAdmin: true,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
};

const CTX = {
  seasonId: SEASON_ID,
  def: {
    resources: [
      { key: 'tokens', visibility: 'all' },
      { key: 'gifts', visibility: 'all' },
      { key: 'premium_gift', visibility: 'own' },
    ],
  },
} as unknown as KitContext;
const PAGE: AdjustmentsPage = {
  allowed: ['points', 'rank'],
  targets: { stages: [], players: [{ id: P1, name: 'Mara' }], resources: [], relations: [], actions: [] },
  history: [],
  total: 0,
};

const params = { params: Promise.resolve({ id: SEASON_ID.toUpperCase() }) };
const get = (query = '') => new NextRequest(`http://localhost/api/seasons/${SEASON_ID}/format/adjustments${query}`);
const post = (body: unknown, raw?: string) =>
  new NextRequest(`http://localhost/api/seasons/${SEASON_ID}/format/adjustments`, { method: 'POST', body: raw ?? JSON.stringify(body) });
const ALLOWED = { allowed: true, remaining: 10, retryAfterSeconds: 0 };

const body = (adjustment: unknown, reason = 'Corrected after the dispute') => ({ reason, adjustment });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue(admin);
  vi.mocked(checkRateLimit).mockResolvedValue(ALLOWED);
  vi.mocked(loadFreshKitContext).mockResolvedValue(CTX);
  vi.mocked(loadAdjustmentsPage).mockResolvedValue(PAGE);
  vi.mocked(applyAdjustment).mockResolvedValue({ ok: true, id: ADJUSTMENT_ID });
});

describe('GET /api/seasons/[id]/format/adjustments', () => {
  it('answers 401 and 403 before reading anything', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValueOnce(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await GET(get(), params)).status).toBe(401);
    vi.mocked(requireResourceAdmin).mockRejectedValueOnce(new AuthError('Admin access required', 403, 'forbidden'));
    expect((await GET(get(), params)).status).toBe(403);
    expect(requireResourceAdmin).toHaveBeenCalledWith('season', SEASON_ID.toUpperCase());
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(loadAdjustmentsPage).not.toHaveBeenCalled();
  });

  it('pages the history for the normalised league with the defaults and is never cached', async () => {
    const response = await GET(get(), params);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(loadFreshKitContext).toHaveBeenCalledWith(SEASON_ID);
    expect(loadAdjustmentsPage).toHaveBeenCalledWith(SEASON_ID, CTX, { limit: 50, offset: 0 }, ADMIN_ID);
    const text = await response.text();
    expect(JSON.parse(text).data).toEqual(PAGE);
    expectNoPrivatePlayerData(JSON.parse(text));
  });

  it('reads limit and offset, and still pages the history of a league that runs no kit format', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(null);
    await GET(get('?limit=10&offset=20'), params);
    expect(loadAdjustmentsPage).toHaveBeenCalledWith(SEASON_ID, null, { limit: 10, offset: 20 }, ADMIN_ID);
  });

  it('rejects an out-of-range or non-numeric limit and offset with 400', async () => {
    for (const query of ['?limit=0', '?limit=101', '?offset=-1', '?offset=10001', '?limit=abc']) {
      const response = await GET(get(query), params);
      expect(response.status, query).toBe(400);
    }
    expect(loadAdjustmentsPage).not.toHaveBeenCalled();
  });

  it('answers 429 with Retry-After before loading anything', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 9 });
    const response = await GET(get(), params);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('9');
    expect(checkRateLimit).toHaveBeenCalledWith('format-runtime-admin-read', ADMIN_ID, expect.objectContaining({ limit: 60, windowSeconds: 60 }));
    expect(loadAdjustmentsPage).not.toHaveBeenCalled();
  });

  it('hides an unexpected failure behind the static message', async () => {
    vi.mocked(loadAdjustmentsPage).mockRejectedValueOnce(new Error('connection reset by peer'));
    const response = await GET(get(), params);
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('Failed to load the adjustments');
  });
});

describe('POST /api/seasons/[id]/format/adjustments', () => {
  it('answers 401 and 403 before reading anything', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValueOnce(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await POST(post(body({ kind: 'action', action: 'give', state: 'locked' })), params)).status).toBe(401);
    vi.mocked(requireResourceAdmin).mockRejectedValueOnce(new AuthError('Admin access required', 403, 'forbidden'));
    expect((await POST(post(body({ kind: 'action', action: 'give', state: 'locked' })), params)).status).toBe(403);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(applyAdjustment).not.toHaveBeenCalled();
  });

  const kinds: { name: string; adjustment: Record<string, unknown>; input: Record<string, unknown>; target: Record<string, unknown> }[] = [
    {
      name: 'points',
      adjustment: { kind: 'points', stage: 'swiss', player_id: P1, points: -2.5 },
      input: { kind: 'points', stage: 'swiss', playerId: P1, points: -2.5 },
      target: { stage: 'swiss', player_id: P1 },
    },
    {
      name: 'rank',
      adjustment: { kind: 'rank', stage: 'swiss', order: [P1, P2, P3] },
      input: { kind: 'rank', stage: 'swiss', order: [P1, P2, P3] },
      target: { stage: 'swiss', players: 3 },
    },
    {
      name: 'resource (a grant)',
      adjustment: { kind: 'resource', resource: 'gifts', player_id: P1, item_id: 'pikachu', amount: 1 },
      input: { kind: 'resource', resource: 'gifts', playerId: P1, itemId: 'pikachu', amount: 1 },
      target: { resource: 'gifts', player_id: P1, amount: 1 },
    },
    {
      name: 'resource (a counter)',
      adjustment: { kind: 'resource', resource: 'tokens', player_id: P1, amount: -3 },
      input: { kind: 'resource', resource: 'tokens', playerId: P1, amount: -3 },
      target: { resource: 'tokens', player_id: P1, amount: -3 },
    },
    {
      name: 'relation (reveal)',
      adjustment: { kind: 'relation', relation: 'santa', reveal: true },
      input: { kind: 'relation', relation: 'santa', reveal: true },
      target: { relation: 'santa', reveal: true, link_count: 0 },
    },
    {
      name: 'relation (links)',
      adjustment: { kind: 'relation', relation: 'santa', links: [{ from: P1, to: P2 }, { from: P2, to: P3 }, { from: P3, to: P1 }] },
      input: { kind: 'relation', relation: 'santa', links: [{ from: P1, to: P2 }, { from: P2, to: P3 }, { from: P3, to: P1 }] },
      target: { relation: 'santa', reveal: false, link_count: 3 },
    },
    {
      name: 'relation (draw)',
      adjustment: { kind: 'relation', relation: 'santa', draw: true },
      input: { kind: 'relation', relation: 'santa', draw: true },
      target: { relation: 'santa', reveal: false, draw: true, link_count: 0 },
    },
    {
      name: 'action',
      adjustment: { kind: 'action', action: 'give', state: 'locked' },
      input: { kind: 'action', action: 'give', state: 'locked' },
      target: { action: 'give', state: 'locked' },
    },
    {
      name: 'domain',
      adjustment: { kind: 'domain', domain: 'pool', add: [{ id: 'pikachu', attrs: [] }], remove: ['ditto'] },
      input: { kind: 'domain', domain: 'pool', add: [{ id: 'pikachu', attrs: [] }], remove: ['ditto'] },
      target: { domain: 'pool', added: 1, removed: 1 },
    },
  ];

  for (const kind of kinds) {
    it(`applies a ${kind.name} adjustment for the league of the URL and audits ids and counts only`, async () => {
      const response = await POST(post(body(kind.adjustment)), params);
      expect(response.status).toBe(201);
      expect((await response.json()).data).toEqual({ adjustment_id: ADJUSTMENT_ID });
      expect(applyAdjustment).toHaveBeenCalledWith({
        seasonId: SEASON_ID,
        adminId: ADMIN_ID,
        reason: 'Corrected after the dispute',
        adjustment: kind.input,
      });
      expect(logAuditEvent).toHaveBeenCalledTimes(1);
      const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
      expect(entry).toMatchObject({
        action: 'season.format.adjustment',
        actor_id: ADMIN_ID,
        actor_name: 'League Admin',
        resource_type: 'season',
        resource_id: SEASON_ID,
        metadata: { adjustment_id: ADJUSTMENT_ID, kind: kind.adjustment.kind, target: kind.target, reason_length: 27 },
      });
      // The reason lives in the adjustment row, never in the audit log.
      expect(JSON.stringify(entry)).not.toContain('Corrected after');
    });
  }

  it('never copies hidden link pairs or domain entries into the audit entry', async () => {
    await POST(post(body({ kind: 'relation', relation: 'santa', links: [{ from: P1, to: P2 }, { from: P2, to: P1 }] })), params);
    await POST(post(body({ kind: 'domain', domain: 'pool', add: [{ id: 'pikachu', attrs: [] }] })), params);
    const audit = JSON.stringify(vi.mocked(logAuditEvent).mock.calls);
    for (const id of [P1, P2, 'pikachu']) expect(audit).not.toContain(id);
  });

  it('never copies the item of a resource adjustment into the audit entry (what a player was granted may be a secret gift)', async () => {
    await POST(post(body({ kind: 'resource', resource: 'premium_gift', player_id: P1, item_id: 'rare_candy', amount: 1 })), params);
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    // A holding the history masks for a reader who plays is not in the audit log either: no resource, player or amount.
    expect(entry.metadata).toMatchObject({ kind: 'resource', target: {} });
    expect(JSON.stringify(entry)).not.toContain(P1);
    expect(JSON.stringify(entry)).not.toContain('premium_gift');
    expect(JSON.stringify(entry)).not.toContain('rare_candy');
    expect(JSON.stringify(entry)).not.toContain('item_id');
  });

  it('does not accept the record-only outcome kind', async () => {
    const response = await POST(post(body({ kind: 'outcome', matchId: P1 })), params);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('validation_failed');
    expect(applyAdjustment).not.toHaveBeenCalled();
  });

  it('takes the league from the URL only: a season_id in the body is a 400', async () => {
    const response = await POST(post({ ...body({ kind: 'action', action: 'give', state: 'locked' }), season_id: P1 }), params);
    expect(response.status).toBe(400);
    expect(applyAdjustment).not.toHaveBeenCalled();
  });

  it('rejects a malformed adjustment with 400 and applies nothing', async () => {
    const bad: unknown[] = [
      {},
      body({ kind: 'points', stage: 'swiss', player_id: P1, points: 0 }),
      body({ kind: 'points', stage: 'swiss', player_id: P1, points: 1000.01 }),
      body({ kind: 'points', stage: 'swiss', player_id: P1, points: 0.001 }),
      body({ kind: 'points', stage: 'swiss', player_id: 'p1', points: 1 }),
      body({ kind: 'rank', stage: 'swiss', order: [P1, P1] }),
      body({ kind: 'resource', resource: 'gifts', player_id: P1, amount: 0 }),
      body({ kind: 'resource', resource: 'gifts', player_id: P1, amount: 65 }),
      body({ kind: 'relation', relation: 'santa' }),
      body({ kind: 'relation', relation: 'santa', links: [{ from: P1, to: P1 }] }),
      body({ kind: 'relation', relation: 'santa', links: [{ from: P1, to: P2 }, { from: P1, to: P3 }] }),
      body({ kind: 'relation', relation: 'santa', links: [{ from: P1, to: P3 }, { from: P2, to: P3 }] }),
      body({ kind: 'action', action: 'give', state: 'paused' }),
      body({ kind: 'domain', domain: 'pool' }),
      body({ kind: 'domain', domain: 'pool', add: [{ id: 'a', attrs: [] }, { id: 'a', attrs: [] }] }),
      body({ kind: 'action', action: 'give', state: 'open', extra: true }),
    ];
    for (const item of bad) {
      const response = await POST(post(item), params);
      expect(response.status, JSON.stringify(item).slice(0, 100)).toBe(400);
      expect((await response.json()).code).toBe('validation_failed');
    }
    expect(applyAdjustment).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('requires a reason of 1 to 500 characters (an emoji counts once) without NUL', async () => {
    const adjustment = { kind: 'action', action: 'give', state: 'locked' };
    for (const reason of ['', '   ', 'x'.repeat(501), 'bad\u0000reason']) {
      const response = await POST(post(body(adjustment, reason)), params);
      expect(response.status, JSON.stringify(reason).slice(0, 20)).toBe(400);
      expect((await response.json()).code).toBe('validation_failed');
    }
    expect(applyAdjustment).not.toHaveBeenCalled();

    expect((await POST(post(body(adjustment, 'x'.repeat(500))), params)).status).toBe(201);
    // 500 code points, 1000 UTF-16 units.
    expect((await POST(post(body(adjustment, '\u{1F600}'.repeat(500))), params)).status).toBe(201);
    expect(vi.mocked(logAuditEvent).mock.calls[1][0].metadata).toMatchObject({ reason_length: 500 });
  });

  it('trims the reason before it reaches the library', async () => {
    await POST(post(body({ kind: 'action', action: 'give', state: 'locked' }, '  because  ')), params);
    expect(applyAdjustment).toHaveBeenCalledWith(expect.objectContaining({ reason: 'because' }));
  });

  it('answers every refusal of the library with its catalog code and status', async () => {
    const issues = Object.keys(REFUSAL_OF_ISSUE) as AdjustIssue[];
    expect(issues.length).toBeGreaterThan(10);
    for (const issue of issues) {
      vi.mocked(applyAdjustment).mockResolvedValueOnce({ ok: false, issue });
      const response = await POST(post(body({ kind: 'action', action: 'give', state: 'locked' })), params);
      const code = REFUSAL_OF_ISSUE[issue];
      expect(response.status, issue).toBe(FORMAT_REFUSALS[code]);
      expect((await response.json()).code, issue).toBe(code);
    }
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('answers 429 with Retry-After and applies nothing', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 300 });
    const response = await POST(post(body({ kind: 'action', action: 'give', state: 'locked' })), params);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('300');
    expect(checkRateLimit).toHaveBeenCalledWith(
      'format-adjust',
      ADMIN_ID,
      expect.objectContaining({ limit: 120, windowSeconds: 3600, failMode: 'closed' }),
    );
    expect(applyAdjustment).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('fails closed when the limiter is unavailable: 503 and nothing applied', async () => {
    vi.mocked(checkRateLimit).mockRejectedValueOnce(new RateLimitUnavailableError());
    const response = await POST(post(body({ kind: 'action', action: 'give', state: 'locked' })), params);
    expect(response.status).toBe(503);
    expect(applyAdjustment).not.toHaveBeenCalled();
  });

  it('answers 413 format_request_too_large for a body over 256 KiB, and reads a large domain amendment within it', async () => {
    const huge = await POST(post({ ...body({ kind: 'action', action: 'give', state: 'locked' }), padding: 'x'.repeat(257 * 1024) }), params);
    expect(huge.status).toBe(413);
    expect((await huge.json()).code).toBe('format_request_too_large');

    const add = Array.from({ length: 512 }, (_, i) => ({ id: `entry_${i}`, attrs: [] }));
    expect((await POST(post(body({ kind: 'domain', domain: 'pool', add })), params)).status).toBe(201);
    expect(applyAdjustment).toHaveBeenCalledTimes(1);
  });

  it('answers 400 invalid_json for an empty body', async () => {
    const response = await POST(post(null, ''), params);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_json');
  });

  it('hides an unexpected failure behind the static message', async () => {
    vi.mocked(applyAdjustment).mockRejectedValueOnce(new Error('violates foreign key constraint "format_relation_links_to_fkey"'));
    const response = await POST(post(body({ kind: 'action', action: 'give', state: 'locked' })), params);
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toBe('Failed to apply the adjustment');
    expect(JSON.stringify(json)).not.toContain('fkey');
  });
});
