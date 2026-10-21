import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SITE_PALETTE_CHANGE_EVENT,
  applySitePalette,
  clearInvalidStoredSitePalette,
  readAppliedSitePalette,
  readStoredSitePalette,
  reconcileSitePalette,
  resetSitePaletteStateForTests,
  watchSitePaletteAttribute,
  subscribeSitePalette,
  withDefaultSitePalette,
  writeSitePalette,
} from '../site-palette-store';
import { SITE_PALETTE_ATTRIBUTE, SITE_PALETTE_STORAGE_KEY } from '../site-palettes';

type Listener = (event: Event) => void;

/** Stub `window`, `document` and `localStorage` (node env: no jsdom in this repo). */
function setup(options: { stored?: string; setItemThrows?: boolean; getItemThrows?: boolean } = {}) {
  const attrs = new Map<string, string>();
  const documentElement = {
    getAttribute: vi.fn((name: string) => attrs.get(name) ?? null),
    setAttribute: vi.fn((name: string, value: string) => {
      attrs.set(name, value);
    }),
    removeAttribute: vi.fn((name: string) => {
      attrs.delete(name);
    }),
  };
  const store = new Map<string, string>();
  if (options.stored !== undefined) store.set(SITE_PALETTE_STORAGE_KEY, options.stored);
  const localStorage = {
    getItem: vi.fn((key: string) => {
      if (options.getItemThrows) throw new Error('SecurityError');
      return store.get(key) ?? null;
    }),
    setItem: vi.fn((key: string, value: string) => {
      if (options.setItemThrows) throw new Error('QuotaExceededError');
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
  };
  const listeners = new Map<string, Set<Listener>>();
  const win = {
    localStorage,
    addEventListener: vi.fn((type: string, listener: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: Listener) => {
      listeners.get(type)?.delete(listener);
    }),
    dispatchEvent: vi.fn((event: Event) => {
      listeners.get(event.type)?.forEach((listener) => listener(event));
      return true;
    }),
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { documentElement });
  vi.stubGlobal('localStorage', localStorage);

  /** Another tab wrote localStorage. */
  const fireStorage = (key: string | null, newValue: string | null) => {
    const event = { type: 'storage', key, newValue } as unknown as Event;
    listeners.get('storage')?.forEach((listener) => listener(event));
  };
  const listenerCount = () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
  return { attrs, documentElement, store, localStorage, win, fireStorage, listenerCount };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetSitePaletteStateForTests();
});

describe('site palette store — writes', () => {
  it('writeSitePalette(sakura) applies, persists and notifies', () => {
    const env = setup();
    writeSitePalette('sakura');
    expect(env.attrs.get(SITE_PALETTE_ATTRIBUTE)).toBe('sakura');
    expect(env.localStorage.setItem).toHaveBeenCalledWith(SITE_PALETTE_STORAGE_KEY, 'sakura');
    expect(env.win.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(env.win.dispatchEvent.mock.calls[0][0].type).toBe(SITE_PALETTE_CHANGE_EVENT);
  });

  it('writeSitePalette(plaza) removes the attribute and the stored value', () => {
    const env = setup({ stored: 'clouds' });
    env.attrs.set(SITE_PALETTE_ATTRIBUTE, 'clouds');
    writeSitePalette('plaza');
    expect(env.attrs.has(SITE_PALETTE_ATTRIBUTE)).toBe(false);
    expect(env.localStorage.removeItem).toHaveBeenCalledWith(SITE_PALETTE_STORAGE_KEY);
    expect(env.localStorage.setItem).not.toHaveBeenCalled();
    expect(env.store.has(SITE_PALETTE_STORAGE_KEY)).toBe(false);
  });

  it('still applies for this page view when storage throws', () => {
    const env = setup({ setItemThrows: true });
    expect(() => writeSitePalette('mountain')).not.toThrow();
    expect(env.attrs.get(SITE_PALETTE_ATTRIBUTE)).toBe('mountain');
    expect(env.win.dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('applySitePalette never sets data-theme', () => {
    const env = setup();
    applySitePalette('sakura');
    applySitePalette('plaza');
    for (const call of env.documentElement.setAttribute.mock.calls) expect(call[0]).toBe(SITE_PALETTE_ATTRIBUTE);
    for (const call of env.documentElement.removeAttribute.mock.calls) expect(call[0]).toBe(SITE_PALETTE_ATTRIBUTE);
  });
});

describe('site palette store — reads', () => {
  it('readAppliedSitePalette: absent or invalid → plaza, else the id', () => {
    const env = setup();
    expect(readAppliedSitePalette()).toBe('plaza');
    env.attrs.set(SITE_PALETTE_ATTRIBUTE, 'bogus');
    expect(readAppliedSitePalette()).toBe('plaza');
    env.attrs.set(SITE_PALETTE_ATTRIBUTE, 'mountain');
    expect(readAppliedSitePalette()).toBe('mountain');
  });

  it('readStoredSitePalette validates and never deletes', () => {
    let env = setup({ stored: 'bogus' });
    expect(readStoredSitePalette()).toBeNull();
    expect(env.localStorage.removeItem).not.toHaveBeenCalled();
    expect(env.store.get(SITE_PALETTE_STORAGE_KEY)).toBe('bogus');

    env = setup({ stored: 'sakura' });
    expect(readStoredSitePalette()).toBe('sakura');

    env = setup();
    expect(readStoredSitePalette()).toBeNull();

    env = setup({ stored: 'sakura', getItemThrows: true });
    expect(readStoredSitePalette()).toBeNull();
    expect(env.localStorage.removeItem).not.toHaveBeenCalled();
  });

  it('clearInvalidStoredSitePalette removes junk and keeps a valid pick', () => {
    let env = setup({ stored: 'bogus' });
    clearInvalidStoredSitePalette();
    expect(env.localStorage.removeItem).toHaveBeenCalledWith(SITE_PALETTE_STORAGE_KEY);
    expect(env.store.has(SITE_PALETTE_STORAGE_KEY)).toBe(false);

    env = setup({ stored: 'clouds' });
    clearInvalidStoredSitePalette();
    expect(env.localStorage.removeItem).not.toHaveBeenCalled();
    expect(env.store.get(SITE_PALETTE_STORAGE_KEY)).toBe('clouds');

    env = setup({ getItemThrows: true });
    expect(() => clearInvalidStoredSitePalette()).not.toThrow();
  });
});

describe('site palette store — subscribe', () => {
  it("another tab's pick applies and notifies", () => {
    const env = setup();
    const onChange = vi.fn();
    subscribeSitePalette(onChange);
    env.fireStorage(SITE_PALETTE_STORAGE_KEY, 'clouds');
    expect(env.attrs.get(SITE_PALETTE_ATTRIBUTE)).toBe('clouds');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it.each([['bogus'], [null]])('another tab writing %s applies plaza', (newValue) => {
    const env = setup();
    env.attrs.set(SITE_PALETTE_ATTRIBUTE, 'sakura');
    const onChange = vi.fn();
    subscribeSitePalette(onChange);
    env.fireStorage(SITE_PALETTE_STORAGE_KEY, newValue);
    expect(env.attrs.has(SITE_PALETTE_ATTRIBUTE)).toBe(false);
    expect(env.documentElement.setAttribute).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ignores storage events for other keys', () => {
    const env = setup();
    const onChange = vi.fn();
    subscribeSitePalette(onChange);
    env.fireStorage('poketools:world-override', 'clouds');
    expect(env.documentElement.setAttribute).not.toHaveBeenCalled();
    expect(env.documentElement.removeAttribute).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hears this tab's writes", () => {
    setup();
    const onChange = vi.fn();
    subscribeSitePalette(onChange);
    writeSitePalette('mountain');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes both listeners', () => {
    const env = setup();
    const onChange = vi.fn();
    const unsubscribe = subscribeSitePalette(onChange);
    expect(env.listenerCount()).toBe(2);
    unsubscribe();
    expect(env.listenerCount()).toBe(0);
    env.fireStorage(SITE_PALETTE_STORAGE_KEY, 'clouds');
    writeSitePalette('sakura');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('site palette store — withDefaultSitePalette (stored social image)', () => {
  it('runs the task in plaza, then restores the palette without persisting or notifying', async () => {
    const env = setup({ stored: 'mountain' });
    env.attrs.set(SITE_PALETTE_ATTRIBUTE, 'mountain');
    let during: string | null | undefined;
    const result = await withDefaultSitePalette(async () => {
      during = env.attrs.get(SITE_PALETTE_ATTRIBUTE) ?? null;
      return 'png';
    });
    expect(result).toBe('png');
    expect(during).toBeNull();
    expect(env.attrs.get(SITE_PALETTE_ATTRIBUTE)).toBe('mountain');
    expect(env.localStorage.setItem).not.toHaveBeenCalled();
    expect(env.localStorage.removeItem).not.toHaveBeenCalled();
    expect(env.win.dispatchEvent).not.toHaveBeenCalled();
    expect(env.listenerCount()).toBe(0);
  });

  it('restores the palette when the task throws', async () => {
    const env = setup();
    env.attrs.set(SITE_PALETTE_ATTRIBUTE, 'clouds');
    await expect(
      withDefaultSitePalette(async () => {
        throw new Error('capture failed');
      }),
    ).rejects.toThrow('capture failed');
    expect(env.attrs.get(SITE_PALETTE_ATTRIBUTE)).toBe('clouds');
    expect(env.listenerCount()).toBe(0);
  });

  it('plaza viewers: touches nothing', async () => {
    const env = setup();
    await withDefaultSitePalette(async () => undefined);
    expect(env.documentElement.setAttribute).not.toHaveBeenCalled();
    expect(env.documentElement.removeAttribute).not.toHaveBeenCalled();
    expect(env.listenerCount()).toBe(0);
  });

  it('a pick made during the task wins (this tab)', async () => {
    const env = setup();
    env.attrs.set(SITE_PALETTE_ATTRIBUTE, 'sakura');
    await withDefaultSitePalette(async () => {
      writeSitePalette('plaza');
    });
    expect(env.attrs.has(SITE_PALETTE_ATTRIBUTE)).toBe(false);
  });

  it('a pick made during the task wins (another tab)', async () => {
    const env = setup();
    env.attrs.set(SITE_PALETTE_ATTRIBUTE, 'sakura');
    await withDefaultSitePalette(async () => {
      env.fireStorage(SITE_PALETTE_STORAGE_KEY, null);
    });
    expect(env.attrs.has(SITE_PALETTE_ATTRIBUTE)).toBe(false);
  });
});

describe('site palette store — guard (React strips <html> attributes)', () => {
  /** A MutationObserver stub whose callback the test fires by hand. */
  function stubObserver() {
    const observers: Array<{ callback: () => void; observed: unknown; disconnected: boolean }> = [];
    class FakeObserver {
      private entry: { callback: () => void; observed: unknown; disconnected: boolean };
      constructor(callback: () => void) {
        this.entry = { callback, observed: null, disconnected: false };
        observers.push(this.entry);
      }
      observe(target: unknown) {
        this.entry.observed = target;
      }
      disconnect() {
        this.entry.disconnected = true;
      }
    }
    vi.stubGlobal('MutationObserver', FakeObserver);
    return { observers, fire: () => observers.filter((o) => !o.disconnected).forEach((o) => o.callback()) };
  }

  it('re-applies the stored palette after something removed the attribute', () => {
    const env = setup({ stored: 'mountain' });
    vi.stubGlobal('location', { pathname: '/' });
    env.attrs.set(SITE_PALETTE_ATTRIBUTE, 'mountain');
    const obs = stubObserver();
    const stop = watchSitePaletteAttribute();
    env.attrs.delete(SITE_PALETTE_ATTRIBUTE); // React releasing the <html> singleton
    obs.fire();
    expect(env.attrs.get(SITE_PALETTE_ATTRIBUTE)).toBe('mountain');
    stop();
    expect(obs.observers.every((o) => o.disconnected)).toBe(true);
    expect(env.listenerCount()).toBe(0);
  });

  it('applies the stored palette on start when the attribute is already gone', () => {
    const env = setup({ stored: 'clouds' });
    vi.stubGlobal('location', { pathname: '/leagues' });
    stubObserver();
    const stop = watchSitePaletteAttribute();
    expect(env.attrs.get(SITE_PALETTE_ATTRIBUTE)).toBe('clouds');
    stop();
  });

  it('keeps a pick that storage could not persist', () => {
    const env = setup({ setItemThrows: true });
    vi.stubGlobal('location', { pathname: '/' });
    const obs = stubObserver();
    const stop = watchSitePaletteAttribute();
    writeSitePalette('sakura');
    obs.fire();
    expect(env.attrs.get(SITE_PALETTE_ATTRIBUTE)).toBe('sakura');
    env.attrs.delete(SITE_PALETTE_ATTRIBUTE);
    obs.fire();
    expect(env.attrs.get(SITE_PALETTE_ATTRIBUTE)).toBe('sakura');
    stop();
  });

  it('follows another tab: plaza there removes the palette here and it stays removed', () => {
    const env = setup({ stored: 'sakura' });
    vi.stubGlobal('location', { pathname: '/' });
    const obs = stubObserver();
    const stop = watchSitePaletteAttribute();
    expect(env.attrs.get(SITE_PALETTE_ATTRIBUTE)).toBe('sakura');
    env.store.delete(SITE_PALETTE_STORAGE_KEY);
    env.fireStorage(SITE_PALETTE_STORAGE_KEY, null);
    obs.fire();
    expect(env.attrs.has(SITE_PALETTE_ATTRIBUTE)).toBe(false);
    stop();
  });

  it('never applies on /broadcast pages', () => {
    const env = setup({ stored: 'mountain' });
    vi.stubGlobal('location', { pathname: '/broadcast/overlay' });
    stubObserver();
    expect(reconcileSitePalette()).toBe(false);
    expect(env.attrs.has(SITE_PALETTE_ATTRIBUTE)).toBe(false);
  });

  it('does not undo withDefaultSitePalette while its task runs, and restores after', async () => {
    const env = setup({ stored: 'sakura' });
    vi.stubGlobal('location', { pathname: '/' });
    env.attrs.set(SITE_PALETTE_ATTRIBUTE, 'sakura');
    const obs = stubObserver();
    const stop = watchSitePaletteAttribute();
    let during: string | undefined = 'unset';
    await withDefaultSitePalette(async () => {
      obs.fire();
      during = env.attrs.get(SITE_PALETTE_ATTRIBUTE);
    });
    expect(during).toBeUndefined();
    expect(env.attrs.get(SITE_PALETTE_ATTRIBUTE)).toBe('sakura');
    stop();
  });
});
