/**
 * The dev-only surfaces preview: the page 404s in production, every surface renders the real component over its fixtures (in
 * both languages), and the in-memory API answers the pin and recycle-bin routes while refusing every other `/api/` path
 * instead of reaching a route that reads Supabase.
 */
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/client';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/i18n/server', () => ({
  getI18nProviderProps: async () => ({ locale: 'en', dataLocale: 'en', timeZone: 'UTC', requestTime: 0 }),
}));

import SurfacesPage from '../surfaces/page';
import { createFakeSurfacesApi } from '../surfaces/fake-api';
import { DIALOG_STATES, SURFACES, TRASH_ROWS } from '../surfaces/fixtures';

const original = process.env.NODE_ENV;
const env = process.env as Record<string, string | undefined>;
afterEach(() => {
  env.NODE_ENV = original;
});

const html = (tree: ReactNode) =>
  renderToStaticMarkup(
    <I18nProvider locale="en" dataLocale="en" timeZone="UTC" requestTime={0}>
      {tree}
    </I18nProvider>,
  );

describe('the surfaces page', () => {
  it('404s in production', async () => {
    env.NODE_ENV = 'production';
    await expect(SurfacesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it.each([
    ['gallery', 'Your rulesets', 'Catalog updated'],
    ['detail', 'Where it is used', 'Compared with version 3'],
    ['pins', 'Update to version 4', 'This is the latest version.'],
    ['dialogs', 'Each button opens', 'ready-truncated'],
    ['trash', 'League trash', 'Pending rebuilds'],
    ['danger', 'Danger zone', 'Only site admins can delete a league.'],
  ] as const)('renders the %s surface from fixtures', async (surface, ...expected) => {
    env.NODE_ENV = 'development';
    const markup = html(await SurfacesPage({ searchParams: Promise.resolve({ surface }) }));
    for (const text of expected) expect(markup).toContain(text);
  });

  it('falls back to the gallery, follows ?lang= and lists every surface', async () => {
    env.NODE_ENV = 'development';
    const markup = html(await SurfacesPage({ searchParams: Promise.resolve({ surface: 'nope', lang: 'de' }) }));
    expect(markup).toContain('Deine Regelwerke');
    for (const surface of SURFACES) expect(markup).toContain(`surface=${surface}`);
  });

  it('has one dialog state per answer of the impact count', () => {
    expect(DIALOG_STATES).toEqual(['loading', 'ready-some', 'ready-all-valid', 'ready-none', 'ready-truncated', 'ready-many', 'failed']);
  });
});

describe('the in-memory API', () => {
  const passthrough = vi.fn(async () => new Response('real'));
  const fake = createFakeSurfacesApi(passthrough as unknown as typeof fetch);
  const post = (path: string, body: unknown = {}) => fake(path, { method: 'POST', body: JSON.stringify(body) });

  it('leaves everything outside /api/ to the real fetch', async () => {
    expect(await (await fake('/_next/static/x.js')).text()).toBe('real');
    expect(passthrough).toHaveBeenCalledTimes(1);
  });

  it('answers the session check as signed out and refuses every other route', async () => {
    expect(await (await fake('/api/auth/session')).json()).toBeNull();
    const refused = await fake('/api/seasons/abc', { method: 'DELETE' });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ success: false, code: 'forbidden' });
    expect((await fake('/api/rulesets')).status).toBe(403);
  });

  it('counts the teams a pin move would invalidate, and moves a pin', async () => {
    const impact = await post('/api/ruleset-definitions/d1/pins/impact', { to_version_no: 4, targets: [] });
    expect(await impact.json()).toMatchObject({ success: true, data: { version_no: 4, would_break: 5 } });

    const moved = await post('/api/ruleset-definitions/d1/pins', { to_version_no: 4, targets: [{ kind: 'season', id: 's1' }] });
    expect(await moved.json()).toMatchObject({ success: true, data: { version_no: 4, moved: [{ kind: 'season', id: 's1' }] } });

    const refused = await post('/api/ruleset-definitions/d1/pins', { to_version_no: 99, targets: [] });
    expect(refused.status).toBe(409);
  });

  it('restores and rebuilds trashed leagues, and refuses the one fixture that cannot be restored', async () => {
    const restored = await post('/api/admin/league-trash/trash-warn/restore');
    const body = (await restored.json()) as { data: { warnings: unknown[]; paused_pools: number } };
    expect(body.data.paused_pools).toBe(2);
    expect(body.data.warnings).toHaveLength(3);

    expect(await (await post('/api/admin/league-trash/trash-ok/restore')).json()).toMatchObject({ data: { warnings: [] } });
    expect(await (await post('/api/admin/league-trash/trash-pending/rebuild')).json()).toMatchObject({ data: { kind: 'delete' } });
    expect(await (await post('/api/admin/league-trash/trash-old/rebuild')).json()).toMatchObject({ data: { kind: 'restore' } });
    expect((await post('/api/admin/league-trash/trash-fail/restore')).status).toBe(403);
    expect(TRASH_ROWS.map((row) => row.id)).toContain('trash-fail');
  });
});
