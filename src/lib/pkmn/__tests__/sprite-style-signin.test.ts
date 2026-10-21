/**
 * Sign-in sync of the sprite-style cookie (docs/pkmn.md, "Sprite styles"):
 * the cookie is the server-render source of truth, so signing in writes the
 * account value into it; a brand-new account adopts the signed-out choice.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const jar = vi.hoisted(() => {
  const values = new Map<string, string>();
  const set = vi.fn((name: string, value: string, _options?: unknown) => void values.set(name, value));
  return {
    values,
    set,
    store: { get: (name: string) => (values.has(name) ? { name, value: values.get(name) } : undefined), set },
  };
});

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => jar.store) }));
vi.mock('@/lib/supabase/queries/player-sprite-style', () => ({
  getPlayerSpriteStyle: vi.fn(),
  setPlayerSpriteStyle: vi.fn(),
}));

import { getPlayerSpriteStyle, setPlayerSpriteStyle } from '@/lib/supabase/queries/player-sprite-style';
import { SPRITE_STYLE_COOKIE, SPRITE_STYLE_COOKIE_MAX_AGE } from '../sprite-styles';
import { syncSpriteStyleCookieAtSignIn } from '../sprite-style-signin.server';

const read = vi.mocked(getPlayerSpriteStyle);
const write = vi.mocked(setPlayerSpriteStyle);

beforeEach(() => {
  vi.clearAllMocks();
  jar.values.clear();
});

describe('syncSpriteStyleCookieAtSignIn', () => {
  it('an existing account wins: its value is written to the cookie (httpOnly, one year, lax)', async () => {
    jar.values.set(SPRITE_STYLE_COOKIE, 'home');
    read.mockResolvedValue('pixel');
    expect(await syncSpriteStyleCookieAtSignIn('p1', { created: false })).toBe('synced');
    expect(read).toHaveBeenCalledWith('p1');
    expect(write).not.toHaveBeenCalled();
    expect(jar.set).toHaveBeenCalledWith(
      SPRITE_STYLE_COOKIE,
      'pixel',
      expect.objectContaining({ path: '/', httpOnly: true, sameSite: 'lax', maxAge: SPRITE_STYLE_COOKIE_MAX_AGE }),
    );
  });

  it('a browser without the cookie gets the account value', async () => {
    read.mockResolvedValue('animated');
    expect(await syncSpriteStyleCookieAtSignIn('p1', { created: false })).toBe('synced');
    expect(jar.values.get(SPRITE_STYLE_COOKIE)).toBe('animated');
  });

  it('writes nothing when the cookie already matches, or both are the default', async () => {
    jar.values.set(SPRITE_STYLE_COOKIE, 'pixel');
    read.mockResolvedValue('pixel');
    expect(await syncSpriteStyleCookieAtSignIn('p1', { created: false })).toBe('unchanged');
    jar.values.clear();
    read.mockResolvedValue('site');
    expect(await syncSpriteStyleCookieAtSignIn('p1', { created: false })).toBe('unchanged');
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('an account at the default overrides a signed-out choice and a junk cookie', async () => {
    jar.values.set(SPRITE_STYLE_COOKIE, 'pixel');
    read.mockResolvedValue('site');
    expect(await syncSpriteStyleCookieAtSignIn('p1', { created: false })).toBe('synced');
    expect(jar.values.get(SPRITE_STYLE_COOKIE)).toBe('site');
    jar.values.set(SPRITE_STYLE_COOKIE, 'sepia');
    expect(await syncSpriteStyleCookieAtSignIn('p1', { created: false })).toBe('synced');
    expect(jar.values.get(SPRITE_STYLE_COOKIE)).toBe('site');
  });

  it('a player created by this sign-in adopts the signed-out choice into the account', async () => {
    jar.values.set(SPRITE_STYLE_COOKIE, 'animated');
    expect(await syncSpriteStyleCookieAtSignIn('p-new', { created: true })).toBe('adopted');
    expect(write).toHaveBeenCalledWith('p-new', 'animated');
    expect(read).not.toHaveBeenCalled();
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('a new player without a choice (or with a junk cookie) keeps the account default', async () => {
    read.mockResolvedValue('site');
    expect(await syncSpriteStyleCookieAtSignIn('p-new', { created: true })).toBe('unchanged');
    jar.values.set(SPRITE_STYLE_COOKIE, 'sepia');
    expect(await syncSpriteStyleCookieAtSignIn('p-new', { created: true })).toBe('synced');
    expect(write).not.toHaveBeenCalled();
  });

  it('rethrows a failed read or write (the jwt callback logs it; the client reconcile repairs the cookie)', async () => {
    read.mockRejectedValue(new Error('boom'));
    await expect(syncSpriteStyleCookieAtSignIn('p1', { created: false })).rejects.toThrow('boom');
    jar.values.set(SPRITE_STYLE_COOKIE, 'home');
    write.mockRejectedValue(new Error('no row'));
    await expect(syncSpriteStyleCookieAtSignIn('p-new', { created: true })).rejects.toThrow('no row');
    expect(jar.set).not.toHaveBeenCalled();
  });
});
