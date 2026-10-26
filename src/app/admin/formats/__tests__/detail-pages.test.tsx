/**
 * The two detail routes. League detail: the live per-league gate runs before any read (a malformed id is a 404,
 * a non-admin gets the guard, an admin of another league or a tournament-only admin the forbidden notice), then
 * one `loadLeagueFormat`; a league with phases offers "Copy as a new format" with the structure document built on
 * the server. Example detail: any admin, a known preset only, no data read, with the fork button.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/client';
import type { Locale } from '@/i18n/config';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'de',
  getLiveAccess: vi.fn(),
  isResourceAdminFor: vi.fn(),
  getSeasonWithDetails: vi.fn(),
  loadLeagueFormat: vi.fn(),
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
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    getLocale: async () => mocks.locale,
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, mocks.locale),
  };
});
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: mocks.isResourceAdminFor }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonWithDetails: mocks.getSeasonWithDetails }));
vi.mock('@/lib/format-studio/loader', async () => {
  const { PRESETS, compile } = await import('@/lib/format-kit/client');
  const { toFormatView } = await import('@/lib/format-studio/view');
  return {
    loadLeagueFormat: mocks.loadLeagueFormat,
    presetViews: () => PRESETS.map((p) => ({ id: p.id, view: toFormatView(compile(p.definition)) })),
  };
});
vi.mock('@/components/shared/AdminGuard', () => stub('AdminGuard'));
vi.mock('@/components/shared/ResourceForbidden', () => stub('ResourceForbidden'));
vi.mock('@/components/format-studio/FormatDetail', () => stub('FormatDetail'));
vi.mock('@/components/format-studio/starts/ForkPresetButton', () => stub('ForkPresetButton'));
vi.mock('@/components/format-studio/starts/CopyLeagueStructureButton', () => stub('CopyLeagueStructureButton'));

import LeaguePage, { generateMetadata as leagueMetadata } from '../league/[id]/page';
import ExamplePage, { generateMetadata as exampleMetadata } from '../example/[presetId]/page';
import AdminGuard from '@/components/shared/AdminGuard';
import ResourceForbidden from '@/components/shared/ResourceForbidden';
import FormatDetail from '@/components/format-studio/FormatDetail';
import ForkPresetButton from '@/components/format-studio/starts/ForkPresetButton';
import CopyLeagueStructureButton from '@/components/format-studio/starts/CopyLeagueStructureButton';
import { PRESETS, type FormatDefinition } from '@/lib/format-kit/client';

const LEAGUE_ID = '11111111-1111-4111-8111-111111111111';

function access(flags: { isSiteAdmin?: boolean; isAnyAdmin?: boolean }) {
  return { player: { playerId: 'p1' }, isSiteAdmin: false, isAnyAdmin: false, isCreator: false, ...flags };
}

const league = { id: LEAGUE_ID, name: 'Spring League', format_type: 'singles' };
/** A league's descriptor: a format with a module (league tuning) and a named ruleset, as the loader can return. */
function leagueDefinition(): FormatDefinition {
  const base = structuredClone(PRESETS[0].definition) as FormatDefinition;
  base.identity.based_on = 'classic-league';
  base.stages[0].ruleset = { kind: 'ruleset', id: 'rs-league' };
  base.modules = [{ kind: 'module.legacy', adapter: 'core_liga', facts: [] }];
  return base;
}
const okResult = { kind: 'ok', view: { ok: true, marker: 'view', definition: leagueDefinition() }, editorLinks: { epb: '/x' } };

function findByType(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  const found: ReactElement<Record<string, unknown>>[] = [];
  const visit = (n: ReactNode): void => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (isValidElement<{ children?: ReactNode }>(n)) {
      if (n.type === type) found.push(n as ReactElement<Record<string, unknown>>);
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

const leagueParams = (id: string) => ({ params: Promise.resolve({ id }) });
const exampleParams = (presetId: string) => ({ params: Promise.resolve({ presetId }) });

const leagueReads = () => [mocks.getSeasonWithDetails, mocks.loadLeagueFormat];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = 'en';
  mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
  mocks.isResourceAdminFor.mockResolvedValue(true);
  mocks.getSeasonWithDetails.mockResolvedValue(league);
  mocks.loadLeagueFormat.mockResolvedValue(okResult);
});

describe('league format page', () => {
  it('a malformed id is a 404 before any auth or data read', async () => {
    await expect(LeaguePage(leagueParams('not-a-uuid'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getLiveAccess).not.toHaveBeenCalled();
    expect(mocks.isResourceAdminFor).not.toHaveBeenCalled();
    for (const read of leagueReads()) expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ['signed out', null],
    ['not an admin', access({})],
  ])('%s: AdminGuard alone decides and nothing is read', async (_who, live) => {
    mocks.getLiveAccess.mockResolvedValue(live);
    const tree = await LeaguePage(leagueParams(LEAGUE_ID));
    expect(findByType(tree, AdminGuard)).toHaveLength(1);
    expect(findByType(tree, FormatDetail)).toHaveLength(0);
    expect(mocks.isResourceAdminFor).not.toHaveBeenCalled();
    for (const read of leagueReads()) expect(read).not.toHaveBeenCalled();
  });

  it("an admin of another league gets the forbidden notice, no league data and no loader call", async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.isResourceAdminFor.mockResolvedValue(false);
    const tree = await LeaguePage(leagueParams(LEAGUE_ID));
    expect(mocks.isResourceAdminFor).toHaveBeenCalledWith('p1', 'season', LEAGUE_ID);
    const forbidden = findByType(tree, ResourceForbidden);
    expect(forbidden).toHaveLength(1);
    expect(html(forbidden[0].props.children as ReactNode)).toBe('Only admins of this league can open its format.');
    for (const read of leagueReads()) expect(read).not.toHaveBeenCalled();
  });

  it('a tournament-only admin is forbidden too (the gate checks the season, not a tournament)', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.isResourceAdminFor.mockImplementation(async (_player: string, type: string) => type === 'tournament');
    const tree = await LeaguePage(leagueParams(LEAGUE_ID));
    expect(findByType(tree, ResourceForbidden)).toHaveLength(1);
    expect(mocks.isResourceAdminFor).toHaveBeenCalledTimes(1);
    expect(mocks.isResourceAdminFor.mock.calls[0][1]).toBe('season');
    for (const read of leagueReads()) expect(read).not.toHaveBeenCalled();
  });

  it('the forbidden notice is in German for a German viewer', async () => {
    mocks.locale = 'de';
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.isResourceAdminFor.mockResolvedValue(false);
    const tree = await LeaguePage(leagueParams(LEAGUE_ID));
    expect(html(findByType(tree, ResourceForbidden)[0].props.children as ReactNode)).toBe(
      'Nur Admins dieser Liga können ihr Format öffnen.',
    );
  });

  it('an unknown league is a 404 and the loader is not called', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(null);
    await expect(LeaguePage(leagueParams(LEAGUE_ID))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.loadLeagueFormat).not.toHaveBeenCalled();
  });

  it('a site admin: loads the format once with the league row and renders the page detail', async () => {
    const tree = await LeaguePage(leagueParams(LEAGUE_ID));
    expect(mocks.isResourceAdminFor).not.toHaveBeenCalled();
    expect(mocks.getSeasonWithDetails).toHaveBeenCalledWith(LEAGUE_ID);
    expect(mocks.loadLeagueFormat).toHaveBeenCalledTimes(1);
    expect(mocks.loadLeagueFormat).toHaveBeenCalledWith(league);
    const detail = findByType(tree, FormatDetail);
    expect(detail).toHaveLength(1);
    expect(detail[0].props).toMatchObject({ view: okResult.view, variant: 'page', editorLinks: okResult.editorLinks });
    expect(detail[0].props.example).toBeUndefined();
  });

  it("a league's own admin passes the gate", async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    const tree = await LeaguePage(leagueParams(LEAGUE_ID));
    expect(mocks.isResourceAdminFor).toHaveBeenCalledWith('p1', 'season', LEAGUE_ID);
    expect(findByType(tree, FormatDetail)).toHaveLength(1);
  });

  it('shows the league name, its format and the links back', async () => {
    const out = html(await LeaguePage(leagueParams(LEAGUE_ID)));
    expect(out).toContain('Spring League');
    expect(out).toContain('Singles');
    expect(out).toContain('href="/admin/formats"');
    expect(out).toContain(`href="/admin/leagues/${LEAGUE_ID}"`);
  });

  it('a league without phases shows the empty state with a link to its Phases tab', async () => {
    mocks.loadLeagueFormat.mockResolvedValue({ kind: 'no_phases' });
    const tree = await LeaguePage(leagueParams(LEAGUE_ID));
    expect(findByType(tree, FormatDetail)).toHaveLength(0);
    const out = html(tree);
    expect(out).toContain('This league has no phases yet.');
    expect(out).toContain(`href="/admin/leagues/${LEAGUE_ID}?tab=phases"`);
  });

  it.each([
    ['en', 'A custom league gets its phases when a format is attached to it'],
    ['de', 'Eine eigene Liga bekommt ihre Phasen, wenn ein Format angehängt wird'],
  ] as const)('a custom league without phases is not sent to the Phases tab (%s)', async (locale, expected) => {
    mocks.locale = locale;
    mocks.getSeasonWithDetails.mockResolvedValue({ ...league, format_type: 'custom' });
    mocks.loadLeagueFormat.mockResolvedValue({ kind: 'no_phases' });
    const out = html(await LeaguePage(leagueParams(LEAGUE_ID)));
    expect(out).toContain(expected);
    expect(out).not.toContain('tab=phases');
  });
});

describe('league format page: copy as a new format', () => {
  it('offers the copy with a structure document built on the server: no modules, no named rulesets, no based_on', async () => {
    const tree = await LeaguePage(leagueParams(LEAGUE_ID));
    const copy = findByType(tree, CopyLeagueStructureButton);
    expect(copy).toHaveLength(1);
    const document = copy[0].props.definition as FormatDefinition;
    expect(document.modules).toEqual([]);
    expect(document.stages[0].ruleset).toEqual({ kind: 'season_default' });
    expect(document.identity.based_on).toBeUndefined();
    expect(document.stages).toHaveLength(okResult.view.definition.stages.length);
    expect(JSON.stringify(document)).not.toContain('rs-league');
    expect(JSON.stringify(document)).not.toContain('core_liga');
  });

  it('the copy sits before the detail and the page still shows the detail', async () => {
    const tree = await LeaguePage(leagueParams(LEAGUE_ID));
    expect(findByType(tree, FormatDetail)).toHaveLength(1);
  });

  it('a league without phases offers no copy', async () => {
    mocks.loadLeagueFormat.mockResolvedValue({ kind: 'no_phases' });
    const tree = await LeaguePage(leagueParams(LEAGUE_ID));
    expect(findByType(tree, CopyLeagueStructureButton)).toHaveLength(0);
  });

  it('a league whose format could not be shown offers no copy', async () => {
    mocks.loadLeagueFormat.mockResolvedValue({ ...okResult, view: { ok: false, definition: null } });
    const tree = await LeaguePage(leagueParams(LEAGUE_ID));
    expect(findByType(tree, CopyLeagueStructureButton)).toHaveLength(0);
    expect(findByType(tree, FormatDetail)).toHaveLength(1);
  });

  it('nobody who fails the gate gets the copy button or a structure document', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.isResourceAdminFor.mockResolvedValue(false);
    const tree = await LeaguePage(leagueParams(LEAGUE_ID));
    expect(findByType(tree, CopyLeagueStructureButton)).toHaveLength(0);
  });
});

describe('example format page', () => {
  it.each(['nope', '../league', 'CLASSIC-LEAGUE', 'classic-league/', '', 'constructor'])('%j is a 404', async (presetId) => {
    await expect(ExamplePage(exampleParams(presetId))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it.each([
    ['signed out', null],
    ['not an admin', access({})],
  ])('%s: AdminGuard alone decides', async (_who, live) => {
    mocks.getLiveAccess.mockResolvedValue(live);
    const tree = await ExamplePage(exampleParams('cup'));
    expect(findByType(tree, AdminGuard)).toHaveLength(1);
    expect(findByType(tree, FormatDetail)).toHaveLength(0);
  });

  it.each(['classic-league', 'cup', 'swiss-top-cut'])('%s: renders the detail as an example and reads nothing', async (presetId) => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    const tree = await ExamplePage(exampleParams(presetId));
    const detail = findByType(tree, FormatDetail);
    expect(detail).toHaveLength(1);
    expect(detail[0].props).toMatchObject({ variant: 'page', example: true });
    expect((detail[0].props.view as { ok: boolean }).ok).toBe(true);
    expect(mocks.isResourceAdminFor).not.toHaveBeenCalled();
    for (const read of leagueReads()) expect(read).not.toHaveBeenCalled();
  });

  it.each(['classic-league', 'cup', 'swiss-top-cut'])('%s: offers the fork button for that preset', async (presetId) => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    const tree = await ExamplePage(exampleParams(presetId));
    const fork = findByType(tree, ForkPresetButton);
    expect(fork).toHaveLength(1);
    expect(fork[0].props.presetId).toBe(presetId);
  });

  it('a viewer who fails the gate gets no fork button', async () => {
    mocks.getLiveAccess.mockResolvedValue(null);
    const tree = await ExamplePage(exampleParams('cup'));
    expect(findByType(tree, ForkPresetButton)).toHaveLength(0);
  });

  it('titles the page with the example name in the viewer language and links back to the gallery', async () => {
    mocks.locale = 'de';
    const { PRESETS, resolveLText } = await import('@/lib/format-kit/client');
    const classic = PRESETS.find((p) => p.id === 'classic-league')!;
    const out = html(await ExamplePage(exampleParams('classic-league')));
    expect(out).toContain((resolveLText(classic.definition.identity.name, { viewer: 'de' })?.value ?? '').replace(/'/g, '&#x27;'));
    expect(out).toContain('href="/admin/formats"');
    expect(out).toContain('Zurück zu den Formaten');
  });
});

describe('detail page titles', () => {
  it('the league page has a fixed title and reads no league data for it', async () => {
    expect(await leagueMetadata()).toEqual({ title: 'League format | PokéTools' });
    mocks.locale = 'de';
    expect(await leagueMetadata()).toEqual({ title: 'Liga-Format | PokéTools' });
    for (const read of leagueReads()) expect(read).not.toHaveBeenCalled();
  });

  it('the example page is titled with the example name in the viewer language', async () => {
    const { PRESETS, resolveLText } = await import('@/lib/format-kit/client');
    const cup = PRESETS.find((p) => p.id === 'cup')!;
    for (const locale of ['en', 'de'] as const) {
      mocks.locale = locale;
      const name = resolveLText(cup.definition.identity.name, { viewer: locale })?.value;
      expect(await exampleMetadata(exampleParams('cup'))).toEqual({ title: `${name} | PokéTools` });
    }
  });

  it('an unknown example id falls back to the gallery title', async () => {
    expect(await exampleMetadata(exampleParams('nope'))).toEqual({ title: 'Formats | PokéTools' });
  });
});
