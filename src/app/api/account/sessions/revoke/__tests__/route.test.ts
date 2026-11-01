import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    code?: string;
    constructor(message: string, statusCode: number, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

vi.mock('@/lib/supabase/queries/players', () => ({
  revokePlayerSessions: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { POST } from '@/app/api/account/sessions/revoke/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { revokePlayerSessions } from '@/lib/supabase/queries/players';
import { logAuditEvent } from '@/lib/audit/log';

describe('POST /api/account/sessions/revoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue({
      playerId: 'player-1',
      name: 'Ash',
    } as Awaited<ReturnType<typeof requirePlayer>>);
    vi.mocked(revokePlayerSessions).mockResolvedValue(undefined);
  });

  it('answers 401 to an anonymous caller and writes nothing', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(new AuthError('Not authenticated', 401, 'unauthenticated'));

    const res = await POST();

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false, code: 'unauthenticated' });
    expect(revokePlayerSessions).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('refuses a banned caller the way every guarded route does, without writing', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(new AuthError('Your account has been banned', 403, 'account_banned'));

    const res = await POST();

    expect(res.status).toBe(403);
    expect(revokePlayerSessions).not.toHaveBeenCalled();
  });

  it('revokes the signed-in player\'s sessions, never an id from the request', async () => {
    const res = await POST();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { revoked: true } });
    expect(revokePlayerSessions).toHaveBeenCalledTimes(1);
    expect(revokePlayerSessions).toHaveBeenCalledWith('player-1');
  });

  it('records one audit event on the player', async () => {
    await POST();

    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_id: 'player-1',
        actor_name: 'Ash',
        action: 'player.sessions_revoke',
        resource_type: 'player',
        resource_id: 'player-1',
        resource_name: 'Ash',
      }),
    );
  });

  it('audits nothing and reports a distinct failure when the write fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(revokePlayerSessions).mockRejectedValue(new Error('db down'));

    const res = await POST();

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false, code: 'session_revoke_failed' });
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
