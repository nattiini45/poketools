import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearDescriptionDraft,
  descriptionDraftKey,
  descriptionEditSeed,
  hasRestorableDraft,
  readDescriptionDraft,
  resetDescriptionDraftWarnings,
  subscribeDescriptionDrafts,
  writeDescriptionDraft,
} from '../description-draft';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

function stubWindow(sessionStorage: Storage | (() => never)) {
  const win = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as Record<string, unknown>;
  Object.defineProperty(win, 'sessionStorage', {
    get: typeof sessionStorage === 'function' ? sessionStorage : () => sessionStorage,
  });
  vi.stubGlobal('window', win);
  return win;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const KEY = descriptionDraftKey('season', 's1');

describe('description draft storage', () => {
  it('keys the draft by resource type and id', () => {
    expect(KEY).toBe('poketools:description-draft:v1:season:s1');
    expect(descriptionDraftKey('tournament', 's1')).not.toBe(KEY);
  });

  it('writes, reads and clears the draft, notifying subscribers each time', () => {
    stubWindow(memoryStorage());
    const onChange = vi.fn();
    const unsubscribe = subscribeDescriptionDrafts(onChange);
    expect(readDescriptionDraft(KEY)).toBeNull();
    expect(writeDescriptionDraft(KEY, 'Unsaved rules')).toBe(true);
    expect(readDescriptionDraft(KEY)).toBe('Unsaved rules');
    clearDescriptionDraft(KEY);
    expect(readDescriptionDraft(KEY)).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
    writeDescriptionDraft(KEY, 'again');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('listens to other tabs through the storage event and stops on unsubscribe', () => {
    const win = stubWindow(memoryStorage());
    const unsubscribe = subscribeDescriptionDrafts(() => {});
    expect(win.addEventListener).toHaveBeenCalledWith('storage', expect.any(Function));
    unsubscribe();
    expect(win.removeEventListener).toHaveBeenCalledWith('storage', expect.any(Function));
  });

  it('without a window (server render) there is no draft and nothing throws', () => {
    expect(readDescriptionDraft(KEY)).toBeNull();
    expect(writeDescriptionDraft(KEY, 'x')).toBe(false);
    expect(() => clearDescriptionDraft(KEY)).not.toThrow();
  });

  it('blocked storage (the accessor throws) reads as no draft and a failed write', () => {
    stubWindow(() => {
      throw new Error('SecurityError');
    });
    expect(readDescriptionDraft(KEY)).toBeNull();
    expect(writeDescriptionDraft(KEY, 'x')).toBe(false);
    expect(() => clearDescriptionDraft(KEY)).not.toThrow();
  });

  it('a storage failure is logged once per kind of access, never silently', () => {
    resetDescriptionDraftWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubWindow(() => {
      throw new Error('SecurityError');
    });
    readDescriptionDraft(KEY);
    readDescriptionDraft(KEY);
    writeDescriptionDraft(KEY, 'x');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('sessionStorage open failed');
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    stubWindow(storage);
    writeDescriptionDraft(KEY, 'x');
    writeDescriptionDraft(KEY, 'y');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1][0])).toContain('sessionStorage write failed');
    warn.mockRestore();
  });

  it('"Edit" opens an offered draft, else the saved text', () => {
    expect(descriptionEditSeed('Half-written', 'Saved')).toBe('Half-written');
    expect(descriptionEditSeed('Saved', 'Saved')).toBe('Saved');
    expect(descriptionEditSeed(null, 'Saved')).toBe('Saved');
  });

  it('a full storage (setItem throws) reports a failed write', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    stubWindow(storage);
    expect(writeDescriptionDraft(KEY, 'x')).toBe(false);
  });

  it('offers a draft back only when it differs from the saved text', () => {
    expect(hasRestorableDraft(null, 'Saved')).toBe(false);
    expect(hasRestorableDraft('Saved', 'Saved')).toBe(false);
    expect(hasRestorableDraft('Changed', 'Saved')).toBe(true);
    expect(hasRestorableDraft('', 'Saved')).toBe(true);
  });
});
