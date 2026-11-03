/**
 * Every route error boundary shows its translated fallback and never `error.message`: in production Next
 * replaces a server render error's message with a fixed English sentence, and a client error keeps its raw
 * internal text, so printing it shows an English technical sentence to a German viewer. A digest, when there
 * is one, is shown as a muted reference line instead.
 */
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import { shellMessages } from '@/i18n/messages/shell';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';
import { creatorMessages } from '@/i18n/messages/creator';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { leaguesMessages } from '@/i18n/messages/leagues';
import { tournamentsMessages } from '@/i18n/messages/tournaments';

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }));

import RootError from '../error';
import TeambuilderError from '../(player)/teambuilder/error';
import CastDashboardError from '../(player)/dashboard/broadcast/error';
import AdminError from '../admin/error';
import LeagueError from '../(public)/leagues/[id]/error';
import TournamentError from '../(public)/tournaments/[id]/error';

type Boundary = ComponentType<{ error: Error & { digest?: string }; reset: () => void }>;

const DETAIL = 'internal detail: Proxy failed for https://cdn.example/x';

const BOUNDARIES: Array<{ name: string; Component: Boundary; fallback: (locale: Locale) => string }> = [
  { name: 'root', Component: RootError, fallback: (l) => shellMessages[l].errorPage.fallback },
  { name: 'teambuilder', Component: TeambuilderError, fallback: (l) => teambuilderMessages[l].page.errorFallback },
  { name: 'cast dashboard', Component: CastDashboardError, fallback: (l) => creatorMessages[l].broadcastError.fallback },
  { name: 'admin', Component: AdminError, fallback: (l) => adminCoreMessages[l].error.fallback },
  { name: 'league', Component: LeagueError, fallback: (l) => leaguesMessages[l].error.description },
  { name: 'tournament', Component: TournamentError, fallback: (l) => tournamentsMessages[l].error.fallback },
];

function errorWith(message: string, digest?: string): Error & { digest?: string } {
  return Object.assign(new Error(message), digest === undefined ? {} : { digest });
}

function render(Component: Boundary, locale: Locale, digest?: string): string {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    return renderWithI18n(<Component error={errorWith(DETAIL, digest)} reset={() => {}} />, { locale });
  } finally {
    quiet.mockRestore();
  }
}

/** Static markup HTML-escapes apostrophes; compare as the viewer reads it. */
function text(html: string): string {
  return html.replaceAll('&#x27;', "'").replaceAll('&amp;', '&');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(['en', 'de'] as const)('route error boundaries (%s)', (locale) => {
  describe.each(BOUNDARIES)('$name', ({ name, Component, fallback }) => {
    it('shows the translated fallback and never the raw message', () => {
      // The admin boundary may show the message outside production (below); production is the rule here.
      vi.stubEnv('NODE_ENV', 'production');
      const html = text(render(Component, locale));
      expect(html).toContain(fallback(locale));
      expect(html).not.toContain('internal detail');
      expect(html).not.toContain('Proxy failed');
      expect(name).toBeTruthy();
    });

    it('shows a muted reference line with the digest, in the viewer language', () => {
      vi.stubEnv('NODE_ENV', 'production');
      const html = text(render(Component, locale, 'abc'));
      const reference = shellMessages[locale].errorPage.reference.replace('{digest}', 'abc');
      expect(html).toContain(reference);
    });

    it('shows no reference line without a digest', () => {
      vi.stubEnv('NODE_ENV', 'production');
      const html = text(render(Component, locale));
      const prefix = shellMessages[locale].errorPage.reference.split('{digest}')[0];
      expect(html).not.toContain(prefix);
    });
  });
});

describe('reference text', () => {
  it('differs between the languages', () => {
    expect(shellMessages.en.errorPage.reference).toBe('Reference: {digest}');
    expect(shellMessages.de.errorPage.reference).not.toBe(shellMessages.en.errorPage.reference);
    expect(shellMessages.de.errorPage.reference).toContain('{digest}');
  });
});

describe('admin boundary', () => {
  it('shows the raw message outside production, never as the main text', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const html = text(render(AdminError, 'en'));
    expect(html).toContain(adminCoreMessages.en.error.fallback);
    expect(html).toContain(DETAIL);
  });

  it('never shows the raw message in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(render(AdminError, 'en', 'abc')).not.toContain('internal detail');
  });
});
