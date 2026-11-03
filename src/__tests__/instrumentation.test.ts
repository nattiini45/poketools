import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestError } from '@/instrumentation';

const context = { routerKind: 'App Router', routePath: '/api/players/[id]', routeType: 'route' } as const;

interface LoggedLine {
  path?: string;
  requestId?: string;
  error: { stack: string } | string;
  [key: string]: unknown;
}

function loggedLines(spy: ReturnType<typeof vi.spyOn>): LoggedLine[] {
  return spy.mock.calls.map(([line]: unknown[]) => JSON.parse(String(line)));
}

describe('instrumentation onRequestError()', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('writes exactly one JSON line with the digest, path, method, route and serialised error', async () => {
    const err = Object.assign(new Error('render exploded'), { digest: '1234567890' });
    await onRequestError(err, { path: '/players/abc', method: 'GET', headers: {} }, context);

    const lines = loggedLines(errorSpy);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'error',
      tag: 'request',
      digest: '1234567890',
      path: '/players/abc',
      method: 'GET',
      routerKind: 'App Router',
      routePath: '/api/players/[id]',
      routeType: 'route',
      error: { name: 'Error', message: 'render exploded' },
    });
    expect((lines[0].error as { stack: string }).stack).toContain('render exploded');
  });

  it('strips the query string and fragment from the path', async () => {
    await onRequestError(
      new Error('x'),
      { path: '/auth/confirm?token_hash=SECRET&type=recovery#frag', method: 'GET', headers: {} },
      context,
    );

    const raw = String(errorSpy.mock.calls[0][0]);
    expect(loggedLines(errorSpy)[0].path).toBe('/auth/confirm');
    expect(raw).not.toContain('SECRET');
    expect(raw).not.toContain('token_hash');
  });

  it('logs no cookie, authorization header or other header, only a plain x-request-id', async () => {
    await onRequestError(
      new Error('x'),
      {
        path: '/api/a',
        method: 'POST',
        headers: { cookie: 'session=COOKIE-SECRET', authorization: 'Bearer BEARER-SECRET', 'x-request-id': 'req-1234abcd' },
      },
      context,
    );

    const raw = String(errorSpy.mock.calls[0][0]);
    expect(loggedLines(errorSpy)[0].requestId).toBe('req-1234abcd');
    expect(raw).not.toContain('COOKIE-SECRET');
    expect(raw).not.toContain('BEARER-SECRET');
  });

  it('drops an x-request-id that is not a plain token', async () => {
    await onRequestError(new Error('x'), { path: '/a', method: 'GET', headers: { 'x-request-id': 'a b\nc' } }, context);
    expect(loggedLines(errorSpy)[0]).not.toHaveProperty('requestId');
  });

  it('writes a line for an error without a digest', async () => {
    await onRequestError('plain string', { path: '/a', method: 'GET', headers: {} }, context);
    const line = loggedLines(errorSpy)[0];
    expect(line).not.toHaveProperty('digest');
    expect(line.error).toBe('plain string');
  });

  it('skips the edge runtime, which must not load the Node-only logger path', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await onRequestError(new Error('x'), { path: '/a', method: 'GET', headers: {} }, context);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('never throws when the log call fails', async () => {
    errorSpy.mockImplementation(() => {
      throw new Error('stdout closed');
    });
    await expect(onRequestError(new Error('x'), { path: '/a', method: 'GET', headers: {} }, context)).resolves.toBeUndefined();
  });
});
