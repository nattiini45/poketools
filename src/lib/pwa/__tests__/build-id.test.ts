import { afterEach, describe, expect, it, vi } from 'vitest';
import { pwaBuildId } from '../build-id';

afterEach(() => vi.unstubAllEnvs());

describe('pwaBuildId', () => {
  it('returns the baked-in build id', () => {
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', '0123456789ab');
    expect(pwaBuildId()).toBe('0123456789ab');
  });

  it.each(['', '   ', 'has space', 'a/b', '../x', 'x'.repeat(65)])('uses dev for %j', (value) => {
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', value);
    expect(pwaBuildId()).toBe('dev');
  });
});
