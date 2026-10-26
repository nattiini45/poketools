/**
 * `/admin/formats`: the Format Studio home. The viewer is read live and nothing is read before the gate; a site
 * admin sees every active league, a resource admin only their own (never `listSeasons`); the examples carry the
 * example label; the league list stops at 100 and says so. "Your formats" and "Shared with you" come from the
 * library list with the live actor, stop at 50 and say so, and the New format dialog gets names and ids only.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import { resolveLText } from '@/lib/studio-core/ltext';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'de',
  getLiveAccess: vi.fn(),
  listSeasons: vi.fn(),
  listSeasonsByIds: vi.fn(),
  getAdminSeasonIds: vi.fn(),
  loadLeagueFormatSummaries: vi.fn(),
  listFormatDefinitions: vi.fn(),
  gallery: vi.fn(),
  dialogProps: vi.fn(),
}));

function stub(name: string) {
  const C = function Stub({ children }: { children?: ReactNode }) {
    return <>{children}</>;
  };
  Object.defineProperty(C, 'name', { value: name });
  return { default: C };
}

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    getLocale: async () => mocks.locale,
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, mocks.locale),
  };
});
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  listSeasons: mocks.listSeasons,
  listSeasonsByIds: mocks.listSeasonsByIds,
}));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ getAdminSeasonIds: mocks.getAdminSeasonIds }));
vi.mock('@/lib/format-studio/loader', async () => {
  const { PRESETS, compile } = await import('@/lib/format-kit/client');
  const { toFormatView } = await import('@/lib/format-studio/view');
  return {
    loadLeagueFormatSummaries: mocks.loadLeagueFormatSummaries,
    presetViews: () => PRESETS.map((p) => ({ id: p.id, view: toFormatView(compile(p.definition)) })),
  };
});
vi.mock('@/lib/supabase/queries/format-definitions', () => ({ listFormatDefinitions: mocks.listFormatDefinitions }));
vi.mock('@/lib/cache/format-reads', () => ({ formatReads: { gallery: mocks.gallery } }));
vi.mock('@/components/format-studio/starts/NewFormatDialog', () => ({
  default: (props: unknown) => {
    mocks.dialogProps(props);
    return <button type="button">New format</button>;
  },
}));
vi.mock('@/components/shared/AdminGuard', () => stub('AdminGuard'));

import FormatsGalleryPage, { generateMetadata } from '../page';
import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';

function league(id: string, name: string) {
  return {
    id,
    name,
    archived: false,
    format_type: 'singles',
    ruleset_name: null,
    tournament_count: 2,
    participant_count: 8,
    status: 'active',
    is_test_season: false,
  };
}

function summary(id: string, name: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name,
    formatType: 'singles',
    isTest: false,
    stageCount: 2,
    pairings: ['round_robin', 'single_elim'],
    errors: 0,
    warnings: 0,
    coverage: { auto: 9, checked: 1, honor: 0, legacy: 0, total: 10 },
    ...over,
  };
}

function access(flags: { isSiteAdmin?: boolean; isAnyAdmin?: boolean }) {
  return { player: { playerId: 'p1' }, isSiteAdmin: false, isAnyAdmin: false, isCreator: false, ...flags };
}

function findByType(node: ReactNode, type: unknown): ReactElement[] {
  const found: ReactElement[] = [];
  const visit = (n: ReactNode): void => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (isValidElement<{ children?: ReactNode }>(n)) {
      if (n.type === type) found.push(n);
      visit(n.props.children);
    }
  };
  visit(node);
  return found;
}

const html = (tree: ReactNode, locale: Locale = mocks.locale) =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} dataLocale={locale} timeZone="UTC" requestTime={0}>
      {tree}
    </I18nProvider>,
  );

const allReads = () => [
  mocks.listSeasons,
  mocks.listSeasonsByIds,
  mocks.getAdminSeasonIds,
  mocks.loadLeagueFormatSummaries,
  mocks.listFormatDefinitions,
  mocks.gallery,
];

function stored(id: string, name: string, over: Record<string, unknown> = {}) {
  return {
    id,
    slug: id,
    name: { base: 'en', en: { v: name, s: 'human' } },
    description: null,
    kind: 'custom',
    visibility: 'private',
    forked_from: null,
    draft_rev: 1,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-02T10:00:00Z',
    owner: { id: 'p1', name: 'Alex' },
    current_version: null,
    ...over,
  };
}

const version = (n: number) => ({ id: 'v', version_no: n, content_hash: 'h', created_at: 'x' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = 'en';
  mocks.listSeasons.mockResolvedValue([league('s1', 'Open League'), league('s2', 'Other League')]);
  mocks.getAdminSeasonIds.mockResolvedValue(['s2']);
  mocks.listSeasonsByIds.mockResolvedValue([league('s2', 'Other League')]);
  mocks.loadLeagueFormatSummaries.mockImplementation(async (leagues: { id: string; name: string }[]) =>
    leagues.map((l) => summary(l.id, l.name)),
  );
  mocks.listFormatDefinitions.mockImplementation(async () => ({ items: [], total: 0 }));
  mocks.gallery.mockResolvedValue([]);
});

describe('format gallery: the gate', () => {
  it.each([
    ['signed out', null],
    ['not an admin', access({})],
    ['an admin flag without a player', { ...access({ isAnyAdmin: true }), player: null }],
  ])('%s: AdminGuard alone decides and nothing is read', async (_who, live) => {
    mocks.getLiveAccess.mockResolvedValue(live);
    const tree = await FormatsGalleryPage();
    expect(findByType(tree, AdminGuard)).toHaveLength(1);
    expect(findByType(tree, PageContainer)).toHaveLength(0);
    for (const read of allReads()) expect(read).not.toHaveBeenCalled();
  });
});

describe('format gallery: who sees which leagues', () => {
  it('site admin: every active league, nothing scoped', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    const out = html(await FormatsGalleryPage());
    expect(mocks.listSeasons).toHaveBeenCalledWith({ includeTestSeasons: true });
    expect(mocks.listSeasonsByIds).not.toHaveBeenCalled();
    expect(mocks.getAdminSeasonIds).not.toHaveBeenCalled();
    expect(out).toContain('Open League');
    expect(out).toContain('Other League');
  });

  it('resource admin: only their own leagues, archived ones excluded, never listSeasons', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    const out = html(await FormatsGalleryPage());
    expect(mocks.getAdminSeasonIds).toHaveBeenCalledWith('p1');
    expect(mocks.listSeasonsByIds).toHaveBeenCalledWith(['s2'], { archived: false });
    expect(mocks.listSeasons).not.toHaveBeenCalled();
    expect(out).toContain('Other League');
    expect(out).not.toContain('Open League');
  });

  it('hands the summaries only the leagues it listed', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    await FormatsGalleryPage();
    expect(mocks.loadLeagueFormatSummaries).toHaveBeenCalledTimes(1);
    expect(mocks.loadLeagueFormatSummaries.mock.calls[0][0].map((l: { id: string }) => l.id)).toEqual(['s2']);
  });

  it('a tournament-only admin sees the examples and the empty leagues state', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.getAdminSeasonIds.mockResolvedValue([]);
    mocks.listSeasonsByIds.mockResolvedValue([]);
    mocks.loadLeagueFormatSummaries.mockResolvedValue([]);
    const out = html(await FormatsGalleryPage());
    expect(out).toContain('>Example<');
    expect(out).not.toContain('Change anything');
    expect(out).toContain('No leagues to show yet.');
  });
});

describe('format gallery: examples', () => {
  it.each([
    ['en', '>Example<', 'Examples'],
    ['de', '>Beispiel<', 'Beispiele'],
  ] as const)('shows the three examples with the example label in %s', async (locale, label, heading) => {
    mocks.locale = locale;
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    const out = html(await FormatsGalleryPage());
    expect(out).toContain(heading);
    expect(out.split(label)).toHaveLength(4);
    for (const id of ['classic-league', 'cup', 'swiss-top-cut']) {
      expect(out).toContain(`href="/admin/formats/example/${id}"`);
    }
    expect(out).not.toMatch(/undefined|\{[a-z_]+\}/);
  });

  it('tells the reader the examples are read-only and how to get a copy, without "for now"', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    const out = html(await FormatsGalleryPage());
    expect(out).toContain('Examples are read-only. Use one as a starting point to get a private copy you can change.');
    expect(out).not.toContain('for now');
    mocks.locale = 'de';
    const de = html(await FormatsGalleryPage());
    expect(de).toContain('Beispiele sind schreibgeschützt.');
    expect(de).not.toContain('vorerst');
  });

  it('shows the example titles and the open link in the viewer language', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    const { PRESETS } = await import('@/lib/format-kit/client');
    const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');
    for (const [locale, open] of [['en', 'Open'], ['de', 'Öffnen']] as const) {
      mocks.locale = locale;
      const out = html(await FormatsGalleryPage());
      for (const preset of PRESETS) {
        expect(out).toContain(esc(resolveLText(preset.definition.identity.name, { viewer: locale })?.value ?? ''));
      }
      expect(out).toContain(`>${open}<`);
    }
  });
});

describe('format gallery: league cards', () => {
  it('shows name, format, test badge, stage count, pairing chain, coverage and a link', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    mocks.listSeasons.mockResolvedValue([league('s1', 'Open League')]);
    mocks.loadLeagueFormatSummaries.mockResolvedValue([summary('s1', 'Open League', { isTest: true })]);
    const out = html(await FormatsGalleryPage());
    expect(out).toContain('Open League');
    expect(out).toContain('Singles');
    expect(out).toContain('Test league');
    expect(out).toContain('2 stages');
    expect(out).toContain('Round robin → Single elimination');
    expect(out).toContain('9 automated, 1 confirmed by an admin.');
    expect(out).toContain('No problems found');
    expect(out).toContain('href="/admin/formats/league/s1"');
  });

  it('says errors and warnings in words', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    mocks.listSeasons.mockResolvedValue([league('s1', 'Open League')]);
    mocks.loadLeagueFormatSummaries.mockResolvedValue([summary('s1', 'Open League', { errors: 1, warnings: 3 })]);
    const out = html(await FormatsGalleryPage());
    expect(out).toContain('1 error');
    expect(out).toContain('3 warnings');
    expect(out).not.toContain('No problems found');
    mocks.locale = 'de';
    const de = html(await FormatsGalleryPage());
    expect(de).toContain('1 Fehler');
    expect(de).toContain('3 Warnungen');
  });

  it('marks a league without phases instead of claiming it is fine', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    mocks.listSeasons.mockResolvedValue([league('s1', 'Open League')]);
    mocks.loadLeagueFormatSummaries.mockResolvedValue([
      summary('s1', 'Open League', { stageCount: 0, pairings: [], coverage: null }),
    ]);
    const out = html(await FormatsGalleryPage());
    expect(out).toContain('No phases yet');
    expect(out).not.toContain('No problems found');
  });

  it('shows the empty state when there are no leagues', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    mocks.listSeasons.mockResolvedValue([]);
    mocks.loadLeagueFormatSummaries.mockResolvedValue([]);
    mocks.locale = 'de';
    expect(html(await FormatsGalleryPage())).toContain('Noch keine Ligen vorhanden.');
  });
});

describe('format gallery: the cap', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => league(`s${i}`, `League ${i}`));

  it('notes the cap when the list reaches 100', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    mocks.listSeasons.mockResolvedValue(many(100));
    expect(html(await FormatsGalleryPage())).toContain('Showing the first 100 leagues only.');
  });

  it('does not note it below 100', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    mocks.listSeasons.mockResolvedValue(many(99));
    expect(html(await FormatsGalleryPage())).not.toContain('Showing the first');
  });

  it('slices a longer scoped list to 100 before reading their formats', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.getAdminSeasonIds.mockResolvedValue(many(130).map((l) => l.id));
    mocks.listSeasonsByIds.mockResolvedValue(many(130));
    const out = html(await FormatsGalleryPage());
    expect(mocks.loadLeagueFormatSummaries.mock.calls[0][0]).toHaveLength(100);
    expect(out).toContain('Showing the first 100 leagues only.');
  });
});

describe('format gallery: metadata', () => {
  it.each([
    ['en', 'Formats | PokéTools'],
    ['de', 'Formate | PokéTools'],
  ] as const)('has a page title in %s', async (locale, title) => {
    mocks.locale = locale;
    expect(await generateMetadata()).toEqual({ title });
  });
});

describe('format gallery: the New format action', () => {
  it('hands the dialog example names, gallery names with versions and the leagues that have phases, nothing else', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    mocks.listSeasons.mockResolvedValue([league('s1', 'Open League'), league('s2', 'Empty League')]);
    mocks.loadLeagueFormatSummaries.mockResolvedValue([
      summary('s1', 'Open League'),
      summary('s2', 'Empty League', { stageCount: 0, pairings: [], coverage: null }),
    ]);
    mocks.gallery.mockResolvedValue([
      {
        id: 'g1',
        slug: 'autumn-cup',
        name: { base: 'en', en: { v: 'Autumn Cup', s: 'human' } },
        description: null,
        kind: 'custom',
        version_no: 3,
        content_hash: 'h',
        updated_at: '2026-10-02T10:00:00Z',
      },
    ]);
    const out = html(await FormatsGalleryPage());
    expect(out).toContain('New format');
    expect(mocks.dialogProps).toHaveBeenCalledTimes(1);
    const data = mocks.dialogProps.mock.calls[0][0].data;
    expect(data.examples.map((e: { id: string }) => e.id)).toEqual(['classic-league', 'cup', 'swiss-top-cut']);
    expect(data.examples.every((e: { name: string }) => e.name.length > 0)).toBe(true);
    expect(data.gallery).toEqual([{ id: 'g1', name: 'Autumn Cup', version: 3 }]);
    expect(data.leagues).toEqual([{ id: 's1', name: 'Open League' }]);
    expect(Object.keys(data).sort()).toEqual(['examples', 'gallery', 'leagues']);
  });

  it('names the examples in the viewer language', async () => {
    mocks.locale = 'de';
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    html(await FormatsGalleryPage());
    const { PRESETS } = await import('@/lib/format-kit/client');
    const names = mocks.dialogProps.mock.calls[0][0].data.examples.map((e: { name: string }) => e.name);
    expect(names).toEqual(PRESETS.map((p) => resolveLText(p.definition.identity.name, { viewer: 'de' })?.value));
  });
});

describe('format gallery: your formats and shared formats', () => {
  it('lists with the live actor, 50 at a time, mine and shared', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    await FormatsGalleryPage();
    expect(mocks.listFormatDefinitions).toHaveBeenCalledTimes(2);
    const actor = { playerId: 'p1', isAdmin: true };
    expect(mocks.listFormatDefinitions).toHaveBeenCalledWith({ actor, scope: 'mine', limit: 50, offset: 0 });
    expect(mocks.listFormatDefinitions).toHaveBeenCalledWith({ actor, scope: 'shared', limit: 50, offset: 0 });
  });

  it('a resource admin lists as a plain admin, never as a site admin', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    await FormatsGalleryPage();
    for (const call of mocks.listFormatDefinitions.mock.calls) expect(call[0].actor).toEqual({ playerId: 'p1', isAdmin: false });
  });

  it('own formats lead to the editor, with their state in words', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.listFormatDefinitions.mockImplementation(async ({ scope }: { scope: string }) =>
      scope === 'mine'
        ? {
            items: [
              stored('d1', 'Draft cup'),
              stored('d2', 'Live cup', { visibility: 'league', current_version: version(4) }),
              stored('d3', 'Gallery cup', { visibility: 'gallery', current_version: version(1) }),
            ],
            total: 3,
          }
        : { items: [], total: 0 },
    );
    const out = html(await FormatsGalleryPage());
    expect(out).toContain('Your formats');
    expect(out).toContain('href="/admin/formats/d1/edit"');
    expect(out).toContain('href="/admin/formats/d2/edit"');
    expect(out).toContain('>Draft<');
    expect(out).toContain('Published v4');
    expect(out).toContain('Shared with league admins');
    expect(out).toContain('In the gallery');
    expect(out).toContain('>Edit<');
    expect(out).not.toContain('>Fork<');
  });

  it('shared formats lead to the read-only page, name their owner and offer Fork', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.listFormatDefinitions.mockImplementation(async ({ scope }: { scope: string }) =>
      scope === 'shared'
        ? {
            items: [stored('s9', 'Shared cup', { visibility: 'league', owner: { id: 'p2', name: 'Sam' }, current_version: version(2) })],
            total: 1,
          }
        : { items: [], total: 0 },
    );
    const out = html(await FormatsGalleryPage());
    expect(out).toContain('Shared with you');
    expect(out).toContain('href="/admin/formats/s9"');
    expect(out).not.toContain('href="/admin/formats/s9/edit"');
    expect(out).toContain('By Sam');
    expect(out).toContain('>Open<');
    expect(out).toContain('>Fork<');
  });

  it.each([
    ['en', 'You have no formats yet.', 'Nobody has shared a format with you yet.'],
    ['de', 'Du hast noch keine Formate.', 'Noch hat niemand ein Format mit dir geteilt.'],
  ] as const)('says when a list is empty (%s)', async (locale, mine, shared) => {
    mocks.locale = locale;
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    const out = html(await FormatsGalleryPage());
    expect(out).toContain(mine);
    expect(out).toContain(shared);
  });

  it('notes the cap only for a list that has more than it shows', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.listFormatDefinitions.mockImplementation(async ({ scope }: { scope: string }) =>
      scope === 'mine' ? { items: [stored('d1', 'One')], total: 80 } : { items: [], total: 0 },
    );
    const out = html(await FormatsGalleryPage());
    expect(out.match(/Showing the first 50 formats only\./g)).toHaveLength(1);
  });

  it('a tournament-only admin still gets the lists and the empty league state', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.getAdminSeasonIds.mockResolvedValue([]);
    mocks.listSeasonsByIds.mockResolvedValue([]);
    mocks.loadLeagueFormatSummaries.mockResolvedValue([]);
    const out = html(await FormatsGalleryPage());
    expect(out).toContain('Your formats');
    expect(out).toContain('Shared with you');
    expect(out).toContain('No leagues to show yet.');
    expect(mocks.listFormatDefinitions).toHaveBeenCalledTimes(2);
  });
});
