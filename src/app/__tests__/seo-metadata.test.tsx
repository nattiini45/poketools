/**
 * Site-wide SEO metadata: one brand suffix through the root title template, and `noindex` on every layout whose
 * pages sit behind a login or serve a viewerless overlay.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/font/local', () => ({ default: () => ({ variable: 'font-var' }) }));
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    getI18nProviderProps: async () => ({ locale: 'en', dataLocale: 'en', timeZone: 'UTC', pkmnTerms: 'follow' }),
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en'),
  };
});
vi.mock('@/i18n/client', () => ({ I18nProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/lib/pkmn/sprite-style.server', () => ({ getSpriteStylePreference: async () => 'site' }));
vi.mock('@/lib/vercel-deployment', () => ({ isVercelDeployment: () => false }));
vi.mock('@/components/shared/SessionProvider', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/ui/AppTooltipProvider', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/shared/MotionProvider', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/shared/SiteExtras', () => ({ default: () => null }));
vi.mock('@/components/shared/SpriteStyleProvider', () => ({
  SpriteStyleProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/shared/SpriteStyleAccountSync', () => ({ default: () => null }));
vi.mock('@/components/shared/NavBar', () => ({ default: () => null }));
vi.mock('@/components/shared/PageTransitionWrapper', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/shared/AdminGuard', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/admin/AdminSidebar', () => ({ default: () => null }));
vi.mock('@/components/admin/assistant/AssistantDrawer', () => ({ default: () => null }));
vi.mock('@/components/creator/CreatorNav', () => ({ default: () => null }));
vi.mock('@/lib/pack-extensions', () => ({ siteNavExtraLinks: async () => [], extensionAdminLinks: async () => [] }));
vi.mock('@/lib/auth/helpers', () => ({
  getSession: async () => null,
  getSessionPlayer: async () => null,
  getLiveAccess: async () => null,
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), usePathname: () => '/' }));
vi.mock('../globals.css', () => ({}));
vi.mock('../(public)/draft-room/trainer-creator/client', () => ({ default: () => null }));

import { generateMetadata as rootMetadata } from '../layout';
import * as publicLayout from '../(public)/layout';
import * as playerLayout from '../(player)/layout';
import * as broadcastLayout from '../(broadcast)/layout';
import * as authLayout from '../auth/layout';
import * as adminLayout from '../admin/layout';
import * as creatorLayout from '../creator/layout';
import { generateMetadata as trainerCreatorMetadata } from '../(public)/draft-room/trainer-creator/page';
import { creatorMessages } from '@/i18n/messages/creator';
import { formatStudioAdminMessages } from '@/i18n/messages/format-studio/admin';
import { NOINDEX } from '@/lib/seo/robots';

describe('root metadata', () => {
  it('gives every page one brand suffix through a title template', async () => {
    const meta = await rootMetadata();
    expect(meta.title).toEqual({ default: 'PokéTools', template: '%s | PokéTools' });
  });

  it('declares the site name and a summary card for link previews', async () => {
    const meta = await rootMetadata();
    expect(meta.openGraph).toMatchObject({ siteName: 'PokéTools', type: 'website' });
    expect(meta.twitter).toMatchObject({ card: 'summary' });
  });
});

describe('title messages carry no brand of their own', () => {
  const titleKeys = (tree: Record<string, string>) => Object.entries(tree).filter(([key]) => /Title$/.test(key));

  it.each([
    ['creator', creatorMessages.en.meta, creatorMessages.de.meta],
    ['format-studio/admin', formatStudioAdminMessages.en.meta, formatStudioAdminMessages.de.meta],
  ])('%s', (_ns, en, de) => {
    for (const tree of [en, de] as Record<string, string>[]) {
      const titles = titleKeys(tree);
      expect(titles.length).toBeGreaterThan(0);
      for (const [key, value] of titles) {
        expect(value, key).not.toMatch(/Pok[eé]Tools/);
      }
    }
  });
});

describe('noindex layouts', () => {
  it.each([
    ['(player)', playerLayout],
    ['(broadcast)', broadcastLayout],
    ['auth', authLayout],
    ['admin', adminLayout],
    ['creator', creatorLayout],
  ])('%s keeps crawlers out', (_name, layout) => {
    expect((layout as { metadata?: { robots?: unknown } }).metadata?.robots).toEqual(NOINDEX);
  });

  it('(public) stays indexable', () => {
    expect((publicLayout as { metadata?: unknown }).metadata).toBeUndefined();
  });
});

describe('viewerless public pages', () => {
  it('keeps the trainer creator out of the index', async () => {
    expect(await trainerCreatorMetadata()).toEqual({ title: 'Trainer Creator', robots: NOINDEX });
  });
});
