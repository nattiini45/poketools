/**
 * players.sprite_style reads and writes (docs/pkmn.md, "Sprite styles"):
 * narrow select, a missing row reads as the default, an impossible stored value
 * and query errors throw, a write that updates no row throws.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  read: { data: null as unknown, error: null as unknown },
  write: { data: null as unknown, error: null as unknown },
  calls: [] as Array<[string, ...unknown[]]>,
}));

vi.mock('@/lib/supabase/client', () => {
  const chain = (result: () => unknown) => {
    const q: Record<string, unknown> = {};
    for (const name of ['select', 'update', 'eq']) {
      q[name] = (...args: unknown[]) => {
        db.calls.push([name, ...args]);
        if (name === 'select' && db.calls.some((c) => c[0] === 'update')) return Promise.resolve(result());
        return q;
      };
    }
    q.maybeSingle = () => Promise.resolve(result());
    return q;
  };
  return {
    supabase: {
      from: (table: string) => {
        db.calls.push(['from', table]);
        return chain(() => (db.calls.some((c) => c[0] === 'update') ? db.write : db.read));
      },
    },
  };
});

import { getPlayerSpriteStyle, setPlayerSpriteStyle } from '../player-sprite-style';

beforeEach(() => {
  db.calls = [];
  db.read = { data: null, error: null };
  db.write = { data: [{ id: 'p1' }], error: null };
});

describe('getPlayerSpriteStyle', () => {
  it('reads only the sprite_style column of the player', async () => {
    db.read = { data: { sprite_style: 'pixel' }, error: null };
    await expect(getPlayerSpriteStyle('p1')).resolves.toBe('pixel');
    expect(db.calls).toEqual([
      ['from', 'players'],
      ['select', 'sprite_style'],
      ['eq', 'id', 'p1'],
    ]);
  });

  it('a missing row reads as the default site', async () => {
    await expect(getPlayerSpriteStyle('gone')).resolves.toBe('site');
  });

  it('throws on a stored value outside the CHECK list and on query errors', async () => {
    db.read = { data: { sprite_style: 'gif' }, error: null };
    await expect(getPlayerSpriteStyle('p1')).rejects.toThrow(/unknown value/);
    const pgError = { message: 'boom', code: '57014' };
    db.read = { data: null, error: pgError };
    await expect(getPlayerSpriteStyle('p1')).rejects.toBe(pgError);
  });
});

describe('setPlayerSpriteStyle', () => {
  it('updates the own row and confirms it', async () => {
    await expect(setPlayerSpriteStyle('p1', 'animated')).resolves.toBeUndefined();
    expect(db.calls).toEqual([
      ['from', 'players'],
      ['update', { sprite_style: 'animated' }],
      ['eq', 'id', 'p1'],
      ['select', 'id'],
    ]);
  });

  it('throws when no row was updated, and rethrows query errors', async () => {
    db.write = { data: [], error: null };
    await expect(setPlayerSpriteStyle('gone', 'home')).rejects.toThrow(/no players row updated/);
    const pgError = { message: 'denied', code: '42501' };
    db.write = { data: null, error: pgError };
    await expect(setPlayerSpriteStyle('p1', 'home')).rejects.toBe(pgError);
  });
});
