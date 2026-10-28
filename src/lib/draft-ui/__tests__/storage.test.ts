import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearLegacyNotifyKeys,
  readPinned,
  readPrefs,
  storageGet,
  storageSet,
  updatePrefs,
  writePinned,
} from '@/lib/draft-ui/storage';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
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
    this.map.set(key, String(value));
  }
}

function installWindow(local: Storage, session: Storage = new MemoryStorage()) {
  vi.stubGlobal('window', { localStorage: local, sessionStorage: session });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('draft-ui storage', () => {
  it('works without a window (server render)', () => {
    expect(storageGet('local', 'draft:prefs:v1')).toBeNull();
    expect(storageSet('local', 'draft:prefs:v1', '{}')).toBe(false);
    expect(readPinned('pool-1')).toBeNull();
    expect(clearLegacyNotifyKeys()).toBe(0);
  });

  it('survives storage that throws', () => {
    const broken = new MemoryStorage();
    broken.getItem = () => {
      throw new Error('SecurityError');
    };
    broken.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    broken.removeItem = () => {
      throw new Error('SecurityError');
    };
    installWindow(broken);
    expect(storageGet('local', 'draft:prefs:v1')).toBeNull();
    expect(updatePrefs({ sort: 'price' })).toBe(false);
    expect(clearLegacyNotifyKeys()).toBe(0);
  });

  it('round-trips prefs as JSON and ignores garbage', () => {
    const local = new MemoryStorage();
    installWindow(local);
    expect(updatePrefs({ stageMode: 'same_stage', showDrafted: true })).toBe(true);
    expect(readPrefs()).toEqual({ stageMode: 'same_stage', showDrafted: true });
    local.setItem('draft:prefs:v1', '{not json');
    expect(readPrefs()).toBeNull();
  });

  it('merges a prefs patch into the stored blob and replaces a corrupt one', () => {
    const local = new MemoryStorage();
    installWindow(local);
    updatePrefs({ sort: 'spe', sortStage: 'base' });
    updatePrefs({ weaknessStage: 'final', sort: 'bst' });
    expect(readPrefs()).toEqual({ sort: 'bst', sortStage: 'base', weaknessStage: 'final' });
    local.setItem('draft:prefs:v1', '[1,2]');
    updatePrefs({ sort: 'alpha' });
    expect(readPrefs()).toEqual({ sort: 'alpha' });
  });

  it('keeps the pinned line per pool in sessionStorage', () => {
    const session = new MemoryStorage();
    installWindow(new MemoryStorage(), session);
    writePinned('pool-1', 'gastly--gengar');
    expect(session.getItem('draft:pinned:pool-1')).toBe('gastly--gengar');
    expect(readPinned('pool-1')).toBe('gastly--gengar');
    expect(readPinned('pool-2')).toBeNull();
    writePinned('pool-1', null);
    expect(readPinned('pool-1')).toBeNull();
  });

  it('removes the keys the old local turn alerts left behind, and nothing else', () => {
    const local = new MemoryStorage();
    installWindow(local);
    local.setItem('draft:notify:pool-1', '1');
    local.setItem('draft:notify:pool-2', '0');
    local.setItem('draft:notified:pool-1:slot-1:turn', '1760000000000');
    local.setItem('draft:notified:pool-1:slot-2:remind-1h', 'garbage');
    local.setItem('draft:prefs:v1', '{}');
    local.setItem('push:locale:v1', 'de');

    expect(clearLegacyNotifyKeys()).toBe(4);
    expect(local.getItem('draft:notify:pool-1')).toBeNull();
    expect(local.getItem('draft:notified:pool-1:slot-1:turn')).toBeNull();
    expect(local.getItem('draft:prefs:v1')).toBe('{}');
    expect(local.getItem('push:locale:v1')).toBe('de');
    expect(clearLegacyNotifyKeys()).toBe(0);
  });
});
