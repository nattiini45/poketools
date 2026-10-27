import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPrefs, updatePrefs } from '@/lib/draft-ui/storage';
import { readWeaknessStage, storeWeaknessStage, subscribeWeaknessStage } from '../hooks/use-weakness-stage';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  readonly writes: string[] = [];
  refuse = false;
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    if (this.refuse) throw new Error('quota');
    this.writes.push(key);
    this.map.set(key, String(value));
  }
}

function installWindow(local: Storage) {
  const storageListeners = new Set<() => void>();
  vi.stubGlobal('window', {
    localStorage: local,
    sessionStorage: new MemoryStorage(),
    addEventListener: (_: string, l: () => void) => storageListeners.add(l),
    removeEventListener: (_: string, l: () => void) => storageListeners.delete(l),
  });
  return storageListeners;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('weakness stage store', () => {
  it('defaults to the final stage with nothing stored', () => {
    installWindow(new MemoryStorage());
    expect(readWeaknessStage()).toBe('final');
  });

  it('reads the stored stage and ignores a malformed one', () => {
    installWindow(new MemoryStorage());
    updatePrefs({ weaknessStage: 'base' });
    expect(readWeaknessStage()).toBe('base');
    updatePrefs({ weaknessStage: 'middle' });
    expect(readWeaknessStage()).toBe('final');
  });

  it('stores a choice next to the finder preferences and tells subscribers', () => {
    installWindow(new MemoryStorage());
    updatePrefs({ sort: 'bst' });
    const listener = vi.fn();
    const unsubscribe = subscribeWeaknessStage(listener);
    storeWeaknessStage('base');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(readWeaknessStage()).toBe('base');
    expect(readPrefs()).toEqual({ sort: 'bst', weaknessStage: 'base' });
    unsubscribe();
    storeWeaknessStage('final');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps a choice for the page view when storage refuses the write, until a write succeeds', () => {
    const local = new MemoryStorage();
    installWindow(local);
    local.refuse = true;
    storeWeaknessStage('base');
    expect(readWeaknessStage()).toBe('base');
    local.refuse = false;
    storeWeaknessStage('final');
    expect(readWeaknessStage()).toBe('final');
    expect(readPrefs()).toEqual({ weaknessStage: 'final' });
  });

  it('follows storage events of other tabs', () => {
    const listeners = installWindow(new MemoryStorage());
    const listener = vi.fn();
    subscribeWeaknessStage(listener);
    expect(listeners.has(listener)).toBe(true);
  });
});
