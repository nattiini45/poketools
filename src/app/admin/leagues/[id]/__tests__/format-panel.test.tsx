/**
 * The league admin Format tab (`?tab=format`): the read-only Format Studio view of one league, plus, for a custom
 * league, its readiness checklist and the attach panel.
 * The page is rendered for real; the other tab panels, the loaders and the client components are
 * stubs, so the test proves what the tab reads and what it hands to the display components.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'de',
  getLiveAccess: vi.fn(),
  isResourceAdminFor: vi.fn(),
  getSeasonWithDetails: vi.fn(),
  loadLeagueFormat: vi.fn(),
  loadLeagueFormatState: vi.fn(),
  loadAttachCandidates: vi.fn(),
  getSeasonFormatSummary: vi.fn(),
  getRulesetPinInfo: vi.fn(),
  otherPanel: vi.fn(),
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
  return {
    getLocale: async () => mocks.locale,
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, mocks.locale),
  };
});
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonWithDetails: mocks.getSeasonWithDetails }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: mocks.isResourceAdminFor }));
vi.mock('@/lib/format-studio/loader', () => ({ loadLeagueFormat: mocks.loadLeagueFormat }));
vi.mock('@/lib/format-studio/readiness-loader', () => ({ loadLeagueFormatState: mocks.loadLeagueFormatState }));
vi.mock('@/lib/format-studio/attach-candidates', () => ({ loadAttachCandidates: mocks.loadAttachCandidates }));
vi.mock('@/lib/supabase/queries/season-formats', () => ({ getSeasonFormatSummary: mocks.getSeasonFormatSummary }));
vi.mock('@/lib/ruleset-studio/pin-info.server', () => ({ getRulesetPinInfo: mocks.getRulesetPinInfo }));
vi.mock('@/components/format-studio/FormatDetail', () => stub('FormatDetail'));
vi.mock('@/components/format-studio/attach/FormatAttachPanel', () => stub('FormatAttachPanel'));
vi.mock('@/components/format-studio/attach/ReadinessCard', () => stub('ReadinessCard'));
vi.mock('@/components/shared/AdminGuard', () => stub('AdminGuard'));
vi.mock('@/components/shared/ResourceForbidden', () => stub('ResourceForbidden'));
vi.mock('@/components/ui/PageContainer', () => stub('PageContainer'));
vi.mock('@/components/ui/Section', () => stub('Section'));
vi.mock('@/components/ui/Badge', () => stub('Badge'));
vi.mock('@/components/league/LeagueStatusControl', () => stub('LeagueStatusControl'));
vi.mock('@/components/league/hub/HubTabStripScroll', () => stub('HubTabStripScroll'));
vi.mock('../_components/AdminTabPending', () => stub('AdminTabPending'));
// Every other tab is a spy: the Format tab must not run any of them.
vi.mock('../_components/panels/OverviewPanel', () => ({ overviewPanel: mocks.otherPanel }));
vi.mock('../_components/panels/ParticipantsPanel', () => ({ participantsPanel: mocks.otherPanel }));
vi.mock('../_components/panels/DraftPanel', () => ({ draftPanel: mocks.otherPanel }));
vi.mock('../_components/panels/PhasesPanel', () => ({ phasesPanel: mocks.otherPanel }));
vi.mock('../_components/panels/RulesPanel', () => ({ rulesPanel: mocks.otherPanel }));
vi.mock('../_components/panels/SettingsPanel', () => ({ settingsPanel: mocks.otherPanel }));
vi.mock('../_components/panels/DangerPanel', () => ({ dangerPanel: mocks.otherPanel }));

import AdminLeagueDetailPage from '../page';
import Link from 'next/link';
import AdminGuard from '@/components/shared/AdminGuard';
import Section from '@/components/ui/Section';
import FormatDetail from '@/components/format-studio/FormatDetail';
import FormatAttachPanel from '@/components/format-studio/attach/FormatAttachPanel';
import ReadinessCard from '@/components/format-studio/attach/ReadinessCard';
import LeagueAdminTabs from '../_components/LeagueAdminTabs';
import { createTranslator } from '@/i18n/core';
import { formatStudioAdminMessages } from '@/i18n/messages/format-studio/admin';
import { leagueAdminSeasonPageMessages } from '@/i18n/messages/league-admin/season-page';

/** The league id: a uuid, since the page answers 404 for any other `[id]`. */
const S1 = '5e150000-0000-4000-8000-000000000001';

type El = ReactElement<Record<string, unknown>>;

function walk(node: ReactNode, visit: (el: El) => void): void {
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n as ReactNode, visit));
    return;
  }
  if (isValidElement<Record<string, unknown>>(node)) {
    visit(node);
    walk(node.props.children as ReactNode, visit);
  }
}

function findByType(node: ReactNode, type: unknown): El[] {
  const found: El[] = [];
  walk(node, (el) => {
    if (el.type === type) found.push(el);
  });
  return found;
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((n) => textOf(n as ReactNode)).join('');
  if (isValidElement<Record<string, unknown>>(node)) return textOf(node.props.children as ReactNode);
  return '';
}

function panelOf(tree: ReactNode): El {
  let panel: El | undefined;
  walk(tree, (el) => {
    if (el.props['data-admin-panel'] !== undefined) panel = el;
  });
  expect(panel).toBeDefined();
  return panel as El;
}

function season(overrides: Record<string, unknown> = {}) {
  return {
    id: S1,
    name: 'Example League',
    format_type: 'singles',
    ruleset_name: null,
    archived: false,
    is_test_season: false,
    status: 'active',
    ...overrides,
  };
}

const VIEW = {
  ok: true,
  hash: 'h1',
  definition: null,
  diagnostics: [],
  plan: null,
  order: [],
  capabilities: null,
  coverage: null,
  rulesets: [],
};

/** What `loadLeagueFormatState` answers for a custom league with nothing attached. */
const CUSTOM_STATE = {
  readiness: {
    applicable: true,
    ready: false,
    blockedReason: 'format_not_attached',
    items: [{ id: 'format_attached', state: 'unmet', params: {}, action: { tab: 'format', anchor: 'format-attach' } }],
  },
  attached: null,
  manualPhaseCount: 0,
  started: false,
};

const ATTACHED = {
  definition_id: 'def-1',
  version_no: 2,
  spec_hash: 'h'.repeat(64),
  frozen_at: '2026-10-09T12:00:00.000Z',
  name: { base: 'en', en: { v: 'Spring Cup', s: 'human' } },
  stageCount: 3,
  createdPhases: 3,
};

const CANDIDATE = {
  id: 'def-2',
  slug: 'autumn-cup',
  name: { base: 'en', en: { v: 'Autumn Cup', s: 'human' } },
  version_no: 1,
  content_hash: 'g'.repeat(64),
  visibility: 'league',
  ownerName: 'Robin',
  mine: false,
};

async function render(tab?: string, id = S1): Promise<ReactNode> {
  const query = tab === undefined ? {} : { tab };
  return AdminLeagueDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) });
}

function studioT(locale: 'en' | 'de' = mocks.locale) {
  return createTranslator(formatStudioAdminMessages, locale);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = 'en';
  mocks.getLiveAccess.mockResolvedValue({ player: { playerId: 'u1' }, isSiteAdmin: true, isAnyAdmin: true });
  mocks.isResourceAdminFor.mockResolvedValue(true);
  mocks.getSeasonWithDetails.mockResolvedValue(season());
  mocks.loadLeagueFormat.mockResolvedValue({ kind: 'ok', view: VIEW, editorLinks: {} });
  mocks.loadLeagueFormatState.mockResolvedValue(CUSTOM_STATE);
  mocks.loadAttachCandidates.mockResolvedValue({ items: [], capped: false });
  mocks.getSeasonFormatSummary.mockResolvedValue(null);
  mocks.getRulesetPinInfo.mockResolvedValue(null);
});

describe('Format tab (?tab=format)', () => {
  it('renders only the format panel and loads the league format exactly once, from the league row', async () => {
    const league = season();
    mocks.getSeasonWithDetails.mockResolvedValue(league);
    const tree = await render('format');
    expect(panelOf(tree).props['data-admin-panel']).toBe('format');
    expect(panelOf(tree).props['aria-labelledby']).toBe('league-admin-tab-format');
    expect(findByType(tree, LeagueAdminTabs)[0].props.activeTab).toBe('format');
    expect(mocks.loadLeagueFormat).toHaveBeenCalledTimes(1);
    expect(mocks.loadLeagueFormat).toHaveBeenCalledWith(league);
    // No other tab ran, and the league row was read once.
    expect(mocks.otherPanel).not.toHaveBeenCalled();
    expect(mocks.getSeasonWithDetails).toHaveBeenCalledTimes(1);
  });

  it('no other tab reads the format: the bare URL and the other tabs never call the loader', async () => {
    await render();
    for (const tab of ['participants', 'phases', 'settings', 'danger']) await render(tab);
    expect(mocks.loadLeagueFormat).not.toHaveBeenCalled();
  });

  it('an ok result: the display component in tab variant with the editor links, and the Studio link', async () => {
    const editorLinks = { epb: `/admin/leagues/${S1}?tab=rules` };
    mocks.loadLeagueFormat.mockResolvedValue({ kind: 'ok', view: VIEW, editorLinks });
    const tree = await render('format');

    const [detail] = findByType(tree, FormatDetail);
    expect(detail.props).toEqual({ view: VIEW, variant: 'tab', editorLinks });
    expect(detail.props.example).toBeUndefined();

    const t = studioT();
    const [section] = findByType(tree, Section);
    expect(section.props.title).toBe(t('tab.title'));
    expect(section.props.subtitle).toBe(t('tab.subtitle'));
    const studioLink = findByType(tree, Link).find((l) => l.props.href === `/admin/formats/league/${S1}`);
    expect(studioLink).toBeDefined();
    expect(textOf(studioLink?.props.children as ReactNode)).toBe(t('tab.openStudio'));
  });

  it('the tab carries no write control', async () => {
    const tree = await render('format');
    const controls: string[] = [];
    walk(tree, (el) => {
      if (typeof el.type === 'string' && ['form', 'button', 'input', 'select', 'textarea'].includes(el.type)) {
        controls.push(el.type);
      }
    });
    expect(controls).toEqual([]);
    const source = readFileSync(
      path.join(process.cwd(), 'src/app/admin/leagues/[id]/_components/panels/FormatPanel.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/fetch\(|method:|'use server'|\/api\//);
  });

  it('a league without phases: the empty state with a link to the phases tab, no display component', async () => {
    mocks.loadLeagueFormat.mockResolvedValue({ kind: 'no_phases' });
    const tree = await render('format');
    const panel = panelOf(tree);
    expect(findByType(panel, FormatDetail)).toHaveLength(0);
    expect(findByType(panel, Section)).toHaveLength(0);
    expect(findByType(panel, Link).map((l) => l.props.href)).toEqual([`/admin/leagues/${S1}?tab=phases`]);
    expect(textOf(panel).trim().length).toBeGreaterThan(0);
  });

  it('an admin of another league gets only the forbidden notice: the loader is not called', async () => {
    mocks.getLiveAccess.mockResolvedValue({ player: { playerId: 'u1' }, isSiteAdmin: false, isAnyAdmin: true });
    mocks.isResourceAdminFor.mockResolvedValue(false);
    const tree = await render('format');
    expect((tree as El).type).toBe(AdminGuard);
    expect(textOf(tree)).toBe('Only admins of this league can open its admin page.');
    expect(findByType(tree, LeagueAdminTabs)).toHaveLength(0);
    expect(mocks.loadLeagueFormat).not.toHaveBeenCalled();
    expect(mocks.getSeasonWithDetails).not.toHaveBeenCalled();
  });

  it('an admin of this league sees the tab', async () => {
    mocks.getLiveAccess.mockResolvedValue({ player: { playerId: 'u1' }, isSiteAdmin: false, isAnyAdmin: true });
    const tree = await render('format');
    expect(panelOf(tree).props['data-admin-panel']).toBe('format');
    expect(mocks.isResourceAdminFor).toHaveBeenCalledWith('u1', 'season', S1);
    expect(mocks.loadLeagueFormat).toHaveBeenCalledTimes(1);
  });

  it('a malformed id is a 404 before any read', async () => {
    for (const id of ['s1', 'not-a-uuid', `${S1}x`]) {
      await expect(render('format', id)).rejects.toThrow('NEXT_NOT_FOUND');
    }
    expect(mocks.getLiveAccess).not.toHaveBeenCalled();
    expect(mocks.getSeasonWithDetails).not.toHaveBeenCalled();
    expect(mocks.loadLeagueFormat).not.toHaveBeenCalled();
  });

  it('every format has the tab, right before settings', async () => {
    for (const format of ['singles', 'doubles', 'draft', 'evolution_point_buy']) {
      mocks.getSeasonWithDetails.mockResolvedValue(season({ format_type: format }));
      const tabs = findByType(await render('format'), LeagueAdminTabs)[0].props.tabs as string[];
      expect(tabs, format).toContain('format');
      expect(tabs[tabs.indexOf('format') + 1], format).toBe('settings');
    }
  });

  it('German: the tab label and the panel title are translated', async () => {
    mocks.locale = 'de';
    const tree = await render('format');
    const labels = findByType(tree, LeagueAdminTabs)[0].props.labels as Record<string, string>;
    expect(labels.format).toBe(createTranslator(leagueAdminSeasonPageMessages, 'de')('tabs.format'));
    expect(labels.format).toBe('Format');
    const [section] = findByType(tree, Section);
    expect(section.props.title).toBe(studioT('de')('tab.title'));
    expect(String(section.props.title)).not.toMatch(/Ã|Â|�/);
  });
});

describe('Format tab of a custom league', () => {
  const custom = (overrides: Record<string, unknown> = {}) =>
    season({ format_type: 'custom', status: 'upcoming', ruleset_id: 'rs-1', language: 'de', ...overrides });

  /** The order in which the three blocks appear in the panel. */
  function blockOrder(panel: ReactNode): string[] {
    const order: string[] = [];
    walk(panel, (el) => {
      if (el.type === ReadinessCard) order.push('readiness');
      if (el.type === FormatAttachPanel) order.push('attach');
      if (el.type === FormatDetail) order.push('outline');
    });
    return order;
  }

  it('reads the new state once, in the same wave as the outline, for the live player', async () => {
    const league = custom();
    mocks.getSeasonWithDetails.mockResolvedValue(league);
    mocks.loadLeagueFormat.mockResolvedValue({ kind: 'no_phases' });
    await render('format');
    expect(mocks.loadLeagueFormat).toHaveBeenCalledTimes(1);
    expect(mocks.loadLeagueFormatState).toHaveBeenCalledTimes(1);
    expect(mocks.loadLeagueFormatState).toHaveBeenCalledWith(league);
    expect(mocks.loadAttachCandidates).toHaveBeenCalledTimes(1);
    expect(mocks.loadAttachCandidates).toHaveBeenCalledWith({ playerId: 'u1' });
    expect(mocks.otherPanel).not.toHaveBeenCalled();
  });

  it('renders the readiness card, then the attach section, and no outline while the league has no phases', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(custom());
    mocks.loadLeagueFormat.mockResolvedValue({ kind: 'no_phases' });
    const panel = panelOf(await render('format'));
    expect(blockOrder(panel)).toEqual(['readiness', 'attach']);
    const [card] = findByType(panel, ReadinessCard);
    expect(card.props).toEqual({ id: 'format-readiness', result: CUSTOM_STATE.readiness, seasonId: S1 });
    const [section] = findByType(panel, Section);
    expect(section.props.title).toBe('Format');
  });

  it('a league that has started gets no readiness card, but keeps the attach section', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(custom({ status: 'active' }));
    mocks.loadLeagueFormatState.mockResolvedValue({ ...CUSTOM_STATE, started: true });
    mocks.loadLeagueFormat.mockResolvedValue({ kind: 'no_phases' });
    const panel = panelOf(await render('format'));
    expect(blockOrder(panel)).toEqual(['attach']);
    expect(findByType(panel, ReadinessCard)).toHaveLength(0);
  });

  it('with phases the existing read-only outline follows the attach section', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(custom());
    const editorLinks = { epb: 'x' };
    mocks.loadLeagueFormat.mockResolvedValue({ kind: 'ok', view: VIEW, editorLinks });
    const panel = panelOf(await render('format'));
    expect(blockOrder(panel)).toEqual(['readiness', 'attach', 'outline']);
    const [detail] = findByType(panel, FormatDetail);
    expect(detail.props).toEqual({ view: VIEW, variant: 'tab', editorLinks });
    const studioLink = findByType(panel, Link).find((l) => l.props.href === `/admin/formats/league/${S1}`);
    expect(studioLink).toBeDefined();
  });

  it('hands the attach panel plain props only: ids, flags, the frozen summary and the candidates', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(custom());
    mocks.loadLeagueFormatState.mockResolvedValue({ ...CUSTOM_STATE, attached: ATTACHED });
    mocks.loadAttachCandidates.mockResolvedValue({ items: [CANDIDATE], capped: true });
    mocks.getRulesetPinInfo.mockResolvedValue({ definition_id: 'def-1', name: 'Spring OU', version_id: 'rs-1', version_no: 2, update: null, can_view: true });
    const [attach] = findByType(panelOf(await render('format')), FormatAttachPanel);
    expect(attach.props).toEqual({
      seasonId: S1,
      started: false,
      rulesetId: 'rs-1',
      // The preview names the league's own pin; the labels of the rulesets a format names come with the format's detail.
      seasonRuleset: { name: 'Spring OU', version_no: 2 },
      seasonLanguage: 'de',
      manualPhaseCount: 0,
      attached: ATTACHED,
      candidates: [CANDIDATE],
      capped: true,
      phasesHref: `/admin/leagues/${S1}?tab=phases`,
    });
    expect(JSON.stringify(attach.props)).not.toMatch(/seed|"spec"|owner_id|players/);
  });

  it('a started league with hand-made phases and no ruleset passes the flags through', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(custom({ ruleset_id: null }));
    mocks.loadLeagueFormatState.mockResolvedValue({ ...CUSTOM_STATE, started: true, manualPhaseCount: 2 });
    const [attach] = findByType(panelOf(await render('format')), FormatAttachPanel);
    expect(attach.props.started).toBe(true);
    expect(attach.props.manualPhaseCount).toBe(2);
    expect(attach.props.rulesetId).toBeNull();
  });

  it('a non-custom league keeps its panel and makes none of the new reads', async () => {
    for (const format of ['singles', 'doubles', 'draft', 'evolution_point_buy']) {
      mocks.getSeasonWithDetails.mockResolvedValue(season({ format_type: format }));
      const panel = panelOf(await render('format'));
      expect(findByType(panel, FormatAttachPanel), format).toHaveLength(0);
      expect(findByType(panel, ReadinessCard), format).toHaveLength(0);
    }
    expect(mocks.loadLeagueFormatState).not.toHaveBeenCalled();
    expect(mocks.loadAttachCandidates).not.toHaveBeenCalled();
    expect(mocks.getSeasonFormatSummary).not.toHaveBeenCalled();
  });

  it('the panel source writes nothing itself', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/app/admin/leagues/[id]/_components/panels/FormatPanel.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/fetch\(|method:|'use server'|\/api\//);
  });
});
