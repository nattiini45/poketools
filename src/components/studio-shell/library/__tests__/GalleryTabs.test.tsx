import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ query: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.query),
  usePathname: () => '/admin/formats',
}));

import GalleryTabs, { GalleryPanel } from '../GalleryTabs';

function render() {
  return renderToStaticMarkup(
    <GalleryTabs label="Tabs" glideId="t">
      <GalleryPanel id="yours" label="Yours">
        <p>one</p>
      </GalleryPanel>
      <GalleryPanel id="shared" label="Shared">
        <p>two</p>
      </GalleryPanel>
    </GalleryTabs>,
  );
}

function selectedTabs(html: string) {
  return [...html.matchAll(/role="tab"[^>]*aria-selected="(true|false)"[^>]*>/g)].map((m) => m[1]);
}

describe('GalleryTabs', () => {
  beforeEach(() => {
    nav.query = '';
  });

  it('selects the first tab without a tab param', () => {
    expect(selectedTabs(render())).toEqual(['true', 'false']);
  });

  it('opens the tab named by ?tab=', () => {
    nav.query = 'tab=shared';
    expect(selectedTabs(render())).toEqual(['false', 'true']);
  });

  it('falls back to the first tab for an unknown value', () => {
    nav.query = 'tab=nope';
    expect(selectedTabs(render())).toEqual(['true', 'false']);
  });
});
