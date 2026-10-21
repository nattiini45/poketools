/**
 * The signed-in account sprite style reaches every device (docs/pkmn.md,
 * "Sprite styles"): SpriteStyleAccountSync reads players.sprite_style once per
 * player and tab, and applies it when it differs from the cookie preference.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAILED_SYNC_RETRY_MS, resetSpriteStyleAccountSyncForTests, syncAccountSpriteStyle } from '../SpriteStyleAccountSync';
import { loadStoredSpriteStylePreference } from '../sprite-style-client';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};

beforeEach(() => {
  resetSpriteStyleAccountSyncForTests();
  vi.stubGlobal('window', { sessionStorage: memoryStorage() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let clock = 1_000_000;
const deps = (stored: 'pixel' | 'home' | null | 'fail', current: 'site' | 'pixel' = 'site') => ({
  load: vi.fn(async () => (stored === 'fail' ? ({ ok: false } as const) : ({ ok: true, stored } as const))),
  current: () => current,
  apply: vi.fn(async () => true),
  cancelled: () => false,
  now: () => clock,
});

describe('syncAccountSpriteStyle', () => {
  it('applies a differing account value once, then skips for the same player in this tab', async () => {
    const d = deps('pixel');
    expect(await syncAccountSpriteStyle('p1', d)).toBe('applied');
    expect(d.apply).toHaveBeenCalledWith('pixel');
    expect(await syncAccountSpriteStyle('p1', d)).toBe('skipped');
    expect(d.load).toHaveBeenCalledTimes(1);
  });

  it('the tab mark survives a reload (sessionStorage) without a second read', async () => {
    await syncAccountSpriteStyle('p1', deps('home'));
    resetSpriteStyleAccountSyncForTests(); // a new page load: in-memory marks are gone
    const d = deps('home');
    expect(await syncAccountSpriteStyle('p1', d)).toBe('skipped');
    expect(d.load).not.toHaveBeenCalled();
  });

  it('works when storage is blocked (in-memory mark only)', async () => {
    vi.stubGlobal('window', {
      get sessionStorage(): Storage {
        throw new Error('SecurityError');
      },
    });
    const d = deps('pixel');
    expect(await syncAccountSpriteStyle('p1', d)).toBe('applied');
    expect(await syncAccountSpriteStyle('p1', d)).toBe('skipped');
  });

  it('an equal value or no account value changes nothing', async () => {
    const same = deps('pixel', 'pixel');
    expect(await syncAccountSpriteStyle('p1', same)).toBe('unchanged');
    expect(same.apply).not.toHaveBeenCalled();
    const none = deps(null);
    expect(await syncAccountSpriteStyle('p2', none)).toBe('unchanged');
    expect(none.apply).not.toHaveBeenCalled();
  });

  it('a failed read (a banned account, a 500) is not repeated on every reload, and retried after the backoff', async () => {
    expect(await syncAccountSpriteStyle('p1', deps('fail'))).toBe('failed');
    // Reloads inside the window: no request (and no console error line) per page.
    resetSpriteStyleAccountSyncForTests(); // a new page load: only the sessionStorage mark remains
    clock += FAILED_SYNC_RETRY_MS - 1;
    const early = deps('pixel');
    expect(await syncAccountSpriteStyle('p1', early)).toBe('deferred');
    expect(early.load).not.toHaveBeenCalled();
    // After the window the next load retries, and a success clears the failure mark.
    clock += 1;
    const retry = deps('pixel');
    expect(await syncAccountSpriteStyle('p1', retry)).toBe('applied');
    expect(window.sessionStorage.getItem('plc_sprite_style_sync_failed:p1')).toBeNull();
  });

  it('a failure mark is per player and survives blocked storage in memory', async () => {
    expect(await syncAccountSpriteStyle('p1', deps('fail'))).toBe('failed');
    expect(await syncAccountSpriteStyle('p2', deps('home'))).toBe('applied');
    vi.stubGlobal('window', {
      get sessionStorage(): Storage {
        throw new Error('SecurityError');
      },
    });
    expect(await syncAccountSpriteStyle('p3', deps('fail'))).toBe('failed');
    const again = deps('pixel');
    expect(await syncAccountSpriteStyle('p3', again)).toBe('deferred');
    expect(again.load).not.toHaveBeenCalled();
  });

  it('a new player (account switch) syncs again', async () => {
    await syncAccountSpriteStyle('p1', deps('pixel'));
    const other = deps('home');
    expect(await syncAccountSpriteStyle('p2', other)).toBe('applied');
    expect(other.apply).toHaveBeenCalledWith('home');
  });
});

describe('loadStoredSpriteStylePreference', () => {
  const respond = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it('returns the stored value or null', async () => {
    respond(200, { success: true, data: { stored: 'animated' } });
    expect(await loadStoredSpriteStylePreference()).toEqual({ ok: true, stored: 'animated' });
    respond(200, { success: true, data: { stored: null } });
    expect(await loadStoredSpriteStylePreference()).toEqual({ ok: true, stored: null });
  });

  it('a refused, malformed or failed request is { ok: false } and logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    respond(500, { success: false, code: 'sprite_style_load_failed' });
    expect(await loadStoredSpriteStylePreference()).toEqual({ ok: false });
    respond(200, { success: true, data: { stored: 'sepia' } });
    expect(await loadStoredSpriteStylePreference()).toEqual({ ok: false });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    expect(await loadStoredSpriteStylePreference()).toEqual({ ok: false });
    expect(log).toHaveBeenCalledTimes(3);
  });
});
