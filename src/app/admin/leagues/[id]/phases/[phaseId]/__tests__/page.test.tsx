import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'de',
  getLiveAccess: vi.fn(),
  isResourceAdminFor: vi.fn(),
  getSeasonById: vi.fn(),
  getTournamentWithDetails: vi.fn(),
  getRoundsByTournament: vi.fn(),
  seasonHasGroups: vi.fn(),
  getSeasonGroupMembership: vi.fn(),
  getGroupsByTournament: vi.fn(),
  listRulesets: vi.fn(),
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
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: mocks.isResourceAdminFor }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: mocks.getSeasonById }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentWithDetails: mocks.getTournamentWithDetails }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: mocks.getRoundsByTournament }));
vi.mock('@/lib/supabase/queries/season-groups', () => ({
  seasonHasGroups: mocks.seasonHasGroups,
  getSeasonGroupMembership: mocks.getSeasonGroupMembership,
}));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({ getGroupsByTournament: mocks.getGroupsByTournament }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ listRulesets: mocks.listRulesets }));
vi.mock('@/components/shared/AdminGuard', () => stub('AdminGuard'));
vi.mock('@/components/ui/PageContainer', () => stub('PageContainer'));
vi.mock('@/components/ui/Section', () => stub('Section'));
vi.mock('@/components/ui/Alert', () => stub('Alert'));
vi.mock('@/components/league/PhaseOverviewEditor', () => stub('PhaseOverviewEditor'));
vi.mock('@/components/tournament/ParticipantManager', () => stub('ParticipantManager'));
vi.mock('@/components/league/PhaseGroupsPanel', () => stub('PhaseGroupsPanel'));
vi.mock('@/components/tournament/RoundManager', () => stub('RoundManager'));
vi.mock('@/components/tournament/TournamentLifecycleActions', () => stub('TournamentLifecycleActions'));
vi.mock('@/components/shared/EditableDescription', () => stub('EditableDescription'));

import AdminLeaguePhasePage from '../page';
import AdminGuard from '@/components/shared/AdminGuard';
import Section from '@/components/ui/Section';
import ParticipantManager from '@/components/tournament/ParticipantManager';
import RoundManager from '@/components/tournament/RoundManager';
import PhaseOverviewEditor from '@/components/league/PhaseOverviewEditor';
import TournamentLifecycleActions from '@/components/tournament/TournamentLifecycleActions';

const S1 = '5e150000-0000-4000-8000-000000000001';
const T1 = '7a000000-0000-4000-8000-000000000001';

// ─── Helpers ────────────────────────────────────────────────────────

type El = ReactElement<Record<string, unknown>>;

function findByType(node: ReactNode, type: unknown): El[] {
  const found: El[] = [];
  const walk = (n: ReactNode): void => {
    if (Array.isArray(n)) n.forEach((c) => walk(c as ReactNode));
    else if (isValidElement<Record<string, unknown>>(n)) {
      if (n.type === type) found.push(n);
      walk(n.props.children as ReactNode);
      if (n.props.action) walk(n.props.action as ReactNode);
    }
  };
  walk(node);
  return found;
}

function text(node: ReactNode): string {
  const out: string[] = [];
  const collect = (n: ReactNode): void => {
    if (typeof n === 'string' || typeof n === 'number') out.push(String(n));
    else if (Array.isArray(n)) n.forEach((c) => collect(c as ReactNode));
    else if (isValidElement<Record<string, unknown>>(n)) collect(n.props.children as ReactNode);
  };
  collect(node);
  return out.join('');
}

function liveAccess(overrides: Partial<{ isSiteAdmin: boolean; isAnyAdmin: boolean }> = {}) {
  return { player: { playerId: 'u1' }, isSiteAdmin: true, isAnyAdmin: true, isCreator: true, ...overrides };
}

const PHASE_READS = [
  'getSeasonById',
  'getTournamentWithDetails',
  'getRoundsByTournament',
  'seasonHasGroups',
  'getGroupsByTournament',
  'listRulesets',
] as const;

function phaseReads(): string[] {
  return PHASE_READS.filter((name) => mocks[name].mock.calls.length > 0);
}

function render(id = S1, phaseId = T1) {
  return AdminLeaguePhasePage({ params: Promise.resolve({ id, phaseId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = 'en';
  mocks.getLiveAccess.mockResolvedValue(liveAccess());
  mocks.isResourceAdminFor.mockResolvedValue(true);
  mocks.getSeasonById.mockResolvedValue({ id: S1, name: 'Summer League S3' });
  mocks.getTournamentWithDetails.mockResolvedValue({
    id: T1,
    season_id: S1,
    name: 'Group stage',
    description: null,
    bracket_type: 'round_robin',
    best_of_default: 3,
    status: 'active',
    stage_order: 1,
    participant_count: 4,
    ruleset_name: 'Standard OU',
    archived: false,
  });
  mocks.getRoundsByTournament.mockResolvedValue([]);
  mocks.seasonHasGroups.mockResolvedValue(false);
  mocks.getGroupsByTournament.mockResolvedValue([]);
  mocks.getSeasonGroupMembership.mockResolvedValue({});
  mocks.listRulesets.mockResolvedValue([]);
});

// ─── Access ─────────────────────────────────────────────────────────

describe('admin league phase page: per-league access', () => {
  it('a site admin gets the phase managers and phase delete, without the per-league check', async () => {
    const tree = await render();
    expect(findByType(tree, ParticipantManager)).toHaveLength(1);
    expect(findByType(tree, RoundManager)).toHaveLength(1);
    expect(findByType(tree, PhaseOverviewEditor)).toHaveLength(1);
    expect(findByType(tree, TournamentLifecycleActions)[0].props.canDelete).toBe(true);
    expect(mocks.isResourceAdminFor).not.toHaveBeenCalled();
    expect(phaseReads()).toEqual([...PHASE_READS]);
  });

  it('an admin of this league gets the managers, but no phase delete', async () => {
    mocks.getLiveAccess.mockResolvedValue(liveAccess({ isSiteAdmin: false }));
    const tree = await render();
    expect(mocks.isResourceAdminFor).toHaveBeenCalledWith('u1', 'season', S1);
    expect(findByType(tree, ParticipantManager)).toHaveLength(1);
    expect(findByType(tree, RoundManager)).toHaveLength(1);
    expect(findByType(tree, TournamentLifecycleActions)[0].props.canDelete).toBe(false);
  });

  it('an admin of another league: the forbidden notice and no phase reads (en + de)', async () => {
    mocks.getLiveAccess.mockResolvedValue(liveAccess({ isSiteAdmin: false }));
    mocks.isResourceAdminFor.mockResolvedValue(false);
    const tree = await render();
    expect((tree as El).type).toBe(AdminGuard);
    expect(text(tree)).toBe('Only admins of this league can open its phases.');
    expect(findByType(tree, ParticipantManager)).toHaveLength(0);
    expect(findByType(tree, RoundManager)).toHaveLength(0);
    expect(mocks.isResourceAdminFor).toHaveBeenCalledWith('u1', 'season', S1);
    expect(phaseReads()).toEqual([]);
    mocks.locale = 'de';
    expect(text(await render())).toBe('Nur Admins dieser Liga können ihre Phasen öffnen.');
  });

  it('not an admin: only the guard, and no phase reads', async () => {
    mocks.getLiveAccess.mockResolvedValue(liveAccess({ isSiteAdmin: false, isAnyAdmin: false }));
    const tree = await render();
    expect((tree as El).type).toBe(AdminGuard);
    expect((tree as El).props.children).toBeNull();
    expect(mocks.isResourceAdminFor).not.toHaveBeenCalled();
    expect(phaseReads()).toEqual([]);
  });

  it('signed out: only the guard (it redirects)', async () => {
    mocks.getLiveAccess.mockResolvedValue(null);
    const tree = await render();
    expect((tree as El).type).toBe(AdminGuard);
    expect(phaseReads()).toEqual([]);
  });

  it('malformed ids → notFound before any read', async () => {
    for (const [id, phaseId] of [['s1', T1], [S1, 'nope'], [`${S1}x`, T1]]) {
      await expect(render(id, phaseId)).rejects.toThrow('NEXT_NOT_FOUND');
    }
    expect(mocks.getLiveAccess).not.toHaveBeenCalled();
    expect(phaseReads()).toEqual([]);
  });

  it('a failed per-league read fails closed (the page throws, no phase is read)', async () => {
    mocks.getLiveAccess.mockResolvedValue(liveAccess({ isSiteAdmin: false }));
    mocks.isResourceAdminFor.mockRejectedValue(new Error('db down'));
    await expect(render()).rejects.toThrow('db down');
    expect(phaseReads()).toEqual([]);
  });

  it('a phase of another league → notFound', async () => {
    mocks.getTournamentWithDetails.mockResolvedValue({ id: T1, season_id: 'other' });
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('the page source no longer reads the session copy', () => {
    const src = readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8');
    expect(src).not.toMatch(/\bisAdmin\(|getSession\(/);
  });
});

// ─── Start-up checklist inputs ──────────────────────────────────────

function sectionById(tree: ReactNode, id: string): El {
  const section = findByType(tree, Section).find((el) => el.props.id === id);
  if (!section) throw new Error(`no section ${id}`);
  return section;
}

describe('admin league phase page: start-up checklist inputs', () => {
  it('feeds the round manager the ruleset name, the groups flag and the links', async () => {
    const tree = await render();
    const props = findByType(tree, RoundManager)[0].props;
    expect(props.rulesetName).toBe('Standard OU');
    expect(props.groupsInUse).toBe(false);
    expect(props.leagueGroupOf).toBeNull();
    expect(props.checklistLinks).toEqual({
      participants: '#tournament-participants',
      overview: '#tournament-overview',
      rounds: '#tournament-rounds',
      leagueGroups: `/admin/leagues/${S1}?tab=participants`,
    });
    expect(mocks.getGroupsByTournament).toHaveBeenCalledWith(T1);
    expect(mocks.getSeasonGroupMembership).not.toHaveBeenCalled();
  });

  it('gives the overview, participants and rounds sections the anchor ids the links use', async () => {
    const tree = await render();
    for (const id of ['tournament-overview', 'tournament-participants', 'tournament-rounds']) {
      expect(sectionById(tree, id)).toBeDefined();
    }
  });

  it('a phase with its own groups counts as grouped even in a league without groups', async () => {
    mocks.getGroupsByTournament.mockResolvedValue([{ id: 'g1' }]);
    const props = findByType(await render(), RoundManager)[0].props;
    expect(props.groupsInUse).toBe(true);
    expect(props.leagueGroupOf).toBeNull();
  });

  it('a grouped league hands a Swiss or round-robin phase the membership map (ids only)', async () => {
    mocks.seasonHasGroups.mockResolvedValue(true);
    mocks.getSeasonGroupMembership.mockResolvedValue({ p1: 'gA', p2: 'gB' });
    const props = findByType(await render(), RoundManager)[0].props;
    expect(mocks.getSeasonGroupMembership).toHaveBeenCalledWith(S1);
    expect(props.groupsInUse).toBe(true);
    expect(props.leagueGroupOf).toEqual({ p1: 'gA', p2: 'gB' });
  });

  it('a grouped league does not read the membership for an elimination phase', async () => {
    mocks.seasonHasGroups.mockResolvedValue(true);
    mocks.getTournamentWithDetails.mockResolvedValue({
      ...(await mocks.getTournamentWithDetails()),
      bracket_type: 'single_elim',
    });
    const props = findByType(await render(), RoundManager)[0].props;
    expect(mocks.getSeasonGroupMembership).not.toHaveBeenCalled();
    expect(props.leagueGroupOf).toBeNull();
  });

  describe('the participants section', () => {
    const phase = (participantCount: number) => ({
      id: T1,
      season_id: S1,
      name: 'Group stage',
      description: null,
      bracket_type: 'swiss',
      best_of_default: 3,
      status: 'active',
      stage_order: 1,
      participant_count: participantCount,
      ruleset_name: 'Standard OU',
      archived: false,
    });
    const STARTED = [{ id: 'r1', status: 'active' }];

    it('is open with no participants', async () => {
      mocks.getTournamentWithDetails.mockResolvedValue(phase(0));
      const section = sectionById(await render(), 'tournament-participants');
      expect(section.props.defaultCollapsed).toBe(false);
      expect(section.props.collapsible).toBe(true);
    });

    it('is open with one participant on a phase that already has rounds', async () => {
      mocks.getTournamentWithDetails.mockResolvedValue(phase(1));
      mocks.getRoundsByTournament.mockResolvedValue(STARTED);
      expect(sectionById(await render(), 'tournament-participants').props.defaultCollapsed).toBe(false);
    });

    it('is open and fixed for a new phase (participants, no rounds yet)', async () => {
      mocks.getTournamentWithDetails.mockResolvedValue(phase(8));
      const section = sectionById(await render(), 'tournament-participants');
      expect(section.props.defaultCollapsed).toBe(false);
      expect(section.props.collapsible).toBe(false);
    });

    it('stays collapsed on a phase fed by a previous phase, so viewing it does not sync the roster', async () => {
      const rule = { type: 'top_n', count: 2, per_group: true };
      for (const fed of [
        { advancement_rule: rule },
        { enrollment_source: { type: 'standings', synced_at: '2026-10-24T10:00:00Z', frozen: false } },
        { stage_order: 2 },
      ]) {
        mocks.getTournamentWithDetails.mockResolvedValue({ ...phase(0), ...fed });
        const section = sectionById(await render(), 'tournament-participants');
        expect(section.props.defaultCollapsed).toBe(true);
        expect(section.props.collapsible).toBe(true);
      }
    });

    it('is still open for a new phase fed by a previous phase (it has participants and no rounds)', async () => {
      mocks.getTournamentWithDetails.mockResolvedValue({
        ...phase(4),
        stage_order: 2,
        advancement_rule: { type: 'top_n', count: 2, per_group: true },
      });
      const section = sectionById(await render(), 'tournament-participants');
      expect(section.props.defaultCollapsed).toBe(false);
      expect(section.props.collapsible).toBe(false);
    });

    it('is collapsed on a started phase with enough participants', async () => {
      mocks.getTournamentWithDetails.mockResolvedValue(phase(8));
      mocks.getRoundsByTournament.mockResolvedValue(STARTED);
      const section = sectionById(await render(), 'tournament-participants');
      expect(section.props.defaultCollapsed).toBe(true);
      expect(section.props.collapsible).toBe(true);
    });
  });
});
