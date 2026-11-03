/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPwaCaches, deletePwaCaches, isPwaShellEntry } from '../caches';
import { FakeCacheStorage } from './fake-cache-storage';

async function storeWith(entries: Record<string, string[]>): Promise<FakeCacheStorage> {
  const storage = new FakeCacheStorage();
  for (const [name, urls] of Object.entries(entries)) {
    const cache = await storage.open(name);
    for (const url of urls) await cache.put(`https://poketools.test${url}`, new Response('x'));
  }
  vi.stubGlobal('caches', storage);
  return storage;
}

afterEach(() => vi.unstubAllGlobals());

describe('isPwaShellEntry', () => {
  it.each(['/offline.html', '/pwa/icon-192.png', '/_next/static/chunks/a.js'])('%s stays', (path) => {
    expect(isPwaShellEntry(`https://poketools.test${path}`)).toBe(true);
  });

  it.each(['/', '/dashboard', '/teams/shared/abc', '/offline.html/x', '/pwa', '/api/players', '/avatar/a.png'])(
    '%s goes',
    (path) => {
      expect(isPwaShellEntry(`https://poketools.test${path}`)).toBe(false);
    },
  );

  it('ignores the query string and rejects a URL it cannot read', () => {
    expect(isPwaShellEntry('https://poketools.test/offline.html?x=1')).toBe(true);
    expect(isPwaShellEntry('https://poketools.test/dashboard?next=/offline.html')).toBe(false);
    expect(isPwaShellEntry('http://[bad')).toBe(false);
  });
});

describe('clearPwaCaches (before sign-out)', () => {
  it('removes every entry that is not the offline page or a static file, in every worker cache', async () => {
    const storage = await storeWith({
      'poketools-shell-v1': ['/offline.html', '/pwa/icon-192.png', '/dashboard', '/teams/shared/abc'],
      'poketools-shell-abc123': ['/offline.html', '/_next/static/chunks/a.js', '/'],
    });
    await clearPwaCaches();
    expect(storage.paths()).toEqual({
      'poketools-shell-v1': ['/offline.html', '/pwa/icon-192.png'],
      'poketools-shell-abc123': ['/_next/static/chunks/a.js', '/offline.html'],
    });
  });

  it('leaves other caches alone', async () => {
    const storage = await storeWith({ 'poketools-shell-v1': ['/dashboard'], 'someone-elses-cache': ['/dashboard'] });
    await clearPwaCaches();
    expect(storage.paths()).toEqual({ 'poketools-shell-v1': [], 'someone-elses-cache': ['/dashboard'] });
  });

  it('never rejects, so a failure cannot block signing out', async () => {
    const storage = await storeWith({ 'poketools-shell-v1': ['/dashboard'] });
    storage.failDeletes = true;
    await expect(clearPwaCaches()).resolves.toBeUndefined();
  });

  it('does nothing in a browser without Cache Storage', async () => {
    Reflect.deleteProperty(window, 'caches');
    await expect(clearPwaCaches()).resolves.toBeUndefined();
  });
});

describe('deletePwaCaches (shell switched off)', () => {
  it('deletes every worker cache, the offline page included, and leaves other caches alone', async () => {
    const storage = await storeWith({
      'poketools-shell-v1': ['/offline.html'],
      'poketools-shell-abc123': ['/dashboard'],
      'someone-elses-cache': ['/offline.html'],
    });
    await deletePwaCaches();
    expect(storage.paths()).toEqual({ 'someone-elses-cache': ['/offline.html'] });
  });

  it('never rejects, so a failure cannot block switching the shell off', async () => {
    const storage = await storeWith({ 'poketools-shell-v1': ['/offline.html'] });
    storage.failDeletes = true;
    await expect(deletePwaCaches()).resolves.toBeUndefined();
  });

  it('does nothing in a browser without Cache Storage', async () => {
    Reflect.deleteProperty(window, 'caches');
    await expect(deletePwaCaches()).resolves.toBeUndefined();
  });
});
