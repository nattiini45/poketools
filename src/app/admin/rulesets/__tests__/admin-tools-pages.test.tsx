/**
 * The Ruleset Studio pages: `/admin/rulesets` (the gallery), `/admin/rulesets/[id]` (read-only), `/admin/rulesets/[id]/edit`
 * (the editor), `/admin/rulesets/catalog/[presetId]` (a catalog rule preset) and the old `/admin/rulesets/new` address.
 * The gate is the real `gateRulesetDefinition` over mocked auth and reads: a malformed id is a 404 before anything is read,
 * a non-admin gets the guard, an admin who may not see the ruleset the forbidden notice, a viewer who may not edit is sent
 * to the read-only page, and the editor's props carry no owner id and no player row.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import { ltext } from '@/lib/studio-core/ltext';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import { rulesFromBans } from '@/lib/ruleset-kit/effective';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'de',
  getLiveAccess: vi.fn(),
  getRulesetDefinitionMeta: vi.fn(),
  getRulesetDetail: vi.fn(),
  listRulesetDefinitions: vi.fn(),
  listUsage: vi.fn(),
  countPinsByDefinition: vi.fn(),
  getVersionChanges: vi.fn(),
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
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    getLocale: async () => mocks.locale,
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, mocks.locale),
  };
});
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/lib/supabase/queries/ruleset-definitions', () => ({
  getRulesetDefinitionMeta: mocks.getRulesetDefinitionMeta,
  listRulesetDefinitions: mocks.listRulesetDefinitions,
  countPinsByDefinition: mocks.countPinsByDefinition,
}));
vi.mock('@/lib/ruleset-studio/version-changes.server', () => ({ getVersionChanges: mocks.getVersionChanges }));
vi.mock('@/lib/pkmn/preset-data/pin', () => ({ PRESET_RULES_VERSION: 'catalog-now' }));
vi.mock('@/lib/ruleset-studio/guards', () => ({
  actorFor: async (player: { playerId: string; isAdmin: boolean }) => ({ playerId: player.playerId, isAdmin: player.isAdmin }),
}));
vi.mock('@/lib/ruleset-studio/library', () => ({ getRulesetDetail: mocks.getRulesetDetail }));
vi.mock('@/lib/ruleset-studio/pins', () => ({ listUsage: mocks.listUsage }));
vi.mock('@/components/ruleset/UsagePanel', () => stub('UsagePanel'));
vi.mock('@/components/shared/AdminGuard', () => stub('AdminGuard'));
vi.mock('@/components/shared/ResourceForbidden', () => stub('ResourceForbidden'));
vi.mock('@/components/ruleset-studio/editor/RulesetEditor', () => stub('RulesetEditor'));
vi.mock('@/components/ruleset-studio/starts/ForkStoredButton', () => stub('ForkStoredButton'));
vi.mock('@/components/ruleset-studio/starts/ForkPresetButton', () => stub('ForkPresetButton'));
vi.mock('@/components/ruleset-studio/starts/PresetLibraryList', () => stub('PresetLibraryList'));
vi.mock('@/components/ruleset-studio/starts/NewRulesetDialog', () => ({
  default: (props: unknown) => {
    mocks.dialogProps(props);
    return <button type="button">New ruleset</button>;
  },
}));

import GalleryPage from '../page';
import EditPage from '../[id]/edit/page';
import DetailPage from '../[id]/page';
import PresetPage from '../catalog/[presetId]/page';
import NewPage from '../new/page';
import AdminGuard from '@/components/shared/AdminGuard';
import ResourceForbidden from '@/components/shared/ResourceForbidden';
import RulesetEditor from '@/components/ruleset-studio/editor/RulesetEditor';
import UsagePanel from '@/components/ruleset/UsagePanel';
import ForkPresetButton from '@/components/ruleset-studio/starts/ForkPresetButton';
import PresetLibraryList from '@/components/ruleset-studio/starts/PresetLibraryList';
import RulesetPageView, { type RulesetPageViewProps } from '@/components/ruleset-studio/RulesetPageView';
import RulesetsGalleryView, { type RulesetsGalleryViewProps } from '@/components/ruleset-studio/RulesetsGalleryView';

const ID = '33333333-3333-4333-8333-333333333333';

function access(flags: { isSiteAdmin?: boolean; isAnyAdmin?: boolean; playerId?: string }) {
  const { playerId = 'p1', ...rest } = flags;
  return { player: { playerId, isAdmin: flags.isSiteAdmin === true, name: 'Alex', discord_id: 'secret' }, isSiteAdmin: false, isAnyAdmin: false, isCreator: false, ...rest };
}

function meta(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    slug: 'my-ou',
    name: ltext('en', 'My OU', 'Mein OU'),
    description: null,
    kind: 'custom',
    owner_id: 'p1',
    visibility: 'private',
    season_id: null,
    forked_from: null,
    draft_rev: 3,
    current_version_id: null,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-02T10:00:00Z',
    ...over,
  };
}

function summary(over: Record<string, unknown> = {}) {
  const { owner_id: _ownerId, current_version_id: _currentVersionId, ...rest } = meta(over);
  return { ...rest, owner: { id: 'p1', name: 'Alex' }, current_version: null };
}

const draftDoc = () => newRulesetDocument('My OU', 'en', 'gen9ou');

function detail(over: Record<string, unknown> = {}) {
  return { definition: summary(), draft: { document: draftDoc(), draft_rev: 3 }, published: null, versions: [], check: null, ...over };
}

const published = () => ({
  id: 'v1',
  version_no: 2,
  schema_version: 1,
  name_text: 'My OU',
  content_hash: 'hash-2',
  resolved_hash: 'resolved-2',
  catalog_version: 'test',
  gen: 9,
  format_key: 'gen9ou',
  is_doubles: false,
  changelog: null,
  created_by: 'p1',
  created_at: '2026-10-02T10:00:00Z',
  spec: draftDoc(),
  resolved: rulesFromBans({ gen: 9, formatKey: 'gen9ou', clauses: ['Species Clause'], bans: { pokemon: ['koraidon'] } }),
});

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

/** What a page's view component renders: the view is pure, so the test calls it with the props the page gave it. */
function expandView<P>(tree: ReactNode, view: (props: P) => ReactNode): ReactNode {
  const [element] = findByType(tree, view);
  return view(element.props as P);
}

const html = (tree: ReactNode, locale: Locale = mocks.locale) =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} dataLocale={locale} timeZone="UTC" requestTime={0}>
      {tree}
    </I18nProvider>,
  );

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const reads = () => [mocks.getRulesetDefinitionMeta, mocks.getRulesetDetail, mocks.listRulesetDefinitions];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = 'en';
  mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
  mocks.getRulesetDefinitionMeta.mockResolvedValue(meta());
  mocks.getRulesetDetail.mockResolvedValue(detail());
  mocks.listRulesetDefinitions.mockResolvedValue({ items: [], total: 0 });
  mocks.listUsage.mockResolvedValue({ counts: [{ version_no: 2, seasons: 1, tournaments: 0 }], targets: null });
  mocks.countPinsByDefinition.mockResolvedValue(new Map());
  mocks.getVersionChanges.mockResolvedValue(new Map());
});

describe('the gallery', () => {
  it.each([
    ['signed out', null],
    ['not an admin', access({})],
  ])('%s: AdminGuard alone decides and nothing is read', async (_who, live) => {
    mocks.getLiveAccess.mockResolvedValue(live);
    const tree = await GalleryPage();
    expect(findByType(tree, AdminGuard)).toHaveLength(1);
    expect(mocks.listRulesetDefinitions).not.toHaveBeenCalled();
  });

  it('lists with the live actor, splits league-owned rulesets and offers only published shared ones to copy', async () => {
    mocks.listRulesetDefinitions.mockImplementation(async (args: { scope: string; kind?: string }) => {
      if (args.scope === 'mine') return { items: [summary({ id: 'a' }), summary({ id: 'b', season_id: 's1' })], total: 2 };
      if (args.kind === 'preset') return { items: [], total: 0 };
      return {
        items: [
          { ...summary({ id: 'c', owner_id: 'p2' }), current_version: { id: 'v', version_no: 4, content_hash: 'h', created_at: 'x' } },
          summary({ id: 'd', owner_id: 'p2' }),
        ],
        total: 2,
      };
    });
    const tree = await GalleryPage();
    const text = html(tree);
    expect(text).toContain('Your rulesets');
    expect(text).toContain('League rulesets');
    expect(text).toContain('Showdown formats');
    expect(text).toContain('Smogon draft formats');
    expect(mocks.listRulesetDefinitions.mock.calls.map((call) => call[0].actor)).toEqual([
      { playerId: 'p1', isAdmin: false },
      { playerId: 'p1', isAdmin: false },
      { playerId: 'p1', isAdmin: false },
    ]);
    expect(mocks.dialogProps).toHaveBeenCalledWith({ data: { shared: [{ id: 'c', name: 'My OU', version: 4 }] } });
  });

  describe('the cards', () => {
    const head = (over: Record<string, unknown> = {}) => ({ id: 'v', version_no: 3, content_hash: 'h', created_at: 'x', catalog_version: 'catalog-now', base_preset: 'gen9ou', ...over });
    const lists = (mine: unknown[], shared: unknown[] = []) =>
      mocks.listRulesetDefinitions.mockImplementation(async (args: { scope: string; kind?: string }) => {
        if (args.scope === 'mine') return { items: mine, total: mine.length };
        if (args.kind === 'preset') return { items: [], total: 0 };
        return { items: shared, total: shared.length };
      });

    it('say how many leagues and phases use each published ruleset, from counts read for the listed definitions only', async () => {
      lists([{ ...summary({ id: 'a' }), current_version: head() }], [{ ...summary({ id: 'c', owner_id: 'p2', visibility: 'gallery' }), current_version: head() }]);
      mocks.countPinsByDefinition.mockResolvedValue(
        new Map([
          ['a', { seasons: 2, tournaments: 1 }],
          ['c', { seasons: 0, tournaments: 0 }],
        ]),
      );

      const text = html(await GalleryPage());

      expect(text).toContain('Used by 2 leagues, 1 phase.');
      expect(text).toContain('Not used by a league or phase yet.');
      expect(mocks.countPinsByDefinition).toHaveBeenCalledTimes(1);
      expect([...mocks.countPinsByDefinition.mock.calls[0][0]].sort()).toEqual(['a', 'c']);
    });

    it('flag a version computed from older catalog data, and only that', async () => {
      lists([
        { ...summary({ id: 'old' }), current_version: head({ catalog_version: 'catalog-before' }) },
        { ...summary({ id: 'fresh' }), current_version: head() },
        { ...summary({ id: 'blank' }), current_version: head({ catalog_version: 'catalog-before', base_preset: null }) },
      ]);

      const text = html(await GalleryPage());

      expect(text.match(/Catalog updated/g)).toHaveLength(1);
      expect(text).toContain('publish it again');
    });

    it('speak German', async () => {
      mocks.locale = 'de';
      lists([{ ...summary({ id: 'a' }), current_version: head({ catalog_version: 'catalog-before' }) }]);
      mocks.countPinsByDefinition.mockResolvedValue(new Map([['a', { seasons: 1, tournaments: 2 }]]));

      const text = html(await GalleryPage());

      expect(text).toContain('Genutzt von 1 Liga, 2 Phasen.');
      expect(text).toContain('Katalog aktualisiert');
    });
  });

  it('hides the league section when no league owns a ruleset, and lists every catalog preset card', async () => {
    const tree = await GalleryPage();
    expect(html(tree)).not.toContain('League rulesets');
    const lists = findByType(expandView<RulesetsGalleryViewProps>(tree, RulesetsGalleryView), PresetLibraryList);
    const count = lists.reduce((sum, list) => sum + (list.props.presets as unknown[]).length, 0);
    expect(count).toBeGreaterThan(60);
  });
});

describe.each([
  ['edit page', (id: string) => EditPage(params(id))],
  ['read-only page', (id: string) => DetailPage(params(id))],
])('%s: the gate', (_name, call) => {
  it('a malformed id is a 404 before any auth or data read', async () => {
    await expect(call('not-a-uuid')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getLiveAccess).not.toHaveBeenCalled();
    for (const read of reads()) expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ['signed out', null],
    ['not an admin', access({})],
    ['an admin flag without a player', { ...access({ isAnyAdmin: true }), player: null }],
  ])('%s: AdminGuard alone decides and nothing is read', async (_who, live) => {
    mocks.getLiveAccess.mockResolvedValue(live);
    const tree = await call(ID);
    expect(findByType(tree, AdminGuard)).toHaveLength(1);
    expect(findByType(tree, RulesetEditor)).toHaveLength(0);
    for (const read of reads()) expect(read).not.toHaveBeenCalled();
  });

  it('an unknown id is a 404', async () => {
    mocks.getRulesetDefinitionMeta.mockResolvedValue(null);
    await expect(call(ID)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getRulesetDetail).not.toHaveBeenCalled();
  });

  it("another admin's private ruleset gets the forbidden notice and no draft is read", async () => {
    mocks.getRulesetDefinitionMeta.mockResolvedValue(meta({ owner_id: 'p2' }));
    const tree = await call(ID);
    const notice = findByType(tree, ResourceForbidden);
    expect(notice).toHaveLength(1);
    expect(html(notice[0].props.children as ReactNode)).toBe('You are not allowed to see this ruleset.');
    expect(mocks.getRulesetDetail).not.toHaveBeenCalled();
  });

  it('the forbidden notice is in German for a German viewer', async () => {
    mocks.locale = 'de';
    mocks.getRulesetDefinitionMeta.mockResolvedValue(meta({ owner_id: 'p2' }));
    const tree = await call(ID);
    expect(html(findByType(tree, ResourceForbidden)[0].props.children as ReactNode)).toContain('nicht sehen');
  });
});

describe('edit page', () => {
  it('a ruleset shared by someone else is read, not edited: redirect to the read-only page, nothing read', async () => {
    mocks.getRulesetDefinitionMeta.mockResolvedValue(meta({ owner_id: 'p2', visibility: 'league' }));
    await expect(EditPage(params(ID))).rejects.toThrow(`NEXT_REDIRECT:/admin/rulesets/${ID}`);
    expect(mocks.getRulesetDetail).not.toHaveBeenCalled();
  });

  it('the owner gets the editor with the props of the contract and the base preset resolved on the server', async () => {
    mocks.getRulesetDetail.mockResolvedValue(detail({ published: published() }));
    const tree = await EditPage(params(ID));
    const editor = findByType(tree, RulesetEditor);
    expect(editor).toHaveLength(1);
    const props = editor[0].props as Record<string, unknown>;
    expect(props).toMatchObject({
      definitionId: ID,
      initial: { document: draftDoc(), draftRev: 3 },
      published: { versionNo: 2, contentHash: 'hash-2', resolvedHash: 'resolved-2' },
      actor: { playerId: 'p1', isAdmin: false, leagueIds: [] },
    });
    expect(props.initialPreset).toMatchObject({ id: 'gen9ou', gen: 9 });
  });

  it('an unpublished ruleset passes published as null; a blank base passes no preset', async () => {
    mocks.getRulesetDetail.mockResolvedValue(detail({ draft: { document: newRulesetDocument('Blank', 'en'), draft_rev: 1 } }));
    const tree = await EditPage(params(ID));
    expect(findByType(tree, RulesetEditor)[0].props.published).toBeNull();
    expect(findByType(tree, RulesetEditor)[0].props.initialPreset).toBeNull();
  });

  it('the props carry no owner id and no player row', async () => {
    const tree = await EditPage(params(ID));
    const serialised = JSON.stringify(findByType(tree, RulesetEditor)[0].props);
    expect(serialised).not.toContain('owner_id');
    expect(serialised).not.toContain('discord_id');
    expect(serialised).not.toContain('secret');
  });

  it("a site admin edits another owner's private ruleset", async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true, playerId: 'p9' }));
    mocks.getRulesetDefinitionMeta.mockResolvedValue(meta({ owner_id: 'p2' }));
    const tree = await EditPage(params(ID));
    expect(findByType(tree, RulesetEditor)[0].props.actor).toMatchObject({ playerId: 'p9', isAdmin: true });
  });

  it('a draft that is not there is a 404', async () => {
    mocks.getRulesetDetail.mockResolvedValue(detail({ draft: null }));
    await expect(EditPage(params(ID))).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('read-only page', () => {
  it('writes the rules of the published version in the viewer’s language and offers the editor to those who may edit', async () => {
    mocks.getRulesetDetail.mockResolvedValue(detail({ published: published(), definition: summary({ current_version: { version_no: 2 } }) }));
    const english = html(await DetailPage(params(ID)));
    expect(english).toContain('My OU');
    expect(english).toContain('1 Pokémon is banned: Koraidon.');
    expect(english).toContain(`/admin/rulesets/${ID}/edit`);
    mocks.locale = 'de';
    const german = html(await DetailPage(params(ID)));
    expect(german).toContain('1 Pokémon ist gebannt: Koraidon.');
  });

  it('a published ruleset shows where it is used, for the tier of the viewer, and moves to the newest version', async () => {
    mocks.getRulesetDefinitionMeta.mockResolvedValue(meta({ current_version_id: 'v1' }));
    mocks.getRulesetDetail.mockResolvedValue(detail({ published: published(), definition: summary({ current_version: { version_no: 2 } }) }));
    const tree = await DetailPage(params(ID));
    const [usage] = findByType(expandView<RulesetPageViewProps>(tree, RulesetPageView), UsagePanel);
    expect(usage.props).toMatchObject({ definitionId: ID, latestVersionNo: 2, usage: { counts: [{ version_no: 2, seasons: 1, tournaments: 0 }], targets: null } });
    // The usage is read for the live actor and the definition the gate found.
    expect(mocks.listUsage).toHaveBeenCalledWith(expect.objectContaining({ playerId: 'p1' }), expect.objectContaining({ id: ID }));
  });

  describe('the version list', () => {
    const row = (no: number, over: Record<string, unknown> = {}) => ({
      id: `v${no}`, version_no: no, schema_version: 1, name_text: 'My OU', content_hash: 'h', resolved_hash: 'r', catalog_version: 'catalog-now', base_preset: 'gen9ou',
      gen: 9, format_key: 'gen9ou', is_doubles: false, changelog: null, created_by: 'p1', created_at: '2026-10-02T10:00:00Z', ...over,
    });
    const none = { banned: 0, unbanned: 0, allowed: 0, disallowed: 0, clausesAdded: 0, clausesRemoved: 0, modeChanged: false, otherChanged: false };

    it('says what each version changed against the one before, from the change summaries of the frozen rules', async () => {
      mocks.getRulesetDetail.mockResolvedValue(detail({ published: published(), versions: [row(3), row(2), row(1)] }));
      mocks.getVersionChanges.mockResolvedValue(new Map([[3, { ...none, banned: 3, unbanned: 1 }], [2, none], [1, null]]));

      const text = html(await DetailPage(params(ID)));

      expect(text).toContain('Compared with version 2: 3 more banned, 1 no longer banned.');
      expect(text).toContain('The same rules as version 1.');
      expect(text).toContain('The first version.');
      expect(mocks.getVersionChanges).toHaveBeenCalledWith(ID, expect.arrayContaining([expect.objectContaining({ version_no: 3 })]));
    });

    it('prints no comparison for a version the summaries did not cover (an old one)', async () => {
      mocks.getRulesetDetail.mockResolvedValue(detail({ published: published(), versions: [row(2), row(1)] }));
      mocks.getVersionChanges.mockResolvedValue(new Map([[2, { ...none, banned: 1 }]]));

      const text = html(await DetailPage(params(ID)));

      expect(text).toContain('Compared with version 1: 1 more banned.');
      expect(text).not.toContain('The first version.');
    });

    it('marks a version computed from older catalog data', async () => {
      mocks.getRulesetDetail.mockResolvedValue(detail({ published: published(), versions: [row(2, { catalog_version: 'catalog-before' }), row(1, { catalog_version: 'catalog-before', base_preset: null })] }));

      const text = html(await DetailPage(params(ID)));

      expect(text.match(/Catalog updated since/g)).toHaveLength(1);
    });

    it('speaks German', async () => {
      mocks.locale = 'de';
      mocks.getRulesetDetail.mockResolvedValue(detail({ published: published(), versions: [row(2, { catalog_version: 'catalog-before' }), row(1)] }));
      mocks.getVersionChanges.mockResolvedValue(new Map([[2, { ...none, banned: 2 }], [1, null]]));

      const text = html(await DetailPage(params(ID)));

      expect(text).toContain('Gegenüber Version 1: 2 mehr gebannt.');
      expect(text).toContain('Die erste Version.');
      expect(text).toContain('Katalog seither aktualisiert');
    });
  });

  it('a ruleset with no published version has no usage to show and reads none', async () => {
    const tree = await DetailPage(params(ID));
    expect(findByType(tree, UsagePanel)).toHaveLength(0);
    expect(mocks.listUsage).not.toHaveBeenCalled();
  });

  it('shows the saved draft of a ruleset that is not published, marked as such', async () => {
    const text = html(await DetailPage(params(ID)));
    expect(text).toContain('This is the saved draft. It is not published.');
  });

  it('names the base preset of the saved draft, and a blank base only for a draft that starts blank', async () => {
    const preset = html(await DetailPage(params(ID)));
    expect(preset).toContain('Starts from the');
    expect(preset).not.toContain('Starts from a blank base.');
    mocks.getRulesetDetail.mockResolvedValue(detail({ draft: { document: newRulesetDocument('Blank', 'en'), draft_rev: 1 } }));
    expect(html(await DetailPage(params(ID)))).toContain('Starts from a blank base.');
  });

  it('hides the editor link and the version list from a viewer who may only read', async () => {
    mocks.getRulesetDefinitionMeta.mockResolvedValue(meta({ owner_id: 'p2', visibility: 'league' }));
    mocks.getRulesetDetail.mockResolvedValue(detail({ published: published(), draft: null, versions: [] }));
    const text = html(await DetailPage(params(ID)));
    expect(text).not.toContain('/edit');
    expect(text).not.toContain('Versions');
  });
});

describe('the catalog preset page', () => {
  const call = (presetId: string) => PresetPage({ params: Promise.resolve({ presetId }) });

  it('an unknown preset is a 404 before the viewer is read', async () => {
    await expect(call('gen99zz')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getLiveAccess).not.toHaveBeenCalled();
  });

  it('a non-admin gets the guard', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({}));
    expect(findByType(await call('gen9ou'), AdminGuard)).toHaveLength(1);
  });

  it('shows the rules the preset implies and one start; a draft preset with tour extras gets a second', async () => {
    const plain = await call('gen9ou');
    expect(html(plain)).toContain('Species Clause');
    expect(findByType(plain, ForkPresetButton)).toHaveLength(1);
    const draft = await call('gen9natdexdraft');
    expect(findByType(draft, ForkPresetButton)).toHaveLength(2);
    expect(findByType(draft, ForkPresetButton)[1].props.tourOverlay).toBe(true);
  });
});

describe('the old new address', () => {
  it('leads to the gallery, where the New ruleset dialog is', () => {
    expect(() => NewPage()).toThrow('NEXT_REDIRECT:/admin/rulesets');
  });
});
