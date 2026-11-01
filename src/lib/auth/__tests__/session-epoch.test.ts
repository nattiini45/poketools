import { describe, expect, it } from 'vitest';
import { isSessionRevoked, parseSessionsValidAfter, SessionRevokedError } from '../session-epoch';

const T = Date.parse('2026-11-02T12:00:00.000Z');

describe('parseSessionsValidAfter', () => {
  it('reads -infinity as the beginning of time', () => {
    expect(parseSessionsValidAfter('-infinity')).toBe(Number.NEGATIVE_INFINITY);
  });

  it('reads the ISO timestamps PostgREST returns, microseconds included', () => {
    expect(parseSessionsValidAfter('2026-11-02T12:00:00.000Z')).toBe(T);
    expect(parseSessionsValidAfter('2026-11-02T12:00:00.123456+00:00')).toBe(T + 123);
  });

  it('fails closed on a value it cannot read', () => {
    expect(() => parseSessionsValidAfter(null)).toThrow();
    expect(() => parseSessionsValidAfter(undefined)).toThrow();
    expect(() => parseSessionsValidAfter('not a date')).toThrow();
    expect(() => parseSessionsValidAfter(12)).toThrow();
  });
});

describe('isSessionRevoked', () => {
  it('keeps a token issued after the epoch', () => {
    expect(isSessionRevoked(T + 1, new Date(T).toISOString())).toBe(false);
  });

  it('keeps a token issued at the very epoch (equal is valid)', () => {
    expect(isSessionRevoked(T, new Date(T).toISOString())).toBe(false);
  });

  it('revokes a token issued before the epoch', () => {
    expect(isSessionRevoked(T - 1, new Date(T).toISOString())).toBe(true);
  });

  it('never revokes while the epoch is -infinity, with or without a stamp', () => {
    expect(isSessionRevoked(T, '-infinity')).toBe(false);
    expect(isSessionRevoked(undefined, '-infinity')).toBe(false);
  });

  it('treats a token without authAt as legacy: valid until the first revocation, revoked by any', () => {
    expect(isSessionRevoked(undefined, '-infinity')).toBe(false);
    expect(isSessionRevoked(undefined, new Date(T).toISOString())).toBe(true);
    expect(isSessionRevoked(null, new Date(T).toISOString())).toBe(true);
    expect(isSessionRevoked('1', new Date(T).toISOString())).toBe(true);
    expect(isSessionRevoked(Number.NaN, new Date(T).toISOString())).toBe(true);
  });
});

describe('SessionRevokedError', () => {
  it('is an Error with a stable name', () => {
    const err = new SessionRevokedError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SessionRevokedError');
  });
});
