import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  isSuperadminNow: vi.fn(),
}));

vi.mock('@/lib/auth/superadmin', () => ({
  resolveSuperadminPlayerId: vi.fn(),
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
import { requireAdmin, isSuperadminNow } from '@/lib/auth/helpers';
import { resolveSuperadminPlayerId } from '@/lib/auth/superadmin';
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
    vi.mocked(resolveSuperadminPlayerId).mockResolvedValue(null);
    vi.mocked(isSuperadminNow).mockResolvedValue(false);
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

  describe('the superadmin row', () => {
    const futureDate = () => new Date(Date.now() + 86_400_000).toISOString();
    const protectedBody = {
      success: false,
      error: "Only the superadmin can change the superadmin's player",
      code: 'superadmin_player_protected',
    };
    const attempts: Array<[string, () => Promise<Response>]> = [
      ['suspend', () => suspendPost(request({ type: 'suspend', suspended_until: futureDate() }), params)],
      ['ban', () => suspendPost(request({ type: 'ban', ban_reason: 'Locked out' }), params)],
      ['unsuspend', () => unsuspendPost({} as NextRequest, params)],
    ];

    it.each(attempts)('refuses a non-superadmin admin on %s with no write and no audit row', async (_name, attempt) => {
      vi.mocked(resolveSuperadminPlayerId).mockResolvedValue(player.id);
      vi.mocked(isSuperadminNow).mockResolvedValue(false);

      const res = await attempt();

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(protectedBody);
      expect(suspendPlayer).not.toHaveBeenCalled();
      expect(banPlayer).not.toHaveBeenCalled();
      expect(unsuspendPlayer).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it.each(attempts)('lets the superadmin act on their own row on %s', async (_name, attempt) => {
      vi.mocked(resolveSuperadminPlayerId).mockResolvedValue(player.id);
      vi.mocked(isSuperadminNow).mockResolvedValue(true);

      const res = await attempt();

      expect(res.status).toBe(200);
      expect(logAuditEvent).toHaveBeenCalledTimes(1);
    });

    it.each(attempts)('lets an admin act on another player on %s', async (_name, attempt) => {
      vi.mocked(resolveSuperadminPlayerId).mockResolvedValue('0a0a0a0a-1111-4222-8333-555555555555');

      const res = await attempt();

      expect(res.status).toBe(200);
    });

    it.each(attempts)('fails closed on %s when the superadmin row cannot be read', async (_name, attempt) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(resolveSuperadminPlayerId).mockRejectedValue(new Error('db down'));

      const res = await attempt();

      expect(res.status).toBe(500);
      expect(suspendPlayer).not.toHaveBeenCalled();
      expect(banPlayer).not.toHaveBeenCalled();
      expect(unsuspendPlayer).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('matches the row whatever the case of the path id', async () => {
      vi.mocked(resolveSuperadminPlayerId).mockResolvedValue(player.id);
      const upper = { params: Promise.resolve({ id: player.id.toUpperCase() }) };

      const res = await suspendPost(request({ type: 'ban', ban_reason: 'x' }), upper);
      const unsuspend = await unsuspendPost({} as NextRequest, upper);

      expect(res.status).toBe(403);
      expect(unsuspend.status).toBe(403);
      expect(banPlayer).not.toHaveBeenCalled();
      expect(unsuspendPlayer).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('decides the caller from the live read, not the token', async () => {
      vi.mocked(resolveSuperadminPlayerId).mockResolvedValue(player.id);
      vi.mocked(isSuperadminNow).mockResolvedValue(false);

      await suspendPost(request({ type: 'ban', ban_reason: 'x' }), params);

      expect(isSuperadminNow).toHaveBeenCalledTimes(1);
    });
  });
});