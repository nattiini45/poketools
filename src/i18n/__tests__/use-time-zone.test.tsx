/**
 * Viewerless output (OBS overlays, the stored social image) renders in the
 * league zone on the client too: a nested provider with `pinTimeZone` keeps
 * its zone after hydration, while the unpinned root provider still switches
 * to the browser zone (rule T1).
 *
 * The browser zone is America/New_York (process TZ, set before any import).
 * `useSyncExternalStore` is mocked to the client snapshot so a static render
 * shows what the hydrated client shows; `mode.server` flips back to the
 * server snapshot.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mode = vi.hoisted(() => {
  process.env.TZ = 'America/New_York';
  return { server: false };
});

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useSyncExternalStore: <T,>(
      _subscribe: (cb: () => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T => (mode.server && getServerSnapshot ? getServerSnapshot() : getSnapshot()),
  };
});

import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider, useFormatter, useTimeZone } from '../client';
import { LocalTime } from '../LocalTime';
import { LEAGUE_TIME_ZONE } from '../config';
import { overlayI18nProps } from '@/lib/broadcast/overlay-locale';

vi.mock('server-only', () => ({}));

// 01:30 on 11 Oct in Berlin (CEST) = 19:30 on 10 Oct in New York.
const MATCH_AT = '2026-10-10T23:30:00.000Z';

function Probe() {
  const zone = useTimeZone();
  const formatter = useFormatter();
  return (
    <p>
      {`${zone}|${formatter.timeZone}|`}
      <LocalTime value={MATCH_AT} preset="date" />
    </p>
  );
}

function root(children: React.ReactNode) {
  return (
    <I18nProvider locale="en" dataLocale="en" timeZone={LEAGUE_TIME_ZONE} requestTime={0}>
      {children}
    </I18nProvider>
  );
}

/** The rendered date text of the <time> (its dateTime attribute is the UTC instant). */
function shownDate(html: string): string {
  return /<time[^>]*>([^<]*)<\/time>/.exec(html)?.[1] ?? '';
}

afterEach(() => {
  mode.server = false;
});

describe('useTimeZone with a pinned nested provider', () => {
  it('the browser zone really is New York in this test', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/New_York');
  });

  it('the unpinned root provider switches to the browser zone on the client', () => {
    const html = renderToStaticMarkup(root(<Probe />));
    expect(html).toContain('America/New_York|');
    expect(shownDate(html)).toMatch(/\b10\b/);
    expect(shownDate(html)).not.toMatch(/\b11\b/);
  });

  it('an overlay-pinned provider keeps Europe/Berlin on the client (the Berlin date shows)', () => {
    const html = renderToStaticMarkup(root(<I18nProvider {...overlayI18nProps('en')}><Probe /></I18nProvider>));
    expect(html).toContain(`${LEAGUE_TIME_ZONE}|`);
    expect(html).not.toContain('America/New_York');
    expect(shownDate(html)).toMatch(/\b11\b/);
    expect(shownDate(html)).not.toMatch(/\b10\b/);
  });

  it('a pinned provider keeps its zone on the server as well', () => {
    mode.server = true;
    const html = renderToStaticMarkup(
      <I18nProvider locale="de" dataLocale="de" timeZone={LEAGUE_TIME_ZONE} pinTimeZone requestTime={0}>
        <Probe />
      </I18nProvider>,
    );
    expect(html).toContain(`${LEAGUE_TIME_ZONE}|`);
    expect(shownDate(html)).toMatch(/\b11\b/);
  });

  it('an unpinned nested provider under a root still follows the browser zone', () => {
    const html = renderToStaticMarkup(
      root(
        <I18nProvider locale="de" dataLocale="de" timeZone={LEAGUE_TIME_ZONE} requestTime={0}>
          <Probe />
        </I18nProvider>,
      ),
    );
    expect(html).toContain('America/New_York|');
  });
});
