import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let pathname: string | null = '/';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));
vi.mock('@/components/shared/PwaRegistrar', () => ({ default: () => <i data-extra="pwa" /> }));
vi.mock('@/components/shared/SitePaletteGuard', () => ({ default: () => <i data-extra="palette" /> }));
vi.mock('@vercel/analytics/next', () => ({ Analytics: () => <i data-extra="analytics" /> }));

import SiteExtras, { isBroadcastPath } from '../SiteExtras';

describe('isBroadcastPath', () => {
  it.each([
    ['/broadcast', true],
    ['/broadcast/match/1/live', true],
    ['/broadcasts', false],
    ['/dashboard/broadcast', false],
    ['/leagues', false],
    [null, false],
  ])('%s -> %s', (value, expected) => {
    expect(isBroadcastPath(value)).toBe(expected);
  });
});

describe('SiteExtras', () => {
  beforeEach(() => {
    pathname = '/';
  });

  it('renders the registrar, palette guard and analytics on site pages', () => {
    pathname = '/leagues';
    const html = renderToStaticMarkup(<SiteExtras analytics />);
    expect(html).toContain('data-extra="pwa"');
    expect(html).toContain('data-extra="palette"');
    expect(html).toContain('data-extra="analytics"');
  });

  it('leaves analytics out when the deployment is not on Vercel', () => {
    const html = renderToStaticMarkup(<SiteExtras analytics={false} />);
    expect(html).toContain('data-extra="pwa"');
    expect(html).not.toContain('data-extra="analytics"');
  });

  it('renders none of them on an overlay', () => {
    pathname = '/broadcast/match/abc/live';
    expect(renderToStaticMarkup(<SiteExtras analytics />)).toBe('');
  });
});
