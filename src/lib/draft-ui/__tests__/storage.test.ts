import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hasNotified,
  isNotifyOptedIn,
  markNotified,
  notifiedKey,
  pruneNotified,
  readPinned,
  readPrefs,
  setNotifyOptIn,
  storageGet,
  storageSet,
  writePinned,
  writePrefs,
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
    expect(pruneNotified(Date.now())).toBe(0);
  });

  it('survives storage that throws', () => {
    const broken = new MemoryStorage();
    broken.getItem = () => {
      throw new Error('SecurityError');
    };
    broken.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    installWindow(broken);
    expect(storageGet('local', 'draft:prefs:v1')).toBeNull();
    expect(writePrefs({ sort: 'price' })).toBe(false);
    expect(isNotifyOptedIn('pool-1')).toBe(false);
  });

  it('round-trips prefs as JSON and ignores garbage', () => {
    const local = new MemoryStorage();
    installWindow(local);
    expect(writePrefs({ stageMode: 'same_stage', showDrafted: true })).toBe(true);
    expect(readPrefs()).toEqual({ stageMode: 'same_stage', showDrafted: true });
    local.setItem('draft:prefs:v1', '{not json');
    expect(readPrefs()).toBeNull();
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

  it('stores the notification opt-in per pool', () => {
    installWindow(new MemoryStorage());
    expect(isNotifyOptedIn('pool-1')).toBe(false);
    setNotifyOptIn('pool-1', true);
    expect(isNotifyOptedIn('pool-1')).toBe(true);
    setNotifyOptIn('pool-1', false);
    expect(isNotifyOptedIn('pool-1')).toBe(false);
  });

  it('dedupes notifications and prunes entries older than three days', () => {
    const local = new MemoryStorage();
    installWindow(local);
    const now = Date.parse('2026-10-09T12:00:00.000Z');
    markNotified('pool-1', 'slot-1', 'turn', now - 4 * 24 * 3600e3);
    markNotified('pool-1', 'slot-2', 'remind-1h', now - 3600e3);
    local.setItem('draft:notified:pool-1:slot-3:turn', 'garbage');
    local.setItem('draft:prefs:v1', '{}');
    expect(notifiedKey('pool-1', 'slot-2', 'remind-1h')).toBe('draft:notified:pool-1:slot-2:remind-1h');
    expect(hasNotified('pool-1', 'slot-1', 'turn')).toBe(true);

    expect(pruneNotified(now)).toBe(2);
    expect(hasNotified('pool-1', 'slot-1', 'turn')).toBe(false);
    expect(hasNotified('pool-1', 'slot-2', 'remind-1h')).toBe(true);
    expect(local.getItem('draft:prefs:v1')).toBe('{}');
  });
});
