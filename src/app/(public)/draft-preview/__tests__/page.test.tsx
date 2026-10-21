/**
 * DF3 `/draft-preview` page: 404 in production (like `/route-preview`), the
 * query axes (scenario, world, lang/pkmn) and no Supabase on the path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({ notFound, usePathname: () => '/draft-preview' }));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    getI18nProviderProps: async () => ({ locale: 'en', dataLocale: 'en', timeZone: 'UTC', requestTime: Date.UTC(2026, 9, 11, 12) }),
    getT: async (ns: Parameters<typeof createTranslator>[0], locale: Parameters<typeof createTranslator>[1]) => createTranslator(ns, locale),
  };
});
vi.mock('@/components/world/WorldShell', () => ({
  default: function WorldShellStub({ world, children }: { world: { tokenNamespace: string }; children: ReactNode }) {
    return <div data-world-stub={world.tokenNamespace}>{children}</div>;
  },
}));
const buildIndex = vi.fn(async (listVersionId: string) => ({
  index: { v: 2 as const, listVersionId, moves: [], moveNames: [], abilities: [], abilityNames: [], lines: [] },
  warnings: [],
}));
vi.mock('@/lib/draft-finder/build-index.server', () => ({ buildDraftSearchIndex: buildIndex }));
vi.mock('../PreviewClient', () => ({
  default: function PreviewClientStub({ scenario }: { scenario: { id: string } }) {
    return <div data-preview-scenario={scenario.id} />;
  },
}));
// Any Supabase import on this path would throw here.
vi.mock('@/lib/supabase/client', () => {
  throw new Error('the draft preview must not import Supabase');
});

const { default: DraftPreviewPage } = await import('../page');

async function renderPage(query: Record<string, string>): Promise<string> {
  const el = await DraftPreviewPage({ searchParams: Promise.resolve(query) });
  return renderToStaticMarkup(el);
}

describe('/draft-preview page', () => {
  beforeEach(() => vi.stubEnv('NODE_ENV', 'development'));
  afterEach(() => vi.unstubAllEnvs());

  it('404s in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(DraftPreviewPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(buildIndex).not.toHaveBeenCalled();
  });

  it('defaults to live-my-turn in the evoliga world with the site language', async () => {
    const html = await renderPage({});
    expect(html).toContain('data-preview-scenario="live-my-turn"');
    expect(html).toContain('data-world-stub="evoliga"');
    expect(html).toContain('Draft tool preview');
  });

  it('honours scenario, world and lang; unknown values fall back', async () => {
    const html = await renderPage({ scenario: 'slow-penalty', world: 'none', lang: 'de' });
    expect(html).toContain('data-preview-scenario="slow-penalty"');
    expect(html).not.toContain('data-world-stub');
    expect(html).toContain('Draft-Tool-Vorschau');
    expect(await renderPage({ scenario: 'bogus', world: 'mars' })).toContain('data-preview-scenario="live-my-turn"');
    expect(await renderPage({ world: 'sakura' })).toContain('data-world-stub="sakura"');
  });

  it('offers a sprite-style switch (?sprites=) that keeps the other axes', async () => {
    const html = await renderPage({ scenario: 'slow-penalty', sprites: 'pixel' });
    expect(html).toContain('Pokémon sprites');
    expect(html).toContain('href="/draft-preview?scenario=slow-penalty&amp;sprites=animated"');
    const pixelChip = html.match(/<a[^>]*>Pixel<\/a>/)?.[0];
    expect(pixelChip).toContain('sprites=pixel"');
    expect(pixelChip).toContain('font-semibold');
    expect(html.match(/<a[^>]*>Animated<\/a>/)?.[0]).not.toContain('font-semibold');
    expect(html).toContain('href="/draft-preview?scenario=slow-penalty"');
    // An unknown style falls back to the browser preference (no ?sprites= in the links).
    expect(await renderPage({ sprites: 'sepia' })).not.toMatch(/sprites=sepia/);
  });

  it('labels the picker from draft/screen preview.* and drops the fixture dump', async () => {
    const en = await renderPage({ scenario: 'tokens-open' });
    expect(en).toContain('data-preview-scenario="tokens-open"');
    expect(en).toContain('Tokens: window open');
    expect(en).toContain('Admin: draft controls');
    expect(en).not.toContain('draft_kill');
    expect(en).not.toContain('<pre');
    const de = await renderPage({ scenario: 'admin-panel', lang: 'de' });
    expect(de).toContain('Admin: Draft-Steuerung');
    expect(de).toContain('wie auf der Seite eingestellt');
  });

  it('builds the search index once per server process', async () => {
    await renderPage({});
    await renderPage({ scenario: 'complete' });
    expect(buildIndex).toHaveBeenCalledTimes(1);
  });
});
