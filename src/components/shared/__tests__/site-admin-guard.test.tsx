/**
 * SiteAdminGuard and ResourceForbidden: live view gates (D37). Only the live
 * `isSiteAdmin` flag opens a site-admin page; a resource admin is denied.
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

import SiteAdminGuard from '../SiteAdminGuard';
import ResourceForbidden from '../ResourceForbidden';

function access(flags: Partial<Omit<LiveAccess, 'player'>>): LiveAccess {
  return { player: null, isSiteAdmin: false, isAnyAdmin: false, isCreator: false, ...flags };
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.locale = undefined;
});

describe('SiteAdminGuard', () => {
  it('sends a signed-out visitor to sign-in', async () => {
    auth.getLiveAccess.mockResolvedValue(null);
    await expect(SiteAdminGuard({ children: 'SECRET' })).rejects.toThrow('redirect:/api/auth/signin');
  });

  it('denies a non-admin', async () => {
    auth.getLiveAccess.mockResolvedValue(access({}));
    const html = renderToStaticMarkup(await SiteAdminGuard({ children: 'SECRET' }));
    expect(html).toContain('Access Denied');
    expect(html).not.toContain('SECRET');
  });

  it('denies a resource admin, who passes AdminGuard but is not a site admin', async () => {
    auth.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    const html = renderToStaticMarkup(await SiteAdminGuard({ children: 'SECRET' }));
    expect(html).toContain('Access Denied');
    expect(html).toContain('Only site admins can view this page.');
    expect(html).not.toContain('SECRET');
  });

  it('denies in German when the viewer reads German', async () => {
    cookieJar.locale = 'de';
    auth.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    const html = renderToStaticMarkup(await SiteAdminGuard({ children: 'SECRET' }));
    expect(html).toContain('Kein Zugriff');
    expect(html).toContain('Diese Seite können nur Site-Admins öffnen.');
  });

  it('renders for a live site admin', async () => {
    auth.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    expect(renderToStaticMarkup(await SiteAdminGuard({ children: 'SECRET' }))).toBe('SECRET');
  });

  it('fails closed when the live read fails', async () => {
    auth.getLiveAccess.mockRejectedValue(new Error('db down'));
    await expect(SiteAdminGuard({ children: 'SECRET' })).rejects.toThrow('db down');
  });
});

describe('ResourceForbidden', () => {
  it('renders the given message', async () => {
    const html = renderToStaticMarkup(await ResourceForbidden({ children: 'Only admins of this league.' }));
    expect(html).toContain('Only admins of this league.');
  });

  it('falls back to the generic text in English and German', async () => {
    expect(renderToStaticMarkup(await ResourceForbidden({}))).toContain(
      'You are not an admin of this league or tournament.',
    );
    cookieJar.locale = 'de';
    expect(renderToStaticMarkup(await ResourceForbidden({}))).toContain(
      'Du bist kein Admin dieser Liga oder dieses Turniers.',
    );
  });
});
