import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fullPlayerRow, expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import { epbPack, formatPack } from '@/lib/format-pack';

// ─── Mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'de',
  getSession: vi.fn(),
  isAdmin: vi.fn(),
  getSeasonWithDetails: vi.fn(),
  getSeasonParticipants: vi.fn(),
  listRulesets: vi.fn(),
  getDraftPoolBySeason: vi.fn(),
  getDraftPoolsBySeason: vi.fn(),
  getEpbPhaseStatus: vi.fn(),
  getFormatRules: vi.fn(),
  getPendingTradeRequestsForSeason: vi.fn(),
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
vi.mock('@/lib/auth/helpers', () => ({ getSession: mocks.getSession, isAdmin: mocks.isAdmin }));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonWithDetails: mocks.getSeasonWithDetails,
  getSeasonParticipants: mocks.getSeasonParticipants,
}));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ listRulesets: mocks.listRulesets }));
vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolBySeason: mocks.getDraftPoolBySeason,
  getDraftPoolsBySeason: mocks.getDraftPoolsBySeason,
}));
vi.mock('@/lib/season/epb-phase', () => ({ getEpbPhaseStatus: mocks.getEpbPhaseStatus }));
vi.mock('@/lib/supabase/queries/format-rules', () => ({ getFormatRules: mocks.getFormatRules }));
vi.mock('@/lib/supabase/queries/redraft-trade-requests', () => ({
  getPendingTradeRequestsForSeason: mocks.getPendingTradeRequestsForSeason,
}));
vi.mock('@/components/shared/AdminGuard', () => stub('AdminGuard'));
vi.mock('@/components/ui/PageContainer', () => stub('PageContainer'));
vi.mock('@/components/ui/Section', () => stub('Section'));
vi.mock('@/components/ui/Badge', () => stub('Badge'));
vi.mock('@/components/ui/PhaseGate', () => stub('PhaseGate'));
vi.mock('@/components/league/LeagueRosterManager', () => stub('LeagueRosterManager'));
vi.mock('@/components/league/CoreLigaManager', () => stub('CoreLigaManager'));
vi.mock('@/components/league/PhaseTimeline', () => stub('PhaseTimeline'));
vi.mock('@/components/shared/ResourceAdminManager', () => stub('ResourceAdminManager'));
vi.mock('@/components/shared/ArchiveButton', () => stub('ArchiveButton'));
vi.mock('@/components/shared/DeleteResourceButton', () => stub('DeleteResourceButton'));
vi.mock('@/components/league/LeagueStatusControl', () => stub('LeagueStatusControl'));
vi.mock('@/components/league/LeagueThemeControl', () => stub('LeagueThemeControl'));
vi.mock('@/components/league/LeagueTestFlagControl', () => stub('LeagueTestFlagControl'));
vi.mock('@/components/shared/EditableDescription', () => stub('EditableDescription'));
vi.mock('@/components/league/EvolutionTierEditor', () => stub('EvolutionTierEditor'));
vi.mock('@/components/league/DraftTierLimitsEditor', () => stub('DraftTierLimitsEditor'));
vi.mock('@/components/draft/DraftPoolManager', () => stub('DraftPoolManager'));
vi.mock('@/components/league/DraftPoolEditor', () => stub('DraftPoolEditor'));
vi.mock('@/components/league/PointBuyListManager', () => stub('PointBuyListManager'));
vi.mock('@/components/league/FormatRulesEditor', () => stub('FormatRulesEditor'));
vi.mock('@/components/league/AdminPendingTrades', () => stub('AdminPendingTrades'));
vi.mock('@/components/league/EpbImportPanel', () => stub('EpbImportPanel'));
vi.mock('@/components/league/EvolutionPointRecalcButton', () => stub('EvolutionPointRecalcButton'));
vi.mock('@/components/draft-admin/TokenAdminSummary', () => stub('TokenAdminSummary'));
vi.mock('../_components/ContentLanguageControl', () => stub('ContentLanguageControl'));
vi.mock('../_components/EpbDraftRoomCreate', () => stub('EpbDraftRoomCreate'));

import AdminLeagueDetailPage from '../page';
import Link from 'next/link';
import PageContainer from '@/components/ui/PageContainer';
import Section from '@/components/ui/Section';
import DraftPoolManager from '@/components/draft/DraftPoolManager';
import TokenAdminSummary from '@/components/draft-admin/TokenAdminSummary';
import EvolutionTierEditor from '@/components/league/EvolutionTierEditor';
import AdminPendingTrades from '@/components/league/AdminPendingTrades';
import ContentLanguageControl from '../_components/ContentLanguageControl';
import EpbDraftRoomCreate from '../_components/EpbDraftRoomCreate';

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

/** Every string a viewer sees: string children plus title/subtitle props. */
function visibleText(node: ReactNode): string {
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
  return out.join(' | ');
}

function season(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    name: 'EvoLiga S3',
    format_type: 'evolution_point_buy',
    ruleset_name: 'Reg H',
    archived: false,
    is_test_season: false,
    status: 'active',
    description: null,
    route_theme: 'auto',
    point_buy_list_id: 'list-1',
    language: 'de',
    ...overrides,
  };
}

async function render(id = 's1'): Promise<ReactNode> {
  return AdminLeagueDetailPage({ params: Promise.resolve({ id }) });
}

const PARTICIPANTS = [
  { ...fullPlayerRow({ id: 'p1', name: 'Mara' }), gym_type: null, core_types: null, core_assigned_at: null },
  { ...fullPlayerRow({ id: 'p2', name: 'Misty' }), gym_type: null, core_types: null, core_assigned_at: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = 'en';
  mocks.getSession.mockResolvedValue({ user: { id: 'u1' } });
  mocks.isAdmin.mockReturnValue(true);
  mocks.getSeasonWithDetails.mockResolvedValue(season());
  mocks.getSeasonParticipants.mockResolvedValue(PARTICIPANTS);
  mocks.listRulesets.mockResolvedValue([]);
  mocks.getDraftPoolBySeason.mockResolvedValue({ id: 'pool-1', draft_type: 'budget', pick_order: 'free', status: 'in_progress' });
  mocks.getDraftPoolsBySeason.mockResolvedValue([
    { id: 'pool-1', kind: 'initial', phase: 'complete', mode: 'live', status: 'complete' },
  ]);
  mocks.getEpbPhaseStatus.mockResolvedValue({ has_first_half_matches: true, hinrunde_complete: true });
  mocks.getFormatRules.mockResolvedValue({ comeback_spend_open: true });
  mocks.getPendingTradeRequestsForSeason.mockResolvedValue([
    {
      id: 'tr1',
      player_a_id: 'p1',
      player_b_id: 'gone',
      line_a: 1,
      line_b: 2,
      consent_a: true,
      consent_b: false,
      created_at: '2026-10-01T10:00:00Z',
    },
  ]);
});

// ─── Tests ──────────────────────────────────────────────────────────

describe('admin league page (DF7b, draft-frontend §7.4)', () => {
  it('no longer imports the retired free-swap / Kill Token components', () => {
    const src = readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8');
    for (const retired of ['RedraftManager', 'KillTokenViewer', 'KillTokenAllocator', 'DraftTokenAllocator', 'DraftTokenAdminPanel']) {
      expect(src).not.toContain(retired);
    }
  });

  it('EPB: links the draft control panel from the Draft Room and Redraft sections', async () => {
    const tree = await render();
    const hrefs = findByType(tree, Link).map((l) => l.props.href);
    expect(hrefs.filter((h) => h === '/admin/leagues/s1/draft')).toHaveLength(2);
    expect(hrefs).toContain('/leagues/s1/draft');
    expect(visibleText(tree)).toContain('Open the draft control panel');
    expect(visibleText(tree)).toContain('Open the Redraft in the draft control panel');
  });

  it('EPB: mounts TokenAdminSummary with narrow participants and the season flags', async () => {
    const tree = await render();
    const [summary] = findByType(tree, TokenAdminSummary);
    expect(summary).toBeDefined();
    expect(summary.props).toMatchObject({ seasonId: 's1', comebackSpendOpen: true, hasRedraft: false });
    expect(summary.props.participants).toEqual([
      { id: 'p1', name: 'Mara' },
      { id: 'p2', name: 'Misty' },
    ]);
    expectNoPrivatePlayerData(summary.props);
    expectNoPrivatePlayerData(findByType(tree, EvolutionTierEditor)[0]?.props ?? {});
  });

  it('EPB: an unstarted legacy placeholder pool shows the create summary, not "pool active"', async () => {
    mocks.getDraftPoolBySeason.mockResolvedValue({ id: 'pool-0', draft_type: 'budget', status: 'pending', engine: 'legacy' });
    mocks.getFormatRules.mockResolvedValue(null);
    const tree = await render();
    const [create] = findByType(tree, EpbDraftRoomCreate);
    // Only the numbers the summary shows cross into the client. Without a format rules row the
    // format pack's defaults apply, and the summary must not credit them to the format rules.
    expect(create.props).toEqual({
      seasonId: 's1',
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
    const [create] = findByType(await render(), EpbDraftRoomCreate);
    expect(create.props).toEqual({ seasonId: 's1', budget: 200, rosterSize: 10, fromFormatRules: true });
  });

  it('EPB: without participants there is no create summary (the draft would have no seats)', async () => {
    mocks.getDraftPoolBySeason.mockResolvedValue(null);
    mocks.getSeasonParticipants.mockResolvedValue([]);
    const tree = await render();
    expect(findByType(tree, EpbDraftRoomCreate)).toHaveLength(0);
    expect(visibleText(tree)).toContain('Add participants in the Participants section first.');
  });

  it('EPB: one participant: no create summary (the draft could never start), the minimum is named', async () => {
    mocks.getDraftPoolBySeason.mockResolvedValue(null);
    mocks.getSeasonParticipants.mockResolvedValue(PARTICIPANTS.slice(0, 1));
    const tree = await render();
    expect(findByType(tree, EpbDraftRoomCreate)).toHaveLength(0);
    expect(visibleText(tree)).toContain('A draft needs at least 2 participants, and this league has 1.');
  });

  it('EPB: exactly the seat minimum gets the create summary', async () => {
    mocks.getDraftPoolBySeason.mockResolvedValue(null);
    expect(PARTICIPANTS).toHaveLength(2);
    expect(findByType(await render(), EpbDraftRoomCreate)).toHaveLength(1);
  });

  it('EPB: with neither a list nor participants, the list comes first', async () => {
    mocks.getDraftPoolBySeason.mockResolvedValue(null);
    mocks.getSeasonWithDetails.mockResolvedValue(season({ point_buy_list_id: null }));
    mocks.getSeasonParticipants.mockResolvedValue([]);
    const text = visibleText(await render());
    expect(text).toContain('Bind a point-buy list in the section above first.');
    expect(text).not.toContain('Add participants');
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
    const tree = await render();
    expect(findByType(tree, EpbDraftRoomCreate)).toHaveLength(0);
    expect(visibleText(tree)).toContain('A draft has room for at most 32 participants, and this league has 33.');
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
    expect(findByType(await render(), EpbDraftRoomCreate)).toHaveLength(1);
  });

  it('EPB: without a bound point-buy list there is no create summary', async () => {
    mocks.getDraftPoolBySeason.mockResolvedValue(null);
    mocks.getSeasonWithDetails.mockResolvedValue(season({ point_buy_list_id: null }));
    const tree = await render();
    expect(findByType(tree, EpbDraftRoomCreate)).toHaveLength(0);
    expect(visibleText(tree)).toContain('Bind a point-buy list in the section above first.');
  });

  it('EPB: a started pool shows "pool active" and no create form, in a collapsed Draft Room', async () => {
    const tree = await render();
    expect(findByType(tree, DraftPoolManager)).toHaveLength(0);
    expect(findByType(tree, EpbDraftRoomCreate)).toHaveLength(0);
    const room = findByType(tree, Section).find((s) => s.props.title === 'Draft Room');
    expect(room?.props.defaultCollapsed).toBe(true);
    const roomText = visibleText(room?.props.children as ReactNode);
    // A legacy pool of a point-buy season is labelled by its order and Point Buy.
    expect(roomText).toContain('Draft pool active: ');
    expect(roomText).toContain('Free order · Point Buy');
    expect(roomText).toContain(' to manage picks.');
    expect(roomText).not.toMatch(/Bind a point-buy list|Add participants/);
  });

  it('plain draft season: one three-type form, in the Draft Room (open while no draft exists), no EPB summary', async () => {
    mocks.getDraftPoolBySeason.mockResolvedValue(null);
    mocks.getSeasonWithDetails.mockResolvedValue(season({ format_type: 'draft', point_buy_list_id: null }));
    const tree = await render();
    expect(findByType(tree, DraftPoolManager)).toHaveLength(1);
    const room = findByType(tree, Section).find((s) => s.props.title === 'Draft Room');
    expect(room?.props.defaultCollapsed).toBe(false);
    expect(findByType(room?.props.children as ReactNode, DraftPoolManager)).toHaveLength(1);
    expect(findByType(tree, EpbDraftRoomCreate)).toHaveLength(0);
    expect(mocks.getFormatRules).not.toHaveBeenCalled();
  });

  it('plain draft season with a draft: no create form, the Draft Room starts collapsed', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season({ format_type: 'draft', point_buy_list_id: null }));
    const tree = await render();
    expect(findByType(tree, DraftPoolManager)).toHaveLength(0);
    const room = findByType(tree, Section).find((s) => s.props.title === 'Draft Room');
    expect(room?.props.defaultCollapsed).toBe(true);
  });

  it('hasRedraft is true once a redraft pool is complete', async () => {
    mocks.getDraftPoolsBySeason.mockResolvedValue([
      { id: 'pool-1', kind: 'initial', phase: 'complete', mode: 'live', status: 'complete' },
      { id: 'pool-2', kind: 'redraft', phase: 'complete', mode: 'live', status: 'complete' },
    ]);
    const tree = await render();
    expect(findByType(tree, TokenAdminSummary)[0].props.hasRedraft).toBe(true);
  });

  it('keeps AdminPendingTrades and translates the unknown-player fallback', async () => {
    mocks.locale = 'de';
    const tree = await render();
    const [trades] = findByType(tree, AdminPendingTrades);
    const requests = trades.props.requests as { playerAName: string; playerBName: string }[];
    expect(requests[0]).toMatchObject({ playerAName: 'Mara', playerBName: 'Unbekannter Spieler' });
  });

  it('renames Kill Tokens to the spec token names and drops the Cosmog 2:1 text', async () => {
    const text = visibleText(await render());
    expect(text).not.toMatch(/Kill Tokens?\b(?<!Draft Kill Tokens?)|Killtoken|Cosmog 2:1|Cosmo-Punkte/);
    const tokens = formatPack.messages.en.glossary.token;
    expect(text).toContain(`${tokens.draftKill}, ${tokens.comeback} and ${tokens.cosmo}`);
  });

  it('mounts the content-language control with the stored language', async () => {
    const tree = await render();
    const [control] = findByType(tree, ContentLanguageControl);
    expect(control.props).toEqual({ seasonId: 's1', currentLanguage: 'de' });
    expect(sectionTitles(tree)).toContain('Content Language');
  });

  it('falls back to the default content language when the row has none', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season({ language: undefined }));
    const [control] = findByType(await render(), ContentLanguageControl);
    expect(control.props.currentLanguage).toBe('de');
  });

  it('English: no German copy is left on the page', async () => {
    const tree = await render();
    const text = visibleText(tree);
    expect(text).not.toMatch(/Hinrunde|Archiviert|Beschreibung/);
    const [container] = findByType(tree, PageContainer);
    expect(container.props.subtitle).toBe('Evolution Point Buy · Reg H');
  });

  it('German: section titles, subtitle and archived marker are translated', async () => {
    mocks.locale = 'de';
    mocks.getSeasonWithDetails.mockResolvedValue(season({ archived: true, ruleset_name: null }));
    const tree = await render();
    const titles = sectionTitles(tree);
    expect(titles).toEqual(
      expect.arrayContaining(['Beschreibung', 'Inhaltssprache', 'Teilnehmer', 'Draft-Raum', 'Tokens', 'Redraft', 'Phasen']),
    );
    const [container] = findByType(tree, PageContainer);
    expect(container.props.subtitle).toBe('Evolution Point Buy · Archiviert');
    expect(visibleText(tree)).toContain('Hinrunde');
  });

  it('non-EPB league: no token, redraft or panel surfaces', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(season({ format_type: 'singles', point_buy_list_id: null }));
    const tree = await render();
    expect(findByType(tree, TokenAdminSummary)).toHaveLength(0);
    expect(findByType(tree, Link).map((l) => l.props.href)).not.toContain('/admin/leagues/s1/draft');
    expect(mocks.getDraftPoolsBySeason).not.toHaveBeenCalled();
    expect(sectionTitles(tree)).not.toContain('Redraft');
  });

  it('missing league → notFound', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(null);
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
