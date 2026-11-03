import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc, from: rpc, storage: { from: rpc } } }));

import { POST } from '../route';
import { resetMemoryRateLimits } from '@/lib/utils/rate-limit';
import { CSP_REPORT_MAX_BYTES } from '@/lib/security/csp-report';

const legacyBody = {
  'csp-report': {
    'document-uri': 'https://poketools.test/leagues/abc?token=SECRET',
    'effective-directive': 'script-src-elem',
    'blocked-uri': 'inline',
    disposition: 'report',
  },
};
const reportingBody = [
  { type: 'csp-violation', url: 'https://poketools.test/', body: { effectiveDirective: 'img-src', blockedURL: 'https://x.test/a.png', disposition: 'report' } },
];

function report(body: unknown, headers: Record<string, string> = {}, type = 'application/csp-report') {
  return new NextRequest('https://poketools.test/api/csp-report', {
    method: 'POST',
    headers: { 'content-type': type, 'x-forwarded-for': '203.0.113.9', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetMemoryRateLimits();
  rpc.mockReset();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  warn.mockRestore();
  error.mockRestore();
});

describe('POST /api/csp-report (#37)', () => {
  it('accepts a legacy application/csp-report body without credentials and answers 204', async () => {
    const res = await POST(report(legacyBody));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('accepts an application/reports+json body', async () => {
    const res = await POST(report(reportingBody, {}, 'application/reports+json'));
    expect(res.status).toBe(204);
  });

  it('writes one capped line per accepted report, never the body', async () => {
    await POST(report(legacyBody));
    expect(warn).toHaveBeenCalledTimes(1);
    const [tag, line] = warn.mock.calls[0] as [string, string];
    expect(tag).toBe('[csp-report]');
    expect(line.length).toBeLessThanOrEqual(600);
    expect(line).toContain('script-src-elem');
    expect(line).not.toContain('SECRET');
  });

  it('stores nothing: no database or storage call, even on a Postgres-limiter deployment', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres');
    await POST(report(legacyBody));
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a body over the cap with 413 and does not log it', async () => {
    const big = JSON.stringify({ 'csp-report': { 'document-uri': 'x'.repeat(CSP_REPORT_MAX_BYTES) } });
    const res = await POST(report(big));
    expect(res.status).toBe(413);
    expect(warn).not.toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain('x'.repeat(200));
  });

  it('refuses an oversized body that lies about its length', async () => {
    const big = JSON.stringify({ 'csp-report': { 'document-uri': 'x'.repeat(CSP_REPORT_MAX_BYTES) } });
    const res = await POST(report(big, { 'content-length': '10' }));
    expect(res.status).toBe(413);
  });

  it('answers 415 for a content type browsers do not use for reports', async () => {
    expect((await POST(report('hello', {}, 'text/plain'))).status).toBe(415);
  });

  it('answers 400 for a body that is not JSON, and for JSON that is not a CSP report', async () => {
    expect((await POST(report('{not json'))).status).toBe(400);
    expect((await POST(report({ hello: 'world' }))).status).toBe(400);
    expect(warn).not.toHaveBeenCalled();
  });

  it('limits one client address, then answers 429 with Retry-After', async () => {
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 80; i += 1) {
      last = await POST(report(legacyBody));
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 60).every((s) => s === 204)).toBe(true);
    expect(statuses[60]).toBe(429);
    expect(Number(last?.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    // Another address has its own budget.
    expect((await POST(report(legacyBody, { 'x-forwarded-for': '203.0.113.10' }))).status).toBe(204);
  });
});
