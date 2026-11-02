/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPwaCaches } from '../caches';

function stubCaches(keys: string[], failDelete = false) {
  const deleted: string[] = [];
  vi.stubGlobal('caches', {
    keys: vi.fn(async () => keys),
    delete: vi.fn(async (key: string) => {
      if (failDelete) throw new Error('blocked');
      deleted.push(key);
      return true;
    }),
  });
  return deleted;
}

afterEach(() => vi.unstubAllGlobals());

describe('clearPwaCaches', () => {
  it('deletes every worker cache and leaves other caches alone', async () => {
    const deleted = stubCaches(['poketools-shell-v1', 'poketools-shell-abc123', 'someone-elses-cache']);
    await clearPwaCaches();
    expect(deleted.sort()).toEqual(['poketools-shell-abc123', 'poketools-shell-v1']);
  });

  it('never rejects, so a failure cannot block signing out', async () => {
    stubCaches(['poketools-shell-v1'], true);
    await expect(clearPwaCaches()).resolves.toBeUndefined();
  });

  it('does nothing in a browser without Cache Storage', async () => {
    Reflect.deleteProperty(window, 'caches');
    await expect(clearPwaCaches()).resolves.toBeUndefined();
  });
});
