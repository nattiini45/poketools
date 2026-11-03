import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

const headerJar = vi.hoisted(() => ({ nonce: null as string | null }));

vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name === 'x-nonce' ? headerJar.nonce : null) }),
}));
vi.mock('next/font/local', () => ({ default: () => ({ variable: 'font-var' }) }));
vi.mock('@/i18n/server', () => ({
  getI18nProviderProps: async () => ({ locale: 'en', dataLocale: 'en', timeZone: 'UTC', pkmnTerms: 'follow' }),
  getT: async () => (key: string) => key,
}));
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
vi.mock('../globals.css', () => ({}));

import RootLayout from '../layout';
import { SITE_PALETTE_PREPAINT_SCRIPT } from '@/lib/design/site-palette-script';

beforeEach(() => {
  headerJar.nonce = null;
});

describe('RootLayout inline scripts (#37)', () => {
  it('stamps the proxy nonce on the palette prepaint script and the next-themes script', async () => {
    headerJar.nonce = 'bm9uY2UtMTIz';
    const html = renderToStaticMarkup(await RootLayout({ children: 'page' }));
    const scripts = html.match(/<script[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThanOrEqual(2);
    for (const tag of scripts) expect(tag, tag).toContain('nonce="bm9uY2UtMTIz"');
    expect(html).toContain(SITE_PALETTE_PREPAINT_SCRIPT.slice(0, 40));
  });

  it('still renders when the proxy did not run (no header)', async () => {
    const html = renderToStaticMarkup(await RootLayout({ children: 'page' }));
    expect(html).toContain('page');
  });
});
