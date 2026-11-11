/**
 * The league create page (the new-competition wizard). The viewer is read live and nothing is read before they are known
 * to be an admin. The clone sources are scoped: a site admin may start from any league, a resource admin only from their
 * own (never an unscoped list). Only names, counts and ids reach the wizard: no owner id, no format spec, no player data.
 * \`?preset\` and \`?format\` open the wizard with that starting point picked.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveLText } from '@/lib/studio-core/ltext';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'de',
  getLiveAccess: vi.fn(),
  getAdminSeasonIds: vi.fn(),
  listRulesetOptionsFor: vi.fn(),
  listCloneSourceOptions: vi.fn(),
  loadAttachCandidates: vi.fn(),
}));

function stub(name: string) {
  const C = function Stub({ children }: { children?: ReactNode }) {
    return children ?? null;
  };
  Object.defineProperty(C, 'name', { value: name });
  return { default: C };
}

vi.mock('server-only', () => ({}));
vi.mock('@/i18n/server', () => ({ getLocale: async () => mocks.locale }));
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ listRulesetOptionsFor: mocks.listRulesetOptionsFor }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ getAdminSeasonIds: mocks.getAdminSeasonIds }));
vi.mock('@/lib/supabase/queries/season-clone', () => ({ listCloneSourceOptions: mocks.listCloneSourceOptions }));
vi.mock('@/lib/format-studio/attach-candidates', () => ({ loadAttachCandidates: mocks.loadAttachCandidates }));
vi.mock('@/lib/format-studio/loader', async () => {
  const { PRESETS, compile } = await import('@/lib/format-kit/client');
  const { toFormatView } = await import('@/lib/format-studio/view');
  return { presetViews: () => PRESETS.map((p) => ({ id: p.id, view: toFormatView(compile(p.definition)) })) };
});
vi.mock('@/components/shared/AdminGuard', () => stub('AdminGuard'));
vi.mock('@/components/league/wizard/NewCompetitionHeader', () => stub('NewCompetitionHeader'));
vi.mock('@/components/league/wizard/NewCompetitionWizard', () => stub('NewCompetitionWizard'));

import NewLeaguePage from '../page';
import AdminGuard from '@/components/shared/AdminGuard';
import NewCompetitionHeader from '@/components/league/wizard/NewCompetitionHeader';
import NewCompetitionWizard from '@/components/league/wizard/NewCompetitionWizard';
import { PRESETS } from '@/lib/format-kit/client';

type El = ReactElement<Record<string, unknown>>;

function findByType(node: ReactNode, type: unknown): El[] {
  const found: El[] = [];
  const visit = (n: ReactNode): void => {
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (isValidElement<Record<string, unknown>>(n)) {
      if (n.type === type) found.push(n);
      visit(n.props.children as ReactNode);
    }
  };
  visit(node);
  return found;
}

function access(flags: { isSiteAdmin?: boolean; isAnyAdmin?: boolean }, player: object | null = { playerId: 'p1' }) {
  return { player, isSiteAdmin: false, isAnyAdmin: false, isCreator: false, ...flags };
}

const option = {
  id: 's2',
  name: 'Other League',
  format_type: 'singles',
  status: 'completed',
  archived: true,
  is_test_season: false,
  ruleset_id: null,
  route_theme: 'auto',
  language: 'de',
  description: '',
  phase_count: 2,
  participant_count: 9,
};

const FORMAT_ID = '33333333-3333-4333-8333-333333333333';
const candidate = {
  id: FORMAT_ID,
  slug: 'autumn-cup',
  name: { base: 'en', en: { v: 'Autumn Cup', s: 'human' } },
  version_no: 3,
  content_hash: 'secret-hash',
  visibility: 'league',
  ownerName: 'Sam',
  mine: false,
};

const allReads = () => [mocks.getAdminSeasonIds, mocks.listRulesetOptionsFor, mocks.listCloneSourceOptions, mocks.loadAttachCandidates];

const wizard = (tree: ReactNode) => findByType(tree, NewCompetitionWizard)[0];
const render = (query?: { preset?: string | string[]; format?: string | string[] }) =>
  NewLeaguePage({ searchParams: query === undefined ? undefined : Promise.resolve(query) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = 'en';
  mocks.listRulesetOptionsFor.mockResolvedValue([]);
  mocks.listCloneSourceOptions.mockResolvedValue([option]);
  mocks.getAdminSeasonIds.mockResolvedValue(['s2']);
  mocks.loadAttachCandidates.mockResolvedValue({ items: [candidate], capped: false });
});

describe('new league page: the gate and the reads', () => {
  it.each([
    ['signed out', null],
    ['not an admin', access({})],
    ['an admin identity without a player', access({ isAnyAdmin: true }, null)],
  ])('%s: the guard only, no reads', async (_label, live) => {
    mocks.getLiveAccess.mockResolvedValue(live);

    const tree = await render({ preset: 'cup' });

    expect(isValidElement(tree) && tree.type).toBe(AdminGuard);
    expect(findByType(tree, NewCompetitionWizard)).toEqual([]);
    expect(findByType(tree, NewCompetitionHeader)).toEqual([]);
    for (const read of allReads()) expect(read).not.toHaveBeenCalled();
  });

  it('site admin: every league may be a source (no scope), and may copy the admins', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));

    const tree = await render();

    expect(mocks.listCloneSourceOptions).toHaveBeenCalledTimes(1);
    expect(mocks.listCloneSourceOptions).toHaveBeenCalledWith(null);
    // The ruleset select lists the viewer's own private rulesets next to the shared ones, none that belong to a league, and the
    // pin of every league that can be a source (a clone takes the pin over, even an older version).
    expect(mocks.listRulesetOptionsFor).toHaveBeenCalledWith({ actor: { playerId: 'p1', isAdmin: true }, seasonId: null, keep: [option.ruleset_id] });
    expect(mocks.getAdminSeasonIds).not.toHaveBeenCalled();
    expect(mocks.loadAttachCandidates).toHaveBeenCalledWith({ playerId: 'p1' });
    expect(wizard(tree).props.isSiteAdmin).toBe(true);
    expect(wizard(tree).props.sources).toEqual([option]);
  });

  it('resource admin: only the leagues they administer, never an unscoped list', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.getAdminSeasonIds.mockResolvedValue(['s2', 's7']);

    const tree = await render();

    expect(mocks.getAdminSeasonIds).toHaveBeenCalledWith('p1');
    expect(mocks.listCloneSourceOptions).toHaveBeenCalledWith(['s2', 's7']);
    expect(mocks.listCloneSourceOptions).not.toHaveBeenCalledWith(null);
    expect(mocks.listRulesetOptionsFor).toHaveBeenCalledWith({ actor: { playerId: 'p1', isAdmin: false }, seasonId: null, keep: [option.ruleset_id] });
    expect(wizard(tree).props.isSiteAdmin).toBe(false);
  });

  it('a resource admin without leagues is scoped to the empty list, not to everything', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.getAdminSeasonIds.mockResolvedValue([]);
    mocks.listCloneSourceOptions.mockResolvedValue([]);

    const tree = await render();

    expect(mocks.listCloneSourceOptions).toHaveBeenCalledWith([]);
    expect(wizard(tree).props.sources).toEqual([]);
  });

  it('renders the league header above the wizard, inside the guard', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));

    const tree = await render();

    expect(isValidElement(tree) && tree.type).toBe(AdminGuard);
    expect(findByType(tree, NewCompetitionHeader)[0].props.kind).toBe('league');
    expect(findByType(tree, NewCompetitionWizard)).toHaveLength(1);
  });
});

describe('new league page: what reaches the client', () => {
  it('hands the client only lean option rows, no player data', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));

    const tree = await render();
    const rows = JSON.parse(JSON.stringify(wizard(tree).props.sources)) as Record<string, unknown>[];

    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(Object.keys(option).sort());
    expect(JSON.stringify(rows)).not.toMatch(/players|discord|email|auth_user/);
  });

  it('hands the wizard exactly its five props: no session, no player, no owner id', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));

    const tree = await render();

    expect(Object.keys(wizard(tree).props).sort()).toEqual(['examples', 'formats', 'initialStart', 'isSiteAdmin', 'rulesets', 'sources']);
  });

  it('lists the four shipped examples as names, one-line details and counts', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));

    const tree = await render();
    const examples = wizard(tree).props.examples as Record<string, unknown>[];

    expect(examples.map((e) => e.id)).toEqual(['classic-league', 'cup', 'swiss-top-cut', 'wichtelcup']);
    // The league's own ruleset is needed by the examples whose stages play under it; Wichtelcup brings its own.
    expect(examples.map((e) => [e.id, e.needsLeagueRuleset, e.presetRulesetCount])).toEqual([
      ['classic-league', true, 0],
      ['cup', true, 0],
      ['swiss-top-cut', true, 0],
      ['wichtelcup', false, 1],
    ]);
    for (const example of examples) {
      expect(Object.keys(example).sort()).toEqual(['id', 'needsLeagueRuleset', 'overview', 'presetRulesetCount', 'stages', 'summary', 'title']);
      expect(typeof example.title).toBe('string');
      expect((example.title as string).length).toBeGreaterThan(0);
      expect(typeof example.needsLeagueRuleset).toBe('boolean');
      expect(Number.isInteger(example.presetRulesetCount)).toBe(true);
      const stages = example.stages as Record<string, unknown>[];
      expect(stages.length).toBeGreaterThan(0);
      for (const stage of stages) {
        expect(Object.keys(stage).sort()).toEqual(['detail', 'key', 'name']);
        expect((stage.name as string).length).toBeGreaterThan(0);
      }
    }
    expect(JSON.stringify(examples)).not.toMatch(/"(definition|spec|plan|rulesets|modules)"/);
  });

  it.each(['en', 'de'] as const)('titles the examples in the viewer language (%s)', async (locale) => {
    mocks.locale = locale;
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));

    const tree = await render();

    expect((wizard(tree).props.examples as { title: string }[]).map((e) => e.title)).toEqual(
      PRESETS.map((p) => resolveLText(p.definition.identity.name, { viewer: locale })?.value),
    );
  });

  it('maps the attachable formats to id, name, version, owner name and the mine flag, nothing else', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.loadAttachCandidates.mockResolvedValue({
      items: [candidate, { ...candidate, id: 'f2', slug: 'my-cup', name: { base: 'en', en: { v: 'My Cup', s: 'human' } }, version_no: 1, ownerName: null, mine: true }],
      capped: false,
    });

    const tree = await render();
    const formats = wizard(tree).props.formats as Record<string, unknown>[];

    expect(formats).toEqual([
      { id: FORMAT_ID, name: 'Autumn Cup', version: 3, ownerName: 'Sam', mine: false },
      { id: 'f2', name: 'My Cup', version: 1, ownerName: null, mine: true },
    ]);
    expect(JSON.stringify(formats)).not.toMatch(/secret-hash|visibility|content_hash|slug/);
  });

  it('names a format with no readable name by its slug', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.loadAttachCandidates.mockResolvedValue({ items: [{ ...candidate, name: { base: 'en' } }], capped: false });

    const tree = await render();

    expect((wizard(tree).props.formats as { name: string }[])[0].name).toBe('autumn-cup');
  });
});

describe('new league page: ?preset and ?format', () => {
  beforeEach(() => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
  });

  it('picks nothing without a query', async () => {
    expect(wizard(await render()).props.initialStart).toBeNull();
    expect(wizard(await render({})).props.initialStart).toBeNull();
  });

  it.each(['classic-league', 'cup', 'swiss-top-cut', 'wichtelcup'])('?preset=%s picks that example', async (id) => {
    expect(wizard(await render({ preset: id })).props.initialStart).toEqual({ kind: 'preset', id });
  });

  it('?format picks a format the viewer may attach', async () => {
    expect(wizard(await render({ format: FORMAT_ID })).props.initialStart).toEqual({ kind: 'format', id: FORMAT_ID });
  });

  it('picks nothing for an unknown preset or a format the viewer may not attach', async () => {
    expect(wizard(await render({ preset: 'nope' })).props.initialStart).toBeNull();
    expect(wizard(await render({ format: '44444444-4444-4444-8444-444444444444' })).props.initialStart).toBeNull();
  });

  it('takes the first value of a repeated parameter', async () => {
    expect(wizard(await render({ preset: ['cup', 'nope'] })).props.initialStart).toEqual({ kind: 'preset', id: 'cup' });
    expect(wizard(await render({ preset: ['nope', 'cup'] })).props.initialStart).toBeNull();
  });

  it('the preset wins when both are named', async () => {
    expect(wizard(await render({ preset: 'cup', format: FORMAT_ID })).props.initialStart).toEqual({ kind: 'preset', id: 'cup' });
  });
});
