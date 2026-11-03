import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger, serializeError } from '../logger';

function lastLine(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const calls = spy.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return JSON.parse(String(calls[calls.length - 1][0])) as Record<string, unknown>;
}

describe('serializeError', () => {
  it('keeps the name, message and stack of an Error', () => {
    const out = serializeError(new TypeError('boom'));
    expect(out.name).toBe('TypeError');
    expect(out.message).toBe('boom');
    expect(out.stack).toContain('boom');
  });

  it('reads a Supabase error object: message, code, details and hint', () => {
    const out = serializeError({ message: 'duplicate key', code: '23505', details: 'Key (id) exists', hint: 'use upsert' });
    expect(out).toEqual({ message: 'duplicate key', code: '23505', details: 'Key (id) exists', hint: 'use upsert' });
  });

  it('follows the cause chain and stops at a bounded depth', () => {
    let chain: Error = new Error('level-0');
    for (let i = 1; i <= 6; i++) chain = new Error(`level-${i}`, { cause: chain });
    let out = serializeError(chain);
    let depth = 0;
    while (out.cause) {
      out = out.cause;
      depth += 1;
    }
    expect(depth).toBe(3);
  });

  it('describes a non-object throw value', () => {
    expect(serializeError('plain string')).toEqual({ message: 'plain string' });
    expect(serializeError(null)).toEqual({ message: 'null' });
  });

  it('falls back to a placeholder message when an object has none', () => {
    expect(serializeError({ foo: 1 }).message).toBe('unknown error');
  });
});

describe('logger', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('writes one JSON line per call to the console method of its level', () => {
    logger.error('api', 'failed', { requestId: 'abc' });
    logger.warn('api', 'careful');
    logger.info('api', 'fyi');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(lastLine(errorSpy)).toMatchObject({ level: 'error', tag: 'api', message: 'failed', requestId: 'abc' });
    expect(typeof lastLine(errorSpy).timestamp).toBe('string');
  });

  it('serialises an Error passed as meta: message and stack reach the line', () => {
    logger.error('api', 'failed', { error: new Error('kaboom') });
    const line = lastLine(errorSpy);
    expect(line.error).toMatchObject({ name: 'Error', message: 'kaboom' });
    expect(String((line.error as { stack: string }).stack)).toContain('kaboom');
  });

  it('serialises an Error under any meta key, and a Supabase error object under `error`', () => {
    logger.error('api', 'failed', { cause: new Error('inner'), error: { message: 'db down', code: 'PGRST301' } });
    const line = lastLine(errorSpy);
    expect(line.cause).toMatchObject({ message: 'inner' });
    expect(line.error).toEqual({ message: 'db down', code: 'PGRST301' });
  });

  it('does not let meta overwrite the fixed fields', () => {
    logger.warn('api', 'real message', { level: 'info', tag: 'forged', message: 'forged' });
    expect(lastLine(warnSpy)).toMatchObject({ level: 'warn', tag: 'api', message: 'real message' });
  });

  it('never throws on a value JSON cannot encode', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => logger.error('api', 'circular', { circular })).not.toThrow();
    expect(lastLine(errorSpy)).toMatchObject({ level: 'error', tag: 'api', message: 'circular' });
  });
});
