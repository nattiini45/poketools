import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/supabase/queries/players', () => ({
  banPlayer: vi.fn(),
  suspendPlayer: vi.fn(),
  unsuspendPlayer: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { POST as suspendPost } from '@/app/api/admin/players/[id]/suspend/route';
import { POST as unsuspendPost } from '@/app/api/admin/players/[id]/unsuspend/route';
import { requireAdmin } from '@/lib/auth/helpers';
import { banPlayer, suspendPlayer, unsuspendPlayer } from '@/lib/supabase/queries/players';
import { logAuditEvent } from '@/lib/audit/log';

const admin = { playerId: 'admin-1', name: 'Admin' };
const player = {
  id: '51541de2-cef5-42ee-8563-d412cf4563a2',
  name: 'Ash',
  discord_id: '111111111111111111',
  ps_username: 'ash',
  champions_username: '',
  avatar_url: null,
  avatar_config: null,
  is_admin: false,
  is_creator: false,
  joined_date: '2026-05-21T00:00:00Z',
  status: 'active' as const,
  suspended_until: null,
  ban_reason: null,
  created_at: '2026-05-21T00:00:00Z',
  updated_at: '2026-05-21T00:00:00Z',
};

const params = { params: Promise.resolve({ id: '51541de2-cef5-42ee-8563-d412cf4563a2' }) };

function request(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

describe('admin player discipline routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(admin as never);
    vi.mocked(suspendPlayer).mockResolvedValue(player as never);
    vi.mocked(banPlayer).mockResolvedValue(player as never);
    vi.mocked(unsuspendPlayer).mockResolvedValue(player as never);
  });

  it('suspends a player with a future date and writes audit log', async () => {
    const suspendedUntil = new Date(Date.now() + 86_400_000).toISOString();

    const res = await suspendPost(request({ type: 'suspend', suspended_until: suspendedUntil }), params);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(suspendPlayer).toHaveBeenCalledWith('51541de2-cef5-42ee-8563-d412cf4563a2', suspendedUntil);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'player.suspend',
      resource_id: '51541de2-cef5-42ee-8563-d412cf4563a2',
      metadata: { suspended_until: suspendedUntil },
    }));
  });

  it('bans a player with a reason and writes audit log', async () => {
    const res = await suspendPost(request({ type: 'ban', ban_reason: 'Repeated no-shows' }), params);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(banPlayer).toHaveBeenCalledWith('51541de2-cef5-42ee-8563-d412cf4563a2', 'Repeated no-shows');
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'player.ban',
      metadata: { reason: 'Repeated no-shows' },
    }));
  });

  it('rejects invalid discipline payloads', async () => {
    const res = await suspendPost(request({ type: 'suspend', suspended_until: '2000-01-01T00:00:00Z' }), params);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
    expect(suspendPlayer).not.toHaveBeenCalled();
  });

  it('accepts a future ISO datetime with a non-UTC offset', async () => {
    const future = new Date(Date.now() + 86_400_000);
    const withOffset = future.toISOString().replace('Z', '+02:00');

    const res = await suspendPost(request({ type: 'suspend', suspended_until: withOffset }), params);

    expect(res.status).toBe(200);
    expect(suspendPlayer).toHaveBeenCalledWith('51541de2-cef5-42ee-8563-d412cf4563a2', withOffset);
  });

  it.each([
    ['a datetime-local string without an offset', '2099-01-01T12:00'],
    ['a date-only string', '2099-01-01'],
    ['free text', 'next friday'],
  ])('rejects %s as suspended_until', async (_label, value) => {
    const res = await suspendPost(request({ type: 'suspend', suspended_until: value }), params);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(suspendPlayer).not.toHaveBeenCalled();
  });

  it('unsuspends a player and writes audit log', async () => {
    const res = await unsuspendPost({} as NextRequest, params);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(unsuspendPlayer).toHaveBeenCalledWith('51541de2-cef5-42ee-8563-d412cf4563a2');
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'player.unsuspend',
      resource_id: '51541de2-cef5-42ee-8563-d412cf4563a2',
    }));
  });
});