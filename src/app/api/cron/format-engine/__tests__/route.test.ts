import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/format-engine/runtime/cron', () => ({ runFormatCronPass: vi.fn() }));

import { GET, POST, maxDuration } from '@/app/api/cron/format-engine/route';
import { runFormatCronPass, type FormatCronSummary } from '@/lib/format-engine/runtime/cron';
import { logger } from '@/lib/logger';

const originalCronSecret = process.env.CRON_SECRET;

const request = (secret = 'secret', method = 'POST') =>
  new Request('http://localhost/api/cron/format-engine', { method, headers: { authorization: `Bearer ${secret}` } });

const summary = (over: Partial<FormatCronSummary> = {}): FormatCronSummary => ({
  leagues: 1,
  deferred: 0,
  marks: 2,
  forfeits: 1,
  checks: 0,
  locks: 0,
  picks: 0,
  challenges_expired: 0,
  failures: 0,
  ...over,
});

describe('/api/cron/format-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'secret';
    vi.mocked(runFormatCronPass).mockResolvedValue(summary());
  });

  afterEach(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
  });

  it('returns cron_not_configured and logs when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET;
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('cron_not_configured');
    expect(errorSpy).toHaveBeenCalledWith('cron/format-engine', 'CRON_SECRET not configured');
    expect(runFormatCronPass).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('rejects a wrong secret and a missing header', async () => {
    expect((await POST(request('wrong'))).status).toBe(401);
    expect((await GET(new Request('http://localhost/api/cron/format-engine'))).status).toBe(401);
    expect(runFormatCronPass).not.toHaveBeenCalled();
  });

  it('runs the pass on GET and POST and returns its summary', async () => {
    for (const handler of [GET, POST]) {
      const res = await handler(request('secret', 'GET'));
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual(summary());
    }
    expect(runFormatCronPass).toHaveBeenCalledTimes(2);
  });

  it('answers 5xx with the summary when a league failed, so function-error alerting sees it', async () => {
    vi.mocked(runFormatCronPass).mockResolvedValue(summary({ failures: 2 }));
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await POST(request());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.code).toBe('format_cron_partial_failure');
    expect(body.params).toEqual({ count: 2 });
    errorSpy.mockRestore();
  });

  it('answers 5xx when the pass itself throws', async () => {
    vi.mocked(runFormatCronPass).mockRejectedValue(new Error('boom'));
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    expect((await POST(request())).status).toBe(500);
    errorSpy.mockRestore();
  });

  it('keeps maxDuration at the heavy-route budget', () => {
    expect(maxDuration).toBe(300);
  });
});
