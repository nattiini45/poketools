import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/league-trash', () => ({
  expireLeagueTrash: vi.fn(),
}));

vi.mock('@/lib/league-trash/social-image-sweep', () => ({
  sweepLeagueSocialImages: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { GET, POST } from '@/app/api/cron/expire-league-trash/route';
import { LEAGUE_TRASH_EXPIRE_BATCH } from '@/lib/league-trash/constants';
import { sweepLeagueSocialImages, type SocialImageSweepResult } from '@/lib/league-trash/social-image-sweep';
import { expireLeagueTrash, type LeagueTrashExpiredRow } from '@/lib/supabase/queries/league-trash';
import { logAuditEvent } from '@/lib/audit/log';

const originalCronSecret = process.env.CRON_SECRET;

function request(secret = 'secret', method = 'POST', query = '') {
  return new Request(`http://localhost/api/cron/expire-league-trash${query}`, {
    method,
    headers: { authorization: `Bearer ${secret}` },
  });
}

const row = (n: number): LeagueTrashExpiredRow => ({
  id: `trash-${n}`,
  season_id: `season-${n}`,
  season_name: `League ${n}`,
  deleted_at: '2026-07-01T10:00:00.000Z',
  purge_after: '2026-09-29T10:00:00.000Z',
  match_ids: [`match-${n}-a`, `match-${n}-b`],
});

const swept: SocialImageSweepResult = { swept: 2, unswept: 0, removed: 1, errors: [] };

describe('/api/cron/expire-league-trash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'secret';
    vi.mocked(expireLeagueTrash).mockResolvedValue([]);
    vi.mocked(sweepLeagueSocialImages).mockResolvedValue(swept);
  });

  afterEach(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
  });

  it('returns cron_not_configured and logs when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.code).toBe('cron_not_configured');
    expect(errorSpy).toHaveBeenCalledWith('[cron/expire-league-trash] CRON_SECRET not configured');
    expect(expireLeagueTrash).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('rejects a wrong secret, a different length and a missing header', async () => {
    for (const res of [
      await POST(request('wrong')),
      await POST(request('a-much-longer-token-than-the-configured-secret')),
      await POST(new Request('http://localhost/api/cron/expire-league-trash', { method: 'POST' })),
    ]) {
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe('cron_unauthorized');
    }
    expect(expireLeagueTrash).not.toHaveBeenCalled();
  });

  it('answers 200 with nothing due and writes no audit event', async () => {
    const res = await GET(request('secret', 'GET'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, data: { expired: 0, leagues: [] } });
    expect(sweepLeagueSocialImages).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('expires with the current time and the default batch, on GET and on POST', async () => {
    const before = Date.now();
    await GET(request('secret', 'GET'));
    await POST(request());

    expect(expireLeagueTrash).toHaveBeenCalledTimes(2);
    for (const [now, limit] of vi.mocked(expireLeagueTrash).mock.calls) {
      expect(now).toBeInstanceOf(Date);
      expect((now as Date).getTime()).toBeGreaterThanOrEqual(before);
      expect(limit).toBe(LEAGUE_TRASH_EXPIRE_BATCH);
    }
  });

  it('validates ?limit like the other crons', async () => {
    const ok = await POST(request('secret', 'POST', '?limit=5'));
    expect(ok.status).toBe(200);
    expect(vi.mocked(expireLeagueTrash).mock.calls[0][1]).toBe(5);

    for (const bad of ['0', '101', 'abc', '1.5']) {
      const res = await POST(request('secret', 'POST', `?limit=${bad}`));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('validation_failed');
    }
    expect(expireLeagueTrash).toHaveBeenCalledTimes(1);
  });

  it('writes one System audit event per removed league and sweeps each league\'s matches', async () => {
    vi.mocked(expireLeagueTrash).mockResolvedValue([row(1), row(2)]);

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.expired).toBe(2);
    expect(body.data.leagues).toEqual([
      { trash_id: 'trash-1', season_id: 'season-1', social_images: swept },
      { trash_id: 'trash-2', season_id: 'season-2', social_images: swept },
    ]);
    expect(sweepLeagueSocialImages).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sweepLeagueSocialImages).mock.calls[0][0]).toEqual(['match-1-a', 'match-1-b']);

    expect(logAuditEvent).toHaveBeenCalledTimes(2);
    expect(logAuditEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        actor_id: null,
        actor_name: 'System',
        action: 'season.purge',
        resource_type: 'season',
        resource_id: 'season-1',
        resource_name: 'League 1',
        metadata: {
          trash_id: 'trash-1',
          deleted_at: '2026-07-01T10:00:00.000Z',
          purge_after: '2026-09-29T10:00:00.000Z',
          matches: 2,
          social_images: swept,
        },
      }),
    );
  });

  it('shares one sweep deadline across the leagues of a run', async () => {
    vi.mocked(expireLeagueTrash).mockResolvedValue([row(1), row(2)]);

    await POST(request());

    const [first, second] = vi.mocked(sweepLeagueSocialImages).mock.calls;
    expect(first[1]).toBe(second[1]);
    expect(first[1]).toBeGreaterThan(Date.now());
  });

  it('keeps the expiry a success when a sweep reports failures, and records them', async () => {
    vi.mocked(expireLeagueTrash).mockResolvedValue([row(1)]);
    const failed: SocialImageSweepResult = {
      swept: 1,
      unswept: 1,
      removed: 0,
      errors: ['league_trash_social_sweep_list_failed', 'league_trash_social_sweep_incomplete'],
    };
    vi.mocked(sweepLeagueSocialImages).mockResolvedValue(failed);

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.leagues[0].social_images).toEqual(failed);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'season.purge', metadata: expect.objectContaining({ social_images: failed }) }),
    );
  });

  it('answers 5xx when the expiry itself fails, so function-error alerting sees it', async () => {
    vi.mocked(expireLeagueTrash).mockRejectedValue(new Error('rpc failed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const res = await POST(request());
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Failed to expire the league trash');
      expect(logAuditEvent).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
