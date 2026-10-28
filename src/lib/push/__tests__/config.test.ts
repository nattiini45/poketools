import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { readPushConfig, resetPushConfigWarning } from '../config';
import { makeVapidKeys } from './fixtures';

const pair = makeVapidKeys();
const good = {
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: pair.publicKey,
  VAPID_PRIVATE_KEY: pair.privateKey,
  VAPID_SUBJECT: 'mailto:admin@example.com',
};

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  resetPushConfigWarning();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

function warnedText(): string {
  return warn.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
}

describe('readPushConfig', () => {
  it('returns the configuration when all three are valid, trimming whitespace', () => {
    expect(readPushConfig({ ...good, VAPID_SUBJECT: '  mailto:admin@example.com  ' })).toEqual({
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
      subject: 'mailto:admin@example.com',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('accepts an https subject', () => {
    expect(readPushConfig({ ...good, VAPID_SUBJECT: 'https://poketools.example/contact' })).not.toBeNull();
  });

  it('is disabled (null) when nothing is set, with one warning naming the variables', () => {
    expect(readPushConfig({})).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const text = warnedText();
    expect(text).toContain('NEXT_PUBLIC_VAPID_PUBLIC_KEY');
    expect(text).toContain('VAPID_PRIVATE_KEY');
    expect(text).toContain('VAPID_SUBJECT');
  });

  it('warns once per process, however often it is asked', () => {
    readPushConfig({});
    readPushConfig({});
    readPushConfig({ ...good, VAPID_SUBJECT: '' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a missing subject', { ...good, VAPID_SUBJECT: undefined }, 'VAPID_SUBJECT (missing)'],
    ['a missing private key', { ...good, VAPID_PRIVATE_KEY: '   ' }, 'VAPID_PRIVATE_KEY (missing)'],
    ['a missing public key', { ...good, NEXT_PUBLIC_VAPID_PUBLIC_KEY: undefined }, 'NEXT_PUBLIC_VAPID_PUBLIC_KEY (missing)'],
    ['a public key that is not a key', { ...good, NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'abc' }, 'NEXT_PUBLIC_VAPID_PUBLIC_KEY (not a base64url P-256 public key)'],
    ['a private key of the wrong length', { ...good, VAPID_PRIVATE_KEY: 'abc' }, 'VAPID_PRIVATE_KEY (not a base64url P-256 private key)'],
    ['a subject that is neither mailto nor https', { ...good, VAPID_SUBJECT: 'admin@example.com' }, 'VAPID_SUBJECT (must be a mailto: address or an https URL)'],
    ['an http subject', { ...good, VAPID_SUBJECT: 'http://example.com' }, 'VAPID_SUBJECT (must be a mailto: address or an https URL)'],
    ['a mailto without an address', { ...good, VAPID_SUBJECT: 'mailto:' }, 'VAPID_SUBJECT (must be a mailto: address or an https URL)'],
  ])('is disabled for %s', (_label, env, reason) => {
    expect(readPushConfig(env)).toBeNull();
    expect(warnedText()).toContain(reason);
  });

  it('is disabled when the private key belongs to another public key', () => {
    const other = makeVapidKeys();
    expect(readPushConfig({ ...good, VAPID_PRIVATE_KEY: other.privateKey })).toBeNull();
    expect(warnedText()).toContain('does not match');
  });

  it('never logs a key or the subject', () => {
    readPushConfig({ ...good, VAPID_PRIVATE_KEY: `${pair.privateKey}x` });
    const text = warnedText();
    expect(text).not.toContain(pair.privateKey);
    expect(text).not.toContain(pair.publicKey);
    expect(text).not.toContain('admin@example.com');
  });
});
