/**
 * SuperadminGuard: the live view gate (D37) for pages only the superadmin may open. Only the live
 * `isSuperadmin` flag opens the page; a site admin who is not the superadmin is denied.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LiveAccess } from '@/lib/auth/helpers';

const auth = vi.hoisted(() => ({ getLiveAccess: vi.fn<() => Promise<LiveAccess | null>>() }));
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
);
const cookieJar = vi.hoisted(() => ({ locale: undefined as string | undefined }));

vi.mock('@/lib/auth/helpers', () => auth);
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'plc_locale' && cookieJar.locale !== undefined ? { name, value: cookieJar.locale } : undefined,
  }),
}));

import SuperadminGuard from '../SuperadminGuard';

function access(flags: Partial<Omit<LiveAccess, 'player'>>): LiveAccess {
  return { player: null, isSiteAdmin: false, isAnyAdmin: false, isCreator: false, isSuperadmin: false, ...flags };
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.locale = undefined;
});

describe('SuperadminGuard', () => {
  it('sends a signed-out visitor to sign-in', async () => {
    auth.getLiveAccess.mockResolvedValue(null);
    await expect(SuperadminGuard({ children: 'SECRET' })).rejects.toThrow('redirect:/api/auth/signin');
  });

  it('denies a non-admin', async () => {
    auth.getLiveAccess.mockResolvedValue(access({}));
    const html = renderToStaticMarkup(await SuperadminGuard({ children: 'SECRET' }));
    expect(html).toContain('Access Denied');
    expect(html).not.toContain('SECRET');
  });

  it('denies a site admin who is not the superadmin', async () => {
    auth.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true, isCreator: true }));
    const html = renderToStaticMarkup(await SuperadminGuard({ children: 'SECRET' }));
    expect(html).toContain('Only the superadmin can view this page.');
    expect(html).not.toContain('SECRET');
  });

  it('denies in German when the viewer reads German', async () => {
    cookieJar.locale = 'de';
    auth.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    const html = renderToStaticMarkup(await SuperadminGuard({ children: 'SECRET' }));
    expect(html).toContain('Kein Zugriff');
    expect(html).toContain('Diese Seite kann nur der Superadmin öffnen.');
    expect(html).not.toContain('SECRET');
  });

  it('renders for the live superadmin', async () => {
    auth.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true, isSuperadmin: true }));
    expect(renderToStaticMarkup(await SuperadminGuard({ children: 'SECRET' }))).toBe('SECRET');
  });

  it('fails closed when the live read fails', async () => {
    auth.getLiveAccess.mockRejectedValue(new Error('db down'));
    await expect(SuperadminGuard({ children: 'SECRET' })).rejects.toThrow('db down');
  });
});
