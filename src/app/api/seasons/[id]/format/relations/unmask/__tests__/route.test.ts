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
vi.mock('@/lib/audit/log', () => ({ logAuditEventStrict: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/load', () => ({ loadFreshKitContext: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/views-server', () => ({ loadUnmasked: vi.fn() }));

import { logAuditEventStrict } from '@/lib/audit/log';
import { AuthError, requireResourceAdmin } from '@/lib/auth/helpers';
import { loadFreshKitContext, type KitContext } from '@/lib/format-engine/runtime/load';
import { loadUnmasked } from '@/lib/format-engine/runtime/views-server';
import type { AdminUnmasked } from '@/lib/format-engine/runtime/view-types';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { SessionPlayer } from '@/types/auth';
import { POST } from '../route';

const SEASON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const P1 = '22222222-2222-4222-8222-222222222222';
const P2 = '33333333-3333-4333-8333-333333333333';

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

const CTX = { seasonId: SEASON_ID } as KitContext;
const UNMASKED: AdminUnmasked = {
  relations: [
    {
      key: 'santa',
      label: 'Secret Santa' as never,
      shape: 'derangement',
      masked: false,
      link_count: 1,
      links: [{ from: { id: P1, name: 'Mara' }, to: { id: P2, name: 'Jonas' }, revealed: false, involves_viewer: false }],
    },
  ],
  submissions: [
    { action: 'give', rows: [{ player: { id: P1, name: 'Mara' }, state: 'submitted', target: { id: P2, name: 'Jonas' }, involves_viewer: false }] },
  ],
};

// An admin who also plays (P1): the route still sends their own rows and only marks them; the panel hides them.
const UNMASKED_PLAYING: AdminUnmasked = {
  relations: [
    {
      ...UNMASKED.relations[0],
      links: [{ from: { id: P1, name: 'Mara' }, to: { id: P2, name: 'Jonas' }, revealed: false, involves_viewer: true }],
    },
  ],
  submissions: [
    { action: 'give', rows: [{ player: { id: P1, name: 'Mara' }, state: 'submitted', target: { id: P2, name: 'Jonas' }, involves_viewer: true }] },
  ],
};

const params = { params: Promise.resolve({ id: SEASON_ID.toUpperCase() }) };
const post = (raw = '{}') => new NextRequest(`http://localhost/api/seasons/${SEASON_ID}/format/relations/unmask`, { method: 'POST', body: raw });
const ALLOWED = { allowed: true, remaining: 10, retryAfterSeconds: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue(admin);
  vi.mocked(checkRateLimit).mockResolvedValue(ALLOWED);
  vi.mocked(loadFreshKitContext).mockResolvedValue(CTX);
  vi.mocked(loadUnmasked).mockResolvedValue(UNMASKED);
});

describe('POST /api/seasons/[id]/format/relations/unmask', () => {
  it('answers 401 and 403 and reveals nothing to a non-admin or an admin of another league', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValueOnce(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await POST(post(), params)).status).toBe(401);
    vi.mocked(requireResourceAdmin).mockRejectedValueOnce(new AuthError('Admin access required', 403, 'forbidden'));
    const forbidden = await POST(post(), params);
    expect(forbidden.status).toBe(403);
    expect(JSON.stringify(await forbidden.json())).not.toContain(P1);
    expect(requireResourceAdmin).toHaveBeenCalledWith('season', SEASON_ID.toUpperCase());
    expect(loadFreshKitContext).not.toHaveBeenCalled();
    expect(loadUnmasked).not.toHaveBeenCalled();
    expect(logAuditEventStrict).not.toHaveBeenCalled();
  });

  it('returns the unmasked relations and the per-player states, never a pick, and is never cached', async () => {
    const response = await POST(post(), params);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(loadFreshKitContext).toHaveBeenCalledWith(SEASON_ID);
    expect(loadUnmasked).toHaveBeenCalledWith(CTX, ADMIN_ID);
    const text = await response.text();
    expect(JSON.parse(text).data).toEqual(UNMASKED);
    expect(text).not.toContain('picks');
    expect(text).not.toContain('"item_id"');
    expect(text).not.toContain('"status"');
    expectNoPrivatePlayerData(JSON.parse(text));
  });

  it('sends every row of an admin who also plays, marked involves_viewer, and does not filter anything out', async () => {
    vi.mocked(loadUnmasked).mockResolvedValue(UNMASKED_PLAYING);
    const response = await POST(post(), params);
    expect(response.status).toBe(200);
    const data = (await response.json()).data as AdminUnmasked;
    expect(data).toEqual(UNMASKED_PLAYING);
    expect(data.relations[0].links).toHaveLength(1);
    expect(data.relations[0].links[0].involves_viewer).toBe(true);
    expect(data.submissions[0].rows[0].involves_viewer).toBe(true);
    // The audit entry is the same for either reader: it names the relations, never the rows or the marker.
    expect(JSON.stringify(vi.mocked(logAuditEventStrict).mock.calls)).not.toContain('involves_viewer');
  });

  it('writes the audit entry before it returns the body, naming the relations and no pair', async () => {
    const order: string[] = [];
    vi.mocked(logAuditEventStrict).mockImplementation(async () => {
      await Promise.resolve();
      order.push('audit');
    });
    vi.mocked(loadUnmasked).mockImplementation(async () => {
      order.push('read');
      return UNMASKED;
    });
    const response = await POST(post(), params);
    order.push('returned');
    expect(response.status).toBe(200);
    expect(order).toEqual(['read', 'audit', 'returned']);
    expect(logAuditEventStrict).toHaveBeenCalledWith({
      action: 'season.format.relations.view_hidden',
      actor_id: ADMIN_ID,
      actor_name: 'League Admin',
      resource_type: 'season',
      resource_id: SEASON_ID,
      metadata: { relations: ['santa'] },
    });
    const audit = JSON.stringify(vi.mocked(logAuditEventStrict).mock.calls);
    expect(audit).not.toContain(P1);
    expect(audit).not.toContain(P2);
  });

  it('fails closed: when the audit write fails the answer is a 503 with no data', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(logAuditEventStrict).mockRejectedValueOnce(new Error('Audit entry could not be written'));
    const response = await POST(post(), params);
    expect(response.status).toBe(503);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body.success).toBe(false);
    expect(body.code).toBe('unmask_audit_unavailable');
    expect(body.data).toBeUndefined();
    expect(text).not.toContain(P1);
    expect(text).not.toContain(P2);
    expect(text).not.toContain('Mara');
    expect(text).not.toContain('santa');
    expect(text).not.toContain('Audit entry could not be written');
    expect(loadUnmasked).toHaveBeenCalledTimes(1);
  });

  it('waits for the audit write: a slow write delays the body, it never races it', async () => {
    let finish: () => void = () => undefined;
    vi.mocked(logAuditEventStrict).mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
    let settled = false;
    const pending = POST(post(), params).then((response) => {
      settled = true;
      return response;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    finish();
    expect((await pending).status).toBe(200);
  });

  it('accepts an empty body and rejects any member', async () => {
    expect((await POST(post(''), params)).status).toBe(200);
    const extra = await POST(post(JSON.stringify({ include_hidden: true })), params);
    expect(extra.status).toBe(400);
    expect((await extra.json()).code).toBe('validation_failed');
    expect(loadUnmasked).toHaveBeenCalledTimes(1);
  });

  it('answers 413 for a body over 8 KiB', async () => {
    const response = await POST(post(JSON.stringify({ padding: 'x'.repeat(9 * 1024) })), params);
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe('format_request_too_large');
    expect(logAuditEventStrict).not.toHaveBeenCalled();
  });

  it('answers 409 format_not_running for a league without a kit format, with no audit entry', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(null);
    const response = await POST(post(), params);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('format_not_running');
    expect(loadUnmasked).not.toHaveBeenCalled();
    expect(logAuditEventStrict).not.toHaveBeenCalled();
  });

  it('answers 429 with Retry-After and reads nothing', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 21 });
    const response = await POST(post(), params);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('21');
    expect(checkRateLimit).toHaveBeenCalledWith('format-runtime-admin-read', ADMIN_ID, expect.objectContaining({ limit: 60, windowSeconds: 60 }));
    expect(loadUnmasked).not.toHaveBeenCalled();
    expect(logAuditEventStrict).not.toHaveBeenCalled();
  });

  it('hides an unexpected failure behind the static message', async () => {
    vi.mocked(loadUnmasked).mockRejectedValueOnce(new Error('select * from format_relation_links failed'));
    const response = await POST(post(), params);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Failed to load the hidden relations');
    expect(JSON.stringify(body)).not.toContain('format_relation_links');
    expect(logAuditEventStrict).not.toHaveBeenCalled();
  });
});
