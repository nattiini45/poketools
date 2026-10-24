import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fullPlayerRow, expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import { epbPack, formatPack } from '@/lib/format-pack';
import { LEAGUE_ADMIN_TABS, type LeagueAdminTab } from '@/lib/league-admin/tabs';

// ─── Mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'de',
  getLiveAccess: vi.fn(),
  isResourceAdminFor: vi.fn(),
  getSeasonWithDetails: vi.fn(),
  getSeasonParticipants: vi.fn(),
  listRulesets: vi.fn(),
  getDraftPoolBySeason: vi.fn(),
  getDraftPoolsBySeason: vi.fn(),
  getFormatRules: vi.fn(),
  getSeasonGroups: vi.fn(),
  getDraftPoolsBySeasonWithGroups: vi.fn(),
  getListEntries: vi.fn(),
  loadPublishRefusals: vi.fn(),
  getSeasonPhaseStartSignals: vi.fn(),
}));

function stub(name: string) {
  const C = function Stub({ children }: { children?: ReactNode }) {
    return children ?? null;
  };
  Object.defineProperty(C, 'name', { value: name });
  return { default: C };
}

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/link', () => stub('Link'));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  const { createFormatter } = await import('@/i18n/format');
  return {
    getLocale: async () => mocks.locale,
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, mocks.locale),
    getFormatter: async () => createFormatter({ locale: mocks.locale, timeZone: 'Europe/Berlin' }),
  };
});
// The page decides site-admin parts from the live access read only; the session copy is not imported.
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonWithDetails: mocks.getSeasonWithDetails,
  getSeasonParticipants: mocks.getSeasonParticipants,
}));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: mocks.isResourceAdminFor }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ listRulesets: mocks.listRulesets }));
vi.mock('@/lib/supabase/queries/season-start', () => ({
  getSeasonPhaseStartSignals: mocks.getSeasonPhaseStartSignals,
}));
vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolBySeason: mocks.getDraftPoolBySeason,
  getDraftPoolsBySeason: mocks.getDraftPoolsBySeason,
  getDraftPoolsBySeasonWithGroups: mocks.getDraftPoolsBySeasonWithGroups,
}));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroups: mocks.getSeasonGroups }));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({ getListEntries: mocks.getListEntries }));
vi.mock('../draft/_lib/load', () => ({ loadPublishRefusals: mocks.loadPublishRefusals }));
vi.mock('@/components/league/groups/LeagueGroupsEditor', () => stub('LeagueGroupsEditor'));
vi.mock('@/i18n/LocalTime', () => ({ LocalTime: stub('LocalTime').default }));
vi.mock('@/lib/supabase/queries/format-rules', () => ({ getFormatRules: mocks.getFormatRules }));
vi.mock('@/components/shared/AdminGuard', () => stub('AdminGuard'));
vi.mock('@/components/shared/ResourceForbidden', () => stub('ResourceForbidden'));
vi.mock('@/components/ui/PageContainer', () => stub('PageContainer'));
vi.mock('@/components/ui/Section', () => stub('Section'));
vi.mock('@/components/ui/Badge', () => stub('Badge'));
vi.mock('@/components/league/LeagueRosterManager', () => stub('LeagueRosterManager'));
vi.mock('@/components/league/CoreLigaManager', () => stub('CoreLigaManager'));
vi.mock('@/components/league/PhaseTimeline', () => stub('PhaseTimeline'));
vi.mock('@/components/shared/ResourceAdminManager', () => stub('ResourceAdminManager'));
vi.mock('@/components/shared/ArchiveButton', () => stub('ArchiveButton'));
vi.mock('@/components/shared/DeleteResourceButton', () => stub('DeleteResourceButton'));
vi.mock('@/components/league/LeagueStatusControl', () => stub('LeagueStatusControl'));
vi.mock('@/components/league/LeagueThemeControl', () => stub('LeagueThemeControl'));
vi.mock('@/components/league/LeagueSettingsForm', () => stub('LeagueSettingsForm'));
vi.mock('@/components/league/LeagueTestFlagControl', () => stub('LeagueTestFlagControl'));
vi.mock('@/components/shared/EditableDescription', () => stub('EditableDescription'));
vi.mock('@/components/league/EvolutionTierEditor', () => stub('EvolutionTierEditor'));
vi.mock('@/components/league/DraftTierLimitsEditor', () => stub('DraftTierLimitsEditor'));
vi.mock('@/components/draft/DraftPoolManager', () => stub('DraftPoolManager'));
vi.mock('@/components/league/DraftPoolEditor', () => stub('DraftPoolEditor'));
vi.mock('@/components/league/PointBuyListManager', () => stub('PointBuyListManager'));
vi.mock('@/components/league/FormatRulesEditor', () => stub('FormatRulesEditor'));
vi.mock('@/components/league/EpbImportPanel', () => stub('EpbImportPanel'));
vi.mock('@/components/league/EvolutionPointRecalcButton', () => stub('EvolutionPointRecalcButton'));
vi.mock('@/components/draft-admin/TokenAdminSummary', () => stub('TokenAdminSummary'));
vi.mock('@/components/league/hub/HubTabStripScroll', () => stub('HubTabStripScroll'));
vi.mock('../_components/AdminTabPending', () => stub('AdminTabPending'));
vi.mock('../_components/ContentLanguageControl', () => stub('ContentLanguageControl'));
vi.mock('../_components/EpbDraftRoomCreate', () => stub('EpbDraftRoomCreate'));

import AdminLeagueDetailPage from '../page';
import Link from 'next/link';
import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import Section from '@/components/ui/Section';
import DraftPoolManager from '@/components/draft/DraftPoolManager';
import TokenAdminSummary from '@/components/draft-admin/TokenAdminSummary';
import EvolutionTierEditor from '@/components/league/EvolutionTierEditor';
import FormatRulesEditor from '@/components/league/FormatRulesEditor';
import ContentLanguageControl from '../_components/ContentLanguageControl';
import LeagueThemeControl from '@/components/league/LeagueThemeControl';
import LeagueSettingsForm from '@/components/league/LeagueSettingsForm';
import LeagueTestFlagControl from '@/components/league/LeagueTestFlagControl';
import LeagueStatusControl from '@/components/league/LeagueStatusControl';
import EditableDescription from '@/components/shared/EditableDescription';
import ResourceAdminManager from '@/components/shared/ResourceAdminManager';
import ArchiveButton from '@/components/shared/ArchiveButton';
import DeleteResourceButton from '@/components/shared/DeleteResourceButton';
import PhaseTimeline from '@/components/league/PhaseTimeline';
import EpbDraftRoomCreate from '../_components/EpbDraftRoomCreate';
import LeagueAdminTabs from '../_components/LeagueAdminTabs';

/** The league id: a uuid, since the page answers 404 for any other `[id]`. */
const S1 = '5e150000-0000-4000-8000-000000000001';

// ─── Helpers ────────────────────────────────────────────────────────

type El = ReactElement<Record<string, unknown>>;

function walk(node: ReactNode, visit: (el: El) => void): void {
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n as ReactNode, visit));
    return;
  }
  if (isValidElement<Record<string, unknown>>(node)) {
    visit(node);
    walk(node.props.children as ReactNode, visit);
    if (node.props.action) walk(node.props.action as ReactNode, visit);
  }
}

function findByType(node: ReactNode, type: unknown): El[] {
  const found: El[] = [];
  walk(node, (el) => {
    if (el.type === type) found.push(el);
  });
  return found;
}

function sectionTitles(node: ReactNode): string[] {
  return findByType(node, Section).map((s) => String(s.props.title));
}

function sectionTitled(node: ReactNode, title: string): El | undefined {
  return findByType(node, Section).find((s) => s.props.title === title);
}

/** Every string a viewer sees, joined with `sep`: string children plus title/subtitle props. */
function visibleText(node: ReactNode, sep = ' | '): string {
  const out: string[] = [];
  const collect = (n: ReactNode): void => {
    if (typeof n === 'string' || typeof n === 'number') out.push(String(n));
    else if (Array.isArray(n)) n.forEach((c) => collect(c as ReactNode));
    else if (isValidElement<Record<string, unknown>>(n)) {
      for (const k of ['title', 'subtitle', 'pendingMessage'] as const) {
        if (typeof n.props[k] === 'string') out.push(n.props[k] as string);
      }
      collect(n.props.children as ReactNode);
      if (n.props.action) collect(n.props.action as ReactNode);
    }
  };
  collect(node);
  return out.join(sep);
}

/** Running text, rich-text links included (`t.rich` splits a sentence around its `<link>`). */
const plainText = (node: ReactNode) => visibleText(node, '');

function season(overrides: Record<string, unknown> = {}) {
  return {
    id: S1,
    name: 'Summer League S3',
    format_type: 'evolution_point_buy',
    ruleset_name: 'Reg H',
    ruleset_id: 'rs-1',
    archived: false,
    is_test_season: false,
    status: 'active',
    description: 'House rules',
    route_theme: 'auto',
    point_buy_list_id: 'list-1',
    language: 'de',
    participant_count: 2,
    tournament_count: 3,
    start_date: '2026-09-01',
    end_date: '2026-12-15',
    ...overrides,
  };
}

async function render(tab?: string | string[], id = S1): Promise<ReactNode> {
  const query = tab === undefined ? {} : { tab };
  return AdminLeagueDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) });
}

function tabsOf(tree: ReactNode): El {
  const [nav] = findByType(tree, LeagueAdminTabs);
  expect(nav).toBeDefined();
  return nav;
}

/** The tab panel region: the element carrying `data-admin-panel`. */
function panelOf(tree: ReactNode): El {
  let panel: El | undefined;
  walk(tree, (el) => {
    if (el.props['data-admin-panel'] !== undefined) panel = el;
  });
  expect(panel).toBeDefined();
  return panel as El;
}

const TAB_READS = [
  'getSeasonParticipants',
  'listRulesets',
  'getSeasonGroups',
  'getDraftPoolBySeason',
  'getDraftPoolsBySeason',
  'getDraftPoolsBySeasonWithGroups',
  'getFormatRules',
  'getListEntries',
  'getSeasonPhaseStartSignals',
] as const;

/** The tab-specific reads this render made (the league row and the live access read are shared). */
function tabReads(): string[] {
  return TAB_READS.filter((name) => mocks[name].mock.calls.length > 0);
}

const PARTICIPANTS = [
  { ...fullPlayerRow({ id: 'p1', name: 'Mara' }), gym_type: null, core_types: null, core_assigned_at: null },
  { ...fullPlayerRow({ id: 'p2', name: 'Misty' }), gym_type: null, core_types: null, core_assigned_at: null },
];

function liveAccess(overrides: Partial<{ isSiteAdmin: boolean; isAnyAdmin: boolean }> = {}) {
  return { player: { playerId: 'u1' }, isSiteAdmin: true, isAnyAdmin: true, isCreator: true, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = 'en';
  mocks.getLiveAccess.mockResolvedValue(liveAccess());
  mocks.isResourceAdminFor.mockResolvedValue(true);
  mocks.getSeasonWithDetails.mockResolvedValue(season());
  mocks.getSeasonParticipants.mockResolvedValue(PARTICIPANTS);
  mocks.listRulesets.mockResolvedValue([]);
  mocks.getDraftPoolBySeason.mockResolvedValue({ id: 'pool-1', draft_type: 'budget', pick_order: 'free', status: 'in_progress' });
  mocks.getDraftPoolsBySeason.mockResolvedValue([
    { id: 'pool-1', kind: 'initial', phase: 'complete', mode: 'live', status: 'complete' },
  ]);
  mocks.getFormatRules.mockResolvedValue({ comeback_spend_open: true });
  // A league without groups (the default): the Draft tab reads its groups first and finds none.
  mocks.getSeasonGroups.mockResolvedValue([]);
  mocks.getDraftPoolsBySeasonWithGroups.mockResolvedValue([]);
  mocks.getListEntries.mockResolvedValue([]);
  mocks.loadPublishRefusals.mockResolvedValue({});
  mocks.getSeasonPhaseStartSignals.mockResolvedValue([]);
});

// ─── Tabs ───────────────────────────────────────────────────────────

describe('admin league page tabs (?tab=)', () => {
  it.each([
    ['singles', ['overview', 'participants', 'phases', 'settings', 'danger']],
    ['doubles', ['overview', 'participants', 'phases', 'settings', 'danger']],
    ['draft', ['overview', 'participants', 'draft', 'phases', 'rules', 'settings', 'danger']],
    ['evolution_point_buy', [...LEAGUE_ADMIN_TABS]],
  ])('%s: the tab strip shows the format’s tabs', async (format, expected) => {
    mocks.getSeasonWithDetails.mockResolvedValue(season({ format_type: format }));
    const nav = tabsOf(await render());
    expect(nav.props.tabs).toEqual(expected);
    expect(nav.props.activeTab).toBe('overview');
    expect(nav.props.leagueId).toBe(S1);
  });

  it('a bare URL opens the overview, which reads nothing beyond the league row', async () => {
    const tree = await render();
    expect(panelOf(tree).props['data-admin-panel']).toBe('overview');
    expect(panelOf(tree).props['aria-labelledby']).toBe('league-admin-tab-overview');
    expect(tabReads()).toEqual([]);
    expect(mocks.getSeasonWithDetails).toHaveBeenCalledTimes(1);
    expect(sectionTitles(tree)).toEqual(['At a glance', 'Description']);
    expect(findByType(tree, EditableDescription)[0].props).toEqual({
      resourceType: 'season',
      resourceId: S1,
      initialValue: 'House rules',
    });
  });

  it('the overview lists the league facts', async () => {
    const text = visibleText(await render());
    for (const fact of ['Evolution Point Buy', 'Reg H', 'Active', '2', '3']) expect(text).toContain(fact);
    expect(text).toMatch(/2026.*–.*2026/);
    expect(text).toContain('Open the public league page');
  });

  it.each([['nope'], ['DRAFT'], [['draft', 'rules']], ['']])('an invalid tab (%j) falls back to the overview', async (tab) => {
    const tree = await render(tab);
    expect(panelOf(tree).props['data-admin-panel']).toBe('overview');
    expect(tabsOf(tree).props.activeTab).toBe('overview');
    expect(tabReads()).toEqual([]);
  });

  it('a tab the format does not have falls back to the overview (singles has no draft or rules tab)', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season({ format_type: 'singles', point_buy_list_id: null }));
    for (const tab of ['draft', 'rules']) {
      vi.clearAllMocks();
      mocks.getLiveAccess.mockResolvedValue(liveAccess());
      mocks.getSeasonWithDetails.mockResolvedValue(season({ format_type: 'singles', point_buy_list_id: null }));
      const tree = await render(tab);
      expect(panelOf(tree).props['data-admin-panel'], tab).toBe('overview');
      expect(tabReads(), tab).toEqual([]);
    }
  });

  it.each<[string, LeagueAdminTab, string[], string[]]>([
    ['evolution_point_buy', 'participants', [], ['Participants', 'League groups']],
    [
      'evolution_point_buy',
      'draft',
      ['getSeasonGroups', 'getSeasonParticipants', 'getDraftPoolBySeason', 'getDraftPoolsBySeason', 'getFormatRules'],
      ['Draft Room', 'Redraft', 'Tokens'],
    ],
    ['evolution_point_buy', 'phases', ['listRulesets'], ['Phases', 'Evolution Points']],
    ['evolution_point_buy', 'rules', ['getSeasonPhaseStartSignals'], ['Point-Buy List', 'Format Rules', 'Data Import']],
    [
      'evolution_point_buy',
      'settings',
      ['listRulesets', 'getSeasonPhaseStartSignals'],
      ['League details', '3D World Theme', 'Content Language', 'Test League', 'League Admins'],
    ],
    ['evolution_point_buy', 'danger', [], ['Danger zone']],
    ['draft', 'participants', [], ['Participants', 'League groups', 'Type Cores (Core Liga)']],
    ['draft', 'draft', ['getSeasonGroups', 'getDraftPoolBySeason'], ['Draft Pool Pokémon', 'Draft Room']],
    ['draft', 'rules', ['getSeasonParticipants'], ['Evolution Tiers', 'Draft Settings']],
    ['singles', 'phases', ['listRulesets'], ['Phases']],
  ])('%s ?tab=%s renders only its panel and makes only its reads', async (format, tab, reads, titles) => {
    mocks.getSeasonWithDetails.mockResolvedValue(
      season({ format_type: format, point_buy_list_id: format === 'evolution_point_buy' ? 'list-1' : null }),
    );
    const tree = await render(tab);
    expect(panelOf(tree).props['data-admin-panel']).toBe(tab);
    expect(tabsOf(tree).props.activeTab).toBe(tab);
    expect(tabReads().sort()).toEqual([...reads].sort());
    expect(sectionTitles(tree)).toEqual(titles);
  });

  it('TokenAdminSummary renders on the draft tab only', async () => {
    for (const tab of LEAGUE_ADMIN_TABS) {
      const count = findByType(await render(tab), TokenAdminSummary).length;
      expect(count, tab).toBe(tab === 'draft' ? 1 : 0);
    }
  });

  it('the header (test badge, status control) is on every tab; archive and delete only on the danger tab', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season({ is_test_season: true }));
    for (const tab of LEAGUE_ADMIN_TABS) {
      const tree = await render(tab);
      expect(findByType(tree, LeagueStatusControl), tab).toHaveLength(1);
      expect(visibleText(tree), tab).toContain('Test');
      expect(findByType(tree, ArchiveButton).length, tab).toBe(tab === 'danger' ? 1 : 0);
      expect(findByType(tree, DeleteResourceButton).length, tab).toBe(tab === 'danger' ? 1 : 0);
    }
  });

  it('an old ?tab=schedule link opens the phases tab', async () => {
    const tree = await render('schedule');
    expect(panelOf(tree).props['data-admin-panel']).toBe('phases');
    expect(tabsOf(tree).props.activeTab).toBe('phases');
    expect(tabReads()).toEqual(['listRulesets']);
  });

  it('the phases tab is labelled Phases / Phasen', async () => {
    expect((tabsOf(await render()).props.labels as Record<string, string>).phases).toBe('Phases');
    mocks.locale = 'de';
    expect((tabsOf(await render()).props.labels as Record<string, string>).phases).toBe('Phasen');
  });

  it('German tab labels and landmark name', async () => {
    mocks.locale = 'de';
    const nav = tabsOf(await render());
    expect(nav.props.navLabel).toBe('Bereiche der Liga-Verwaltung');
    expect(nav.props.labels).toEqual({
      overview: 'Übersicht',
      participants: 'Teilnehmer',
      draft: 'Draft',
      phases: 'Phasen',
      rules: 'Regeln',
      settings: 'Einstellungen',
      danger: 'Gefahrenzone',
    });
  });
});

// ─── Live access ────────────────────────────────────────────────────

describe('site-admin parts follow the live access check', () => {
  it('a league admin (not a site admin): no test flag, league admins, phase delete or league delete', async () => {
    mocks.getLiveAccess.mockResolvedValue(liveAccess({ isSiteAdmin: false }));
    const settings = await render('settings');
    expect(findByType(settings, LeagueTestFlagControl)).toHaveLength(0);
    expect(findByType(settings, ResourceAdminManager)).toHaveLength(0);
    expect(sectionTitles(settings)).toEqual(['League details', '3D World Theme', 'Content Language']);

    const phases = await render('phases');
    expect(findByType(phases, PhaseTimeline)[0].props.canDelete).toBe(false);

    const danger = await render('danger');
    expect(findByType(danger, DeleteResourceButton)).toHaveLength(0);
    expect(findByType(danger, ArchiveButton)).toHaveLength(1);
    expect(visibleText(danger)).toContain('Only site admins can delete a league.');
    // The cascade list is for the people who can delete.
    expect(visibleText(danger)).not.toContain('together with');
    expect(mocks.isResourceAdminFor).toHaveBeenCalledWith('u1', 'season', S1);
  });

  it('an admin of another league: the forbidden notice, no header, tabs or tab data', async () => {
    for (const tab of LEAGUE_ADMIN_TABS) {
      vi.clearAllMocks();
      mocks.getLiveAccess.mockResolvedValue(liveAccess({ isSiteAdmin: false }));
      mocks.isResourceAdminFor.mockResolvedValue(false);
      mocks.getSeasonWithDetails.mockResolvedValue(season());
      const tree = await render(tab);
      expect((tree as El).type, tab).toBe(AdminGuard);
      expect(visibleText(tree), tab).toBe('Only admins of this league can open its admin page.');
      expect(findByType(tree, LeagueStatusControl), tab).toHaveLength(0);
      expect(findByType(tree, LeagueAdminTabs), tab).toHaveLength(0);
      expect(tabReads(), tab).toEqual([]);
      expect(mocks.isResourceAdminFor).toHaveBeenCalledWith('u1', 'season', S1);
    }
    mocks.locale = 'de';
    expect(visibleText(await render())).toBe('Nur Admins dieser Liga können ihre Admin-Seite öffnen.');
  });

  it('a site admin skips the per-league check', async () => {
    await render('settings');
    expect(mocks.isResourceAdminFor).not.toHaveBeenCalled();
  });

  it('the delete hint lists what the delete removes, what refuses it and what it keeps (en + de)', async () => {
    const text = visibleText(await render('danger'));
    expect(text).toContain('Deletes the league permanently, together with:');
    for (const part of [
      'its participants',
      'its league groups and their members',
      'its format rules, evolution tiers, tier limits and draft pool list',
      'every evolution record',
      'every token grant, Draft Kill Token purchase and Comeback Token spend',
      'every Redraft slot, submission, history entry and trade request',
      'The delete is refused while the league still has phases, draft pools, teams and storylines.',
      'Cast sessions of the league are kept',
      'This cannot be undone.',
    ])
      expect(text).toContain(part);
    mocks.locale = 'de';
    const de = visibleText(await render('danger'));
    expect(de).toContain('Löscht die Liga endgültig, zusammen mit:');
    expect(de).toContain('solange die Liga noch Phasen, Draft-Pools, Teams und Storylines hat');
  });

  it('a site admin gets them', async () => {
    const settings = await render('settings');
    expect(findByType(settings, LeagueTestFlagControl)).toHaveLength(1);
    expect(findByType(settings, ResourceAdminManager)).toHaveLength(1);
    expect(findByType(await render('phases'), PhaseTimeline)[0].props.canDelete).toBe(true);
    const [del] = findByType(await render('danger'), DeleteResourceButton);
    expect(del.props).toEqual({
      resourceType: 'season',
      resourceId: S1,
      resourceName: 'Summer League S3',
      redirectTo: '/admin/leagues',
    });
  });

  it('not an admin: only the guard, and no tab data is read', async () => {
    mocks.getLiveAccess.mockResolvedValue(liveAccess({ isSiteAdmin: false, isAnyAdmin: false }));
    const tree = await render('draft');
    expect(isValidElement(tree) && (tree as El).type).toBe(AdminGuard);
    expect((tree as El).props.children).toBeNull();
    expect(tabReads()).toEqual([]);
  });

  it('signed out: only the guard (it redirects)', async () => {
    mocks.getLiveAccess.mockResolvedValue(null);
    const tree = await render();
    expect((tree as El).type).toBe(AdminGuard);
    expect(tabReads()).toEqual([]);
  });

  it('the page source no longer reads the session copy', () => {
    const src = readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8');
    expect(src).not.toMatch(/\bisAdmin\(|getSession\(/);
  });
});

// ─── Settings tab ───────────────────────────────────────────────────

describe('settings tab', () => {
  it('the settings controls sit in plain sections (no collapse remount) and get the stored values', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season({ is_test_season: true, route_theme: 'sakura' }));
    const tree = await render('settings');
    for (const section of findByType(tree, Section)) expect(section.props.collapsible).toBeUndefined();
    expect(findByType(tree, LeagueTestFlagControl)[0].props).toEqual({ seasonId: S1, isTestSeason: true });
    expect(findByType(tree, LeagueThemeControl)[0].props).toEqual({ seasonId: S1, currentTheme: 'sakura' });
    expect(findByType(tree, ContentLanguageControl)[0].props).toEqual({ seasonId: S1, currentLanguage: 'de' });
  });

  it('lists the league details first, with the stored values and the rulesets', async () => {
    const rulesets = [{ id: 'rs-1', name: 'Gen 9 RU' }];
    mocks.listRulesets.mockResolvedValue(rulesets);
    mocks.getSeasonWithDetails.mockResolvedValue(
      season({ format_type: 'singles', point_buy_list_id: null, status: 'upcoming', ruleset_id: 'rs-1' }),
    );
    const tree = await render('settings');

    expect(sectionTitles(tree)[0]).toBe('League details');
    expect(sectionTitled(tree, 'League details')?.props.subtitle).toContain('Name, league type, battle ruleset');
    const [form] = findByType(tree, LeagueSettingsForm);
    expect(form.props).toMatchObject({
      seasonId: S1,
      rulesets,
      formatLock: null,
      initial: {
        name: 'Summer League S3',
        formatType: 'singles',
        rulesetId: 'rs-1',
        startDate: '2026-09-01',
        endDate: '2026-12-15',
      },
    });
    // Not keyed by the stored values: a keyed form would remount after every save and lose its
    // "saved" notice; it takes new stored values over itself (adoptStoredLeagueSettings).
    expect(form.key).toBeNull();
    expect(mocks.getSeasonPhaseStartSignals).toHaveBeenCalledWith(S1);
  });

  it('maps unset ruleset and dates to empty form values', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(
      season({ format_type: 'singles', status: 'upcoming', ruleset_id: null, start_date: null, end_date: null }),
    );
    const [form] = findByType(await render('settings'), LeagueSettingsForm);
    expect(form.props.initial).toMatchObject({ rulesetId: '', startDate: '', endDate: '' });
  });

  it.each<[string, Record<string, unknown>, unknown[], string | null]>([
    ['an upcoming classic league without rounds', { format_type: 'singles', status: 'upcoming' }, [], null],
    [
      'an upcoming league whose phases never started',
      { format_type: 'doubles', status: 'upcoming' },
      [{ status: 'upcoming', rounds_total: 0 }],
      null,
    ],
    ['an active league', { format_type: 'singles', status: 'active' }, [], 'started'],
    [
      'an upcoming league with a phase that has rounds',
      { format_type: 'draft', status: 'upcoming' },
      [{ status: 'upcoming', rounds_total: 2 }],
      'started',
    ],
    [
      'an upcoming league with an active phase',
      { format_type: 'singles', status: 'upcoming' },
      [{ status: 'active', rounds_total: 0 }],
      'started',
    ],
    ['a point-buy league', { format_type: 'evolution_point_buy', status: 'upcoming' }, [], 'point_buy'],
    ['an active point-buy league', { format_type: 'evolution_point_buy', status: 'active' }, [], 'point_buy'],
  ])('passes the league type lock for %s', async (_label, overrides, phases, lock) => {
    mocks.getSeasonWithDetails.mockResolvedValue(
      season({ point_buy_list_id: overrides.format_type === 'evolution_point_buy' ? 'list-1' : null, ...overrides }),
    );
    mocks.getSeasonPhaseStartSignals.mockResolvedValue(phases);
    const [form] = findByType(await render('settings'), LeagueSettingsForm);
    expect(form.props.formatLock).toBe(lock);
  });

  it('reads the phase signals for the settings tab and the point-buy rules tab only', async () => {
    for (const tab of LEAGUE_ADMIN_TABS.filter((t) => t !== 'settings' && t !== 'rules')) {
      vi.clearAllMocks();
      mocks.getLiveAccess.mockResolvedValue(liveAccess());
      mocks.getSeasonWithDetails.mockResolvedValue(season());
      mocks.listRulesets.mockResolvedValue([]);
      mocks.getSeasonGroups.mockResolvedValue([]);
      mocks.getDraftPoolsBySeasonWithGroups.mockResolvedValue([]);
      mocks.getListEntries.mockResolvedValue([]);
      mocks.getFormatRules.mockResolvedValue({ comeback_spend_open: true });
      mocks.getDraftPoolBySeason.mockResolvedValue({ id: 'pool-1', draft_type: 'budget', pick_order: 'free', status: 'in_progress' });
      mocks.getDraftPoolsBySeason.mockResolvedValue([]);
      mocks.getSeasonParticipants.mockResolvedValue(PARTICIPANTS);
      mocks.loadPublishRefusals.mockResolvedValue({});
      await render(tab);
      expect(mocks.getSeasonPhaseStartSignals, tab).not.toHaveBeenCalled();
    }
    await render('rules');
    expect(mocks.getSeasonPhaseStartSignals).toHaveBeenCalledWith(S1);
  });

  it('the classic draft rules tab makes no phase signals read (it has no format rules section)', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season({ format_type: 'draft', point_buy_list_id: null }));
    const tree = await render('rules');
    expect(mocks.getSeasonPhaseStartSignals).not.toHaveBeenCalled();
    expect(findByType(tree, FormatRulesEditor)).toHaveLength(0);
  });

  it('falls back to the default content language when the row has none', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season({ language: undefined }));
    const [control] = findByType(await render('settings'), ContentLanguageControl);
    expect(control.props.currentLanguage).toBe('de');
  });
});

// ─── Rules tab: format rules editor ─────────────────────────────────

describe('rules tab: format rules editor', () => {
  it.each<[string, Record<string, unknown>, unknown[], boolean]>([
    ['an active league', { status: 'active' }, [], true],
    ['a completed league', { status: 'completed' }, [], true],
    ['an upcoming league with a phase that has rounds', { status: 'upcoming' }, [{ status: 'upcoming', rounds_total: 2 }], true],
    ['an upcoming league with an active phase', { status: 'upcoming' }, [{ status: 'active', rounds_total: 0 }], true],
    ['an upcoming league with no phases', { status: 'upcoming' }, [], false],
    [
      'an upcoming league whose phases never started',
      { status: 'upcoming' },
      [{ status: 'upcoming', rounds_total: 0 }],
      false,
    ],
  ])('passes seasonStarted for %s', async (_label, overrides, phases, started) => {
    mocks.getSeasonWithDetails.mockResolvedValue(season(overrides));
    mocks.getSeasonPhaseStartSignals.mockResolvedValue(phases);
    const [editor] = findByType(await render('rules'), FormatRulesEditor);
    expect(editor.props).toEqual({ seasonId: S1, seasonStarted: started });
  });

  it('mounts the editor inside the Format Rules section, with the truthful subtitle (en + de)', async () => {
    const en = await render('rules');
    const section = sectionTitled(en, 'Format Rules');
    expect(findByType(section as El, FormatRulesEditor)).toHaveLength(1);
    expect(section?.props.subtitle).toContain('Edit the draft budget, picks');
    expect(section?.props.subtitle).toContain('Tera rules come from the format pack and cannot be edited here.');
    expect(section?.props.subtitle).not.toContain('Configure');

    mocks.locale = 'de';
    const de = sectionTitled(await render('rules'), 'Formatregeln');
    expect(de?.props.subtitle).toContain('Bearbeite Draft-Budget, Picks');
    expect(de?.props.subtitle).toContain('Tera-Regeln kommen aus dem Formatpaket');
  });

  it('a failed phase signals read fails the tab instead of guessing "not started"', async () => {
    mocks.getSeasonPhaseStartSignals.mockRejectedValue(new Error('db down'));
    await expect(render('rules')).rejects.toThrow('db down');
  });
});

// ─── Draft tab (DF7b, draft-frontend §7.4) ──────────────────────────

describe('draft tab (DF7b, draft-frontend §7.4)', () => {
  it('no longer imports the retired free-swap / Kill Token components', () => {
    const files = ['page.tsx', '_components/panels/DraftPanel.tsx'];
    for (const file of files) {
      const src = readFileSync(path.join(__dirname, '..', file), 'utf8');
      for (const retired of ['RedraftManager', 'KillTokenViewer', 'KillTokenAllocator', 'DraftTokenAllocator', 'DraftTokenAdminPanel']) {
        expect(src, file).not.toContain(retired);
      }
    }
  });

  it('EPB: links the draft control panel from the Draft Room and Redraft sections', async () => {
    const tree = await render('draft');
    const hrefs = findByType(tree, Link).map((l) => l.props.href);
    expect(hrefs.filter((h) => h === `/admin/leagues/${S1}/draft`)).toHaveLength(2);
    expect(hrefs).toContain(`/leagues/${S1}/draft`);
    expect(visibleText(tree)).toContain('Open the draft control panel');
    expect(visibleText(tree)).toContain('Open the Redraft in the draft control panel');
  });

  it('EPB: mounts TokenAdminSummary with narrow participants and the season flags', async () => {
    const tree = await render('draft');
    const [summary] = findByType(tree, TokenAdminSummary);
    expect(summary).toBeDefined();
    expect(summary.props).toMatchObject({ seasonId: S1, comebackSpendOpen: true, hasRedraft: false });
    expect(summary.props.participants).toEqual([
      { id: 'p1', name: 'Mara' },
      { id: 'p2', name: 'Misty' },
    ]);
    expectNoPrivatePlayerData(summary.props);
  });

  it('classic draft rules tab: EvolutionTierEditor gets narrow participants', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season({ format_type: 'draft', point_buy_list_id: null }));
    const [editor] = findByType(await render('rules'), EvolutionTierEditor);
    expect(editor.props.participants).toEqual([
      { id: 'p1', name: 'Mara' },
      { id: 'p2', name: 'Misty' },
    ]);
    expectNoPrivatePlayerData(editor.props);
  });

  it('EPB: an unstarted legacy placeholder pool shows the create summary, not "pool active"', async () => {
    mocks.getDraftPoolBySeason.mockResolvedValue({ id: 'pool-0', draft_type: 'budget', status: 'pending', engine: 'legacy' });
    mocks.getFormatRules.mockResolvedValue(null);
    const tree = await render('draft');
    const [create] = findByType(tree, EpbDraftRoomCreate);
    // Only the numbers the summary shows cross into the client. Without a format rules row the
    // format pack's defaults apply, and the summary must not credit them to the format rules.
    expect(create.props).toEqual({
      seasonId: S1,
      budget: epbPack.defaults.draftBudget,
      rosterSize: epbPack.defaults.draftPicks,
      fromFormatRules: false,
    });
    // EPB has no draft-type picker: the queue engine always creates a snake draft.
    expect(findByType(tree, DraftPoolManager)).toHaveLength(0);
    expect(visibleText(tree)).not.toContain('Draft pool active');
  });

  it('EPB: the create summary shows the format rules budget and pick count', async () => {
    mocks.getDraftPoolBySeason.mockResolvedValue(null);
    mocks.getFormatRules.mockResolvedValue({ comeback_spend_open: false, draft_budget: 200, draft_picks: 10 });
    const [create] = findByType(await render('draft'), EpbDraftRoomCreate);
    expect(create.props).toEqual({ seasonId: S1, budget: 200, rosterSize: 10, fromFormatRules: true });
  });

  it('EPB: without participants there is no create summary; the hint links the Participants tab', async () => {
    mocks.getDraftPoolBySeason.mockResolvedValue(null);
    mocks.getSeasonParticipants.mockResolvedValue([]);
    const tree = await render('draft');
    expect(findByType(tree, EpbDraftRoomCreate)).toHaveLength(0);
    expect(plainText(tree)).toContain('Add participants on the Participants tab first.');
    expect(findByType(tree, Link).map((l) => l.props.href)).toContain(`/admin/leagues/${S1}?tab=participants`);
  });

  it('EPB: one participant: no create summary (the draft could never start), the minimum is named', async () => {
    mocks.getDraftPoolBySeason.mockResolvedValue(null);
    mocks.getSeasonParticipants.mockResolvedValue(PARTICIPANTS.slice(0, 1));
    const tree = await render('draft');
    expect(findByType(tree, EpbDraftRoomCreate)).toHaveLength(0);
    expect(plainText(tree)).toContain('A draft needs at least 2 participants, and this league has 1.');
  });

  it('EPB: exactly the seat minimum gets the create summary', async () => {
    mocks.getDraftPoolBySeason.mockResolvedValue(null);
    expect(PARTICIPANTS).toHaveLength(2);
    expect(findByType(await render('draft'), EpbDraftRoomCreate)).toHaveLength(1);
  });

  it('EPB: with neither a list nor participants, the list comes first (linked to the Rules tab)', async () => {
    mocks.getDraftPoolBySeason.mockResolvedValue(null);
    mocks.getSeasonWithDetails.mockResolvedValue(season({ point_buy_list_id: null }));
    mocks.getSeasonParticipants.mockResolvedValue([]);
    const tree = await render('draft');
    const text = plainText(tree);
    expect(text).toContain('Bind a point-buy list on the Rules tab first.');
    expect(text).not.toContain('Add participants');
    expect(findByType(tree, Link).map((l) => l.props.href)).toContain(`/admin/leagues/${S1}?tab=rules`);
  });

  it('EPB: more participants than a draft has seats: no create summary, the limit is named', async () => {
    mocks.getDraftPoolBySeason.mockResolvedValue(null);
    const roster = Array.from({ length: 33 }, (_, i) => ({
      ...fullPlayerRow({ id: `p${i}`, name: `Player ${i}` }),
      gym_type: null,
      core_types: null,
      core_assigned_at: null,
    }));
    mocks.getSeasonParticipants.mockResolvedValue(roster);
    const tree = await render('draft');
    expect(findByType(tree, EpbDraftRoomCreate)).toHaveLength(0);
    expect(plainText(tree)).toContain('A draft has room for at most 32 participants, and this league has 33.');
  });

  it('EPB: exactly the seat limit still gets the create summary', async () => {
    mocks.getDraftPoolBySeason.mockResolvedValue(null);
    const roster = Array.from({ length: 32 }, (_, i) => ({
      ...fullPlayerRow({ id: `p${i}`, name: `Player ${i}` }),
      gym_type: null,
      core_types: null,
      core_assigned_at: null,
    }));
    mocks.getSeasonParticipants.mockResolvedValue(roster);
    expect(findByType(await render('draft'), EpbDraftRoomCreate)).toHaveLength(1);
  });

  it('EPB: without a bound point-buy list there is no create summary', async () => {
    mocks.getDraftPoolBySeason.mockResolvedValue(null);
    mocks.getSeasonWithDetails.mockResolvedValue(season({ point_buy_list_id: null }));
    const tree = await render('draft');
    expect(findByType(tree, EpbDraftRoomCreate)).toHaveLength(0);
    expect(plainText(tree)).toContain('Bind a point-buy list on the Rules tab first.');
  });

  it('EPB: a started pool shows "pool active" and no create form', async () => {
    const tree = await render('draft');
    expect(findByType(tree, DraftPoolManager)).toHaveLength(0);
    expect(findByType(tree, EpbDraftRoomCreate)).toHaveLength(0);
    const room = sectionTitled(tree, 'Draft Room');
    expect(room?.props.collapsible).toBeUndefined();
    const roomText = visibleText(room?.props.children as ReactNode);
    // A legacy pool of a point-buy season is labelled by its order and Point Buy.
    expect(roomText).toContain('Draft pool active: ');
    expect(roomText).toContain('Free order · Point Buy');
    expect(roomText).toContain(' to manage picks.');
    expect(roomText).not.toMatch(/Bind a point-buy list|Add participants/);
  });

  it('plain draft season: one three-type form in the Draft Room, no EPB summary, no format-rules read', async () => {
    mocks.getDraftPoolBySeason.mockResolvedValue(null);
    mocks.getSeasonWithDetails.mockResolvedValue(season({ format_type: 'draft', point_buy_list_id: null }));
    const tree = await render('draft');
    const room = sectionTitled(tree, 'Draft Room');
    expect(findByType(room?.props.children as ReactNode, DraftPoolManager)).toHaveLength(1);
    expect(findByType(tree, DraftPoolManager)).toHaveLength(1);
    expect(findByType(tree, EpbDraftRoomCreate)).toHaveLength(0);
    expect(mocks.getFormatRules).not.toHaveBeenCalled();
    expect(mocks.getSeasonParticipants).not.toHaveBeenCalled();
  });

  it('plain draft season with a draft: no create form', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season({ format_type: 'draft', point_buy_list_id: null }));
    const tree = await render('draft');
    expect(findByType(tree, DraftPoolManager)).toHaveLength(0);
    expect(visibleText(sectionTitled(tree, 'Draft Room') as El)).toContain('Draft pool active: ');
  });

  it('hasRedraft is true once a redraft pool is complete', async () => {
    mocks.getDraftPoolsBySeason.mockResolvedValue([
      { id: 'pool-1', kind: 'initial', phase: 'complete', mode: 'live', status: 'complete' },
      { id: 'pool-2', kind: 'redraft', phase: 'complete', mode: 'live', status: 'complete' },
    ]);
    const tree = await render('draft');
    expect(findByType(tree, TokenAdminSummary)[0].props.hasRedraft).toBe(true);
  });

  it('trades are retired: no pending-trade read or list, the Redraft section only links the panel', async () => {
    for (const file of ['page.tsx', '_components/panels/DraftPanel.tsx']) {
      const src = readFileSync(path.join(__dirname, '..', file), 'utf8');
      for (const retired of ['AdminPendingTrades', 'redraft-trade-requests', 'getPendingTradeRequestsForSeason', 'pendingTrades']) {
        expect(src, file).not.toContain(retired);
      }
    }
    for (const locale of ['en', 'de'] as const) {
      mocks.locale = locale;
      const tree = await render('draft');
      const redraft = sectionTitled(tree, 'Redraft');
      expect(redraft, locale).toBeDefined();
      expect(visibleText(redraft as El), locale).not.toMatch(/trade|Tausch/i);
    }
  });

  it('renames Kill Tokens to the spec token names and drops the Cosmog 2:1 text', async () => {
    const text = visibleText(await render('draft'));
    expect(text).not.toMatch(/Kill Tokens?\b(?<!Draft Kill Tokens?)|Killtoken|Cosmog 2:1|Cosmo-Punkte/);
    const tokens = formatPack.messages.en.glossary.token;
    expect(text).toContain(`${tokens.draftKill}, ${tokens.comeback} and ${tokens.cosmo}`);
  });

  it('non-EPB league: no token, redraft or panel surfaces on any tab', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season({ format_type: 'singles', point_buy_list_id: null }));
    for (const tab of LEAGUE_ADMIN_TABS) {
      const tree = await render(tab);
      expect(findByType(tree, TokenAdminSummary), tab).toHaveLength(0);
      expect(findByType(tree, Link).map((l) => l.props.href), tab).not.toContain(`/admin/leagues/${S1}/draft`);
      expect(sectionTitles(tree), tab).not.toContain('Redraft');
    }
    expect(mocks.getDraftPoolsBySeason).not.toHaveBeenCalled();
  });
});

// ─── Page header and i18n ───────────────────────────────────────────

describe('page header and i18n', () => {
  it('English: no German copy is left on any tab', async () => {
    for (const tab of LEAGUE_ADMIN_TABS) {
      const tree = await render(tab);
      expect(visibleText(tree), tab).not.toMatch(/Hinrunde|Rückrunde|Archiviert|Beschreibung|Gefahrenzone/);
    }
    const [container] = findByType(await render(), PageContainer);
    expect(container.props.subtitle).toBe('Evolution Point Buy · Reg H');
    // The header actions are not in PageContainer's non-wrapping action slot.
    expect(container.props.action).toBeUndefined();
  });

  it('German: section titles, subtitle and archived marker are translated', async () => {
    mocks.locale = 'de';
    mocks.getSeasonWithDetails.mockResolvedValue(season({ archived: true, ruleset_name: null }));
    expect(sectionTitles(await render())).toEqual(['Auf einen Blick', 'Beschreibung']);
    expect(sectionTitles(await render('settings'))).toEqual(
      expect.arrayContaining(['Liga-Daten', 'Inhaltssprache', '3D-Welt-Thema']),
    );
    expect(sectionTitles(await render('draft'))).toEqual(['Draft-Raum', 'Redraft', 'Tokens']);
    const tree = await render('draft');
    const [container] = findByType(tree, PageContainer);
    expect(container.props.subtitle).toBe('Evolution Point Buy · Archiviert');
    expect(visibleText(tree)).toContain('Hin- und Rückrunde');
    expect(visibleText(await render('danger'))).toContain('Gefahrenzone');
  });

  it('a failed per-league read fails closed (the page throws, no league or tab data is read)', async () => {
    mocks.getLiveAccess.mockResolvedValue(liveAccess({ isSiteAdmin: false }));
    mocks.isResourceAdminFor.mockRejectedValue(new Error('db down'));
    await expect(render('participants')).rejects.toThrow('db down');
    expect(mocks.getSeasonWithDetails).not.toHaveBeenCalled();
    expect(tabReads()).toEqual([]);
  });

  it('missing league → notFound', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(null);
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('a malformed league id → notFound before any read (never a Postgres error and a 500)', async () => {
    for (const id of ['s1', 'not-a-uuid', `${S1}x`, "1' or '1'='1"]) {
      await expect(render('danger', id), id).rejects.toThrow('NEXT_NOT_FOUND');
    }
    expect(mocks.getSeasonWithDetails).not.toHaveBeenCalled();
    expect(mocks.getLiveAccess).not.toHaveBeenCalled();
  });
});

// ─── League groups ──────────────────────────────────────────────────

describe('league groups (Participants editor, per-group Draft tab)', () => {
  const GA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const GB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const POOL_A = '11111111-1111-4111-8111-111111111111';
  const REDRAFT_A = '22222222-2222-4222-8222-222222222222';
  const ROSTER = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => ({
    ...fullPlayerRow({ id, name: `Trainer ${id}` }),
    gym_type: null,
    core_types: null,
    core_assigned_at: null,
  }));
  /** Enough cheap lines for two 2-slot rosters within 10 points each. */
  const LINES = [1, 2, 3, 4, 5, 6].map((n) => ({ line_id: `line-${n}`, price: 2 }));

  function groupedLeague(groupB = ['p3', 'p4']) {
    mocks.getSeasonGroups.mockResolvedValue([
      { id: GA, season_id: S1, name: 'Group A', sort_order: 1, player_ids: ['p1', 'p2'] },
      { id: GB, season_id: S1, name: 'Group B', sort_order: 2, player_ids: groupB },
    ]);
    mocks.getSeasonParticipants.mockResolvedValue(ROSTER);
    mocks.getFormatRules.mockResolvedValue({ draft_budget: 10, draft_picks: 2, comeback_spend_open: false });
    mocks.getDraftPoolsBySeasonWithGroups.mockResolvedValue([
      { id: POOL_A, engine: 'queue', kind: 'initial', phase: 'complete', mode: 'live', status: 'complete', season_group_id: GA, season_group_name: 'Group A', season_group_sort_order: 1 },
      { id: REDRAFT_A, engine: 'queue', kind: 'redraft', phase: 'submissions', mode: 'live', status: 'in_progress', season_group_id: GA, season_group_name: 'Group A', season_group_sort_order: 1 },
    ]);
    mocks.getListEntries.mockResolvedValue(LINES);
    mocks.loadPublishRefusals.mockResolvedValue({ [REDRAFT_A]: '2026-10-18T20:00:00.000Z' });
  }

  it('the Participants tab mounts the groups editor for the league (no server read)', async () => {
    const tree = await render('participants');
    const LeagueGroupsEditor = (await import('@/components/league/groups/LeagueGroupsEditor')).default;
    const [editor] = findByType(tree, LeagueGroupsEditor);
    expect(editor.props).toEqual({ seasonId: S1 });
    expect(tabReads()).toEqual([]);
  });

  it('EPB with groups: one card per group, pools with links and the refusal line, a create form for the group without one', async () => {
    groupedLeague();
    const tree = await render('draft');
    expect(tabReads().sort()).toEqual(
      ['getDraftPoolsBySeasonWithGroups', 'getFormatRules', 'getListEntries', 'getSeasonGroups', 'getSeasonParticipants'].sort(),
    );
    expect(mocks.getDraftPoolBySeason).not.toHaveBeenCalled();
    expect(sectionTitles(tree)).toEqual(['Draft Room', 'Redraft', 'Tokens']);
    const text = plainText(tree);
    expect(text).toContain('This league drafts per group');
    expect(text).toContain('Group A');
    expect(text).toContain('Group B');
    expect(text).toContain('Initial draft');
    expect(text).toContain('Automatic publish refused at');
    expect(text).toContain('1 participant is in no group');
    const hrefs = findByType(tree, Link).map((l) => String(l.props.href));
    expect(hrefs).toContain(`/admin/leagues/${S1}/draft?pool=${POOL_A}`);
    expect(hrefs).toContain(`/leagues/${S1}/draft-room?pool=${REDRAFT_A}`);
    const LocalTime = (await import('@/i18n/LocalTime')).LocalTime;
    expect(findByType(tree, LocalTime)[0].props.value).toBe('2026-10-18T20:00:00.000Z');
    const creates = findByType(tree, EpbDraftRoomCreate);
    expect(creates).toHaveLength(1);
    expect(creates[0].props).toMatchObject({ seasonId: S1, seasonGroupId: GB, budget: 10, rosterSize: 2, seatsLabel: 'One per group member.' });
    // The Comeback switch stays while a group has no completed Redraft.
    expect(findByType(tree, TokenAdminSummary)[0].props.hasRedraft).toBe(false);
    expectNoPrivatePlayerData(findByType(tree, TokenAdminSummary)[0].props.participants);
  });

  it('EPB with groups: a group that could never complete its draft gets the split-into-groups warning, no create form', async () => {
    groupedLeague();
    mocks.getListEntries.mockResolvedValue(LINES.slice(0, 3));
    const tree = await render('draft');
    expect(findByType(tree, EpbDraftRoomCreate)).toHaveLength(0);
    expect(plainText(tree)).toContain(
      'This group’s draft could never finish: the 3 lines of the list cannot fill all 4 roster slots of its 2 trainers within their budgets. Split the participants into smaller groups on the Participants tab.',
    );
  });

  it('EPB with groups: a one-trainer group names the seat minimum (German too)', async () => {
    groupedLeague(['p3']);
    expect(plainText(await render('draft'))).toContain('A draft needs at least 2 trainers, and this group has 1.');
    mocks.locale = 'de';
    expect(plainText(await render('draft'))).toContain('Ein Draft braucht mindestens 2 Trainer, und diese Gruppe hat 1.');
  });

  it('a non-EPB league with groups explains that groups draft only in Evolution Point Buy leagues', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season({ format_type: 'draft', point_buy_list_id: null }));
    groupedLeague();
    const tree = await render('draft');
    expect(findByType(tree, DraftPoolManager)).toHaveLength(0);
    expect(plainText(tree)).toContain('Groups draft separately, which only Evolution Point Buy leagues support.');
    expect(mocks.getDraftPoolBySeason).not.toHaveBeenCalled();
  });
});
