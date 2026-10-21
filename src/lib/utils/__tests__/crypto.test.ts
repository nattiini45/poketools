import { describe, expect, it } from 'vitest';
import { signLinkToken, verifyLinkToken, timingSafeCompare, secretsEqual } from '../crypto';

const SECRET = 'test-secret';

describe('timingSafeCompare', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeCompare('abc', 'abc')).toBe(true);
  });

  it('returns false for different strings and lengths', () => {
    expect(timingSafeCompare('abc', 'abd')).toBe(false);
    expect(timingSafeCompare('abc', 'abcd')).toBe(false);
  });
});

describe('signLinkToken / verifyLinkToken', () => {
  it('round-trips a payload', () => {
    const token = signLinkToken('player-uuid-1', Date.now() + 60_000, SECRET);
    expect(verifyLinkToken(token, SECRET)).toBe('player-uuid-1');
  });

  it('rejects an expired token', () => {
    const token = signLinkToken('player-uuid-1', Date.now() - 1, SECRET);
    expect(verifyLinkToken(token, SECRET)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = signLinkToken('player-uuid-1', Date.now() + 60_000, 'other-secret');
    expect(verifyLinkToken(token, SECRET)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = signLinkToken('player-uuid-1', Date.now() + 60_000, SECRET);
    const [, exp, sig] = token.split('.');
    expect(verifyLinkToken(`player-uuid-2.${exp}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects a tampered expiry', () => {
    const token = signLinkToken('player-uuid-1', Date.now() + 60_000, SECRET);
    const [payload, , sig] = token.split('.');
    expect(verifyLinkToken(`${payload}.${Date.now() + 999_999}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyLinkToken('', SECRET)).toBeNull();
    expect(verifyLinkToken('only-one-part', SECRET)).toBeNull();
    expect(verifyLinkToken('a.b', SECRET)).toBeNull();
    expect(verifyLinkToken('a.b.c.d', SECRET)).toBeNull();
    expect(verifyLinkToken('.123.sig', SECRET)).toBeNull();
  });
});

describe('secretsEqual', () => {
  it('matches equal secrets and rejects different ones, of any length', () => {
    expect(secretsEqual('correct horse', 'correct horse')).toBe(true);
    expect(secretsEqual('correct horse', 'correct horsf')).toBe(false);
    expect(secretsEqual('short', 'a much longer expected secret')).toBe(false);
    expect(secretsEqual('', 'x')).toBe(false);
  });
});
