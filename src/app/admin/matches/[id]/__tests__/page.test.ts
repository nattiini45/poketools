/**
 * `/admin/matches/[id]` renders one match's admin notes and override
 * controls. `AdminGuard` admits an admin of ANY tournament or league, so the
 * page itself requires that the viewer administers THIS match: a site admin,
 * or a resource admin of the match's tournament or league, decided from the
 * live role read. The page runs as a plain async function (vitest 'node'
 * env) and its element tree is walked without rendering the children.
 *
 * The context, history, dispute and proposal reads sit behind that gate: a
 * denied viewer triggers none of them.
 */
import { isValidElement, type ReactNode } from 'react';
import Link from 'next/link';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveAccess } from '@/lib/auth/helpers';
import { fullMatchRow, PRIVATE_MATCH_SENTINELS } from '@/lib/match/__tests__/private-match-fields';

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, { value: string }>(),
  getMatchById: vi.fn(),
  getPhaseMatchById: vi.fn(),
  findNativePhaseAliasOwner: vi.fn(),
  standaloneMatchAliasExists: vi.fn(),
  readPhaseStorageMode: vi.fn(),
  isPhaseAdminFor: vi.fn(),
  getPhaseRoundById: vi.fn(),
  getPhaseWithDetails: vi.fn(),
  resolvePlayerNames: vi.fn(),
  getLiveAccess: vi.fn<() => Promise<LiveAccess | null>>(),
  isResourceAdminFor: vi.fn(),
  loadAdminMatchContext: vi.fn(),
  listMatchAuditEvents: vi.fn(),
  getLatestMatchDispute: vi.fn(),
  listMatchProposals: vi.fn(),
  countOpenPhaseMatchProposals: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
// The pages translate through `getT` (i18n-core §1.2), which reads the
// language cookie; `cookies()` needs a request scope, so it is stubbed here.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => mocks.cookies.get(name) }),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: mocks.getMatchById }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: mocks.getPhaseMatchById }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({
  findNativePhaseAliasOwner: mocks.findNativePhaseAliasOwner,
  standaloneMatchAliasExists: mocks.standaloneMatchAliasExists,
}));
vi.mock('@/lib/supabase/queries/phase-storage', () => ({ readPhaseStorageMode: mocks.readPhaseStorageMode }));
vi.mock('@/lib/supabase/queries/phase-admins', () => ({ isPhaseAdminFor: mocks.isPhaseAdminFor }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getPhaseRoundById: mocks.getPhaseRoundById }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseWithDetails: mocks.getPhaseWithDetails }));
vi.mock('@/lib/supabase/queries/players', () => ({ resolvePlayerNames: mocks.resolvePlayerNames }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: mocks.isResourceAdminFor }));
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/components/shared/AdminGuard', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/match/MatchStatusBadge', () => ({ default: () => null }));
vi.mock('@/components/match/GameList', () => ({ default: () => null }));
vi.mock('@/lib/admin/match-context', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/admin/match-context')>(),
  loadAdminMatchContext: mocks.loadAdminMatchContext,
}));
vi.mock('@/lib/audit/queries', () => ({
  listMatchAuditEvents: mocks.listMatchAuditEvents,
  getLatestMatchDispute: mocks.getLatestMatchDispute,
}));
vi.mock('@/lib/supabase/queries/match-proposals', () => ({
  listMatchProposals: mocks.listMatchProposals,
  countOpenPhaseMatchProposals: mocks.countOpenPhaseMatchProposals,
}));
vi.mock('../AdminMatchActions', () => ({ default: () => null }));
vi.mock('../MatchContextHeader', () => ({ default: () => null }));
vi.mock('../MatchDisputePanel', () => ({ default: () => null }));
vi.mock('../MatchHistoryPanel', () => ({ default: () => null }));
vi.mock('../MatchReopenSection', () => ({ default: () => null }));
vi.mock('../MatchSchedulePanel', () => ({ default: () => null }));

import AdminMatchPage from '../page';
import MatchStatusBadge from '@/components/match/MatchStatusBadge';
import AdminMatchActions from '../AdminMatchActions';
import MatchContextHeader from '../MatchContextHeader';
import MatchDisputePanel from '../MatchDisputePanel';
import MatchHistoryPanel from '../MatchHistoryPanel';
import MatchReopenSection from '../MatchReopenSection';
import MatchSchedulePanel from '../MatchSchedulePanel';
import { MatchAccessDenied } from '../match-access';
import { MATCH_HISTORY_PAGE_SIZE, type AdminMatchContext } from '@/lib/admin/match-detail';

const TOURNAMENT_ID = '11111111-1111-4111-8111-111111111111';
const MATCH_ID = '33333333-3333-4333-8333-333333333333';
const NOTES = PRIVATE_MATCH_SENTINELS.notes;
const PHASE_ID = '55555555-5555-4555-8555-555555555555';
const SEASON_ID = '66666666-6666-4666-8666-666666666666';
const ROUND_ID = '77777777-7777-4777-8777-777777777777';

const CONTEXT: AdminMatchContext = {
  league_id: 'league-1',
  league_name: 'Spring League',
  phase_id: TOURNAMENT_ID,
  phase_name: 'Group stage',
  round_id: 'round-1',
  round_name: 'Round 2',
  round_number: 2,
  round_status: 'active',
  best_of: 3,
  round_deadline: '2026-03-10T20:00:00.000Z',
  submitter_name: 'Mara Feldkamp',
};

const NEW_READS = ['loadAdminMatchContext', 'listMatchAuditEvents', 'getLatestMatchDispute', 'listMatchProposals'] as const;

function access(flags: Partial<Omit<LiveAccess, 'player'>>, playerId: string | null = 'viewer-1'): LiveAccess {
  return {
    player: playerId ? ({ playerId } as LiveAccess['player']) : null,
    isSiteAdmin: false,
    isAnyAdmin: false,
    isCreator: false,
    isSuperadmin: false,
    ...flags,
  };
}

interface Walked {
  texts: string[];
  types: unknown[];
  props: Map<unknown, Record<string, unknown>>;
  keys: Map<unknown, string | null>;
}

/** Every string, element type and element props anywhere in an element tree (props.children / props.action). */
function walk(node: ReactNode, out: Walked = { texts: [], types: [], props: new Map(), keys: new Map() }): Walked {
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, out));
  } else if (typeof node === 'string' || typeof node === 'number') {
    out.texts.push(String(node));
  } else if (isValidElement<{ children?: ReactNode; action?: ReactNode }>(node)) {
    out.types.push(node.type);
    out.props.set(node.type, node.props as Record<string, unknown>);
    out.keys.set(node.type, node.key);
    walk(node.props.children, out);
    walk(node.props.action, out);
  }
  return out;
}

async function renderPage(id = MATCH_ID) {
  return walk(await AdminMatchPage({ params: Promise.resolve({ id }) }));
}

/** Every `<Link>` href in an element tree (props.children / props.action). */
function linkHrefs(node: ReactNode, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((n) => linkHrefs(n, out));
  } else if (isValidElement<{ children?: ReactNode; action?: ReactNode; href?: string }>(node)) {
    if (node.type === Link && typeof node.props.href === 'string') out.push(node.props.href);
    linkHrefs(node.props.children, out);
    linkHrefs(node.props.action, out);
  }
  return out;
}

/** The page's bottom link: the only one that is neither the replay import nor a game page. */
async function backHref(back?: string | string[]): Promise<string> {
  const tree = await AdminMatchPage({
    params: Promise.resolve({ id: MATCH_ID }),
    ...(back === undefined ? {} : { searchParams: Promise.resolve({ back }) }),
  });
  const hrefs = linkHrefs(tree).filter((h) => h.startsWith('/admin/matches') && !h.includes('/import-replay'));
  expect(hrefs).toHaveLength(1);
  return hrefs[0];
}

/** The props of the AdminMatchActions element in an element tree. */
function findAction(node: ReactNode): { backSuffix?: string } | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findAction(n);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<{ children?: ReactNode; backSuffix?: string }>(node)) return null;
  if (node.type === AdminMatchActions) return node.props;
  return findAction(node.props.children);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('READ_PHASE_STORAGE_STATE', undefined);
  mocks.cookies.clear();
  mocks.getMatchById.mockResolvedValue(fullMatchRow({ id: MATCH_ID, tournament_id: TOURNAMENT_ID }));
  mocks.getLiveAccess.mockResolvedValue(null);
  mocks.isResourceAdminFor.mockResolvedValue(false);
  mocks.loadAdminMatchContext.mockResolvedValue(CONTEXT);
  mocks.listMatchAuditEvents.mockResolvedValue({ entries: [], total: 0, offset: 0, limit: MATCH_HISTORY_PAGE_SIZE });
  mocks.getLatestMatchDispute.mockResolvedValue(null);
  mocks.listMatchProposals.mockResolvedValue([]);
  mocks.countOpenPhaseMatchProposals.mockResolvedValue(0);
});

afterEach(() => vi.unstubAllEnvs());

describe('native admin match detail', () => {
  beforeEach(() => {
    vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
    mocks.readPhaseStorageMode.mockResolvedValue('phase');
    mocks.findNativePhaseAliasOwner.mockResolvedValue({ kind: 'phase', phase_id: PHASE_ID, season_id: SEASON_ID });
    const match = fullMatchRow({ id: MATCH_ID, round_id: ROUND_ID, status: 'disputed' });
    const { tournament_id: _tournamentId, ...phaseMatch } = match;
    mocks.getPhaseMatchById.mockResolvedValue({ ...phaseMatch, phase_id: PHASE_ID });
    mocks.isPhaseAdminFor.mockResolvedValue(true);
    mocks.getLiveAccess.mockResolvedValue({
      ...access({}),
      player: { playerId: 'viewer-1', status: 'active', isAdmin: false } as LiveAccess['player'],
    });
    mocks.getPhaseRoundById.mockResolvedValue({
      id: ROUND_ID, phase_id: PHASE_ID, name: 'Round 2', round_number: 2, status: 'active', best_of: 5, deadline: null,
    });
    mocks.getPhaseWithDetails.mockResolvedValue({ id: PHASE_ID, season_id: SEASON_ID, name: 'Groups', season_name: 'Sample League' });
    mocks.resolvePlayerNames.mockResolvedValue({});
  });

  it('uses live phase ownership, native context and canonical links for a phase-only admin', async () => {
    const tree = await AdminMatchPage({
      params: Promise.resolve({ id: MATCH_ID }),
      searchParams: Promise.resolve({ back: '//outside.example' }),
    });
    const { texts, types, props } = walk(tree);
    const phaseUrl = `/leagues/${SEASON_ID}/phases/${PHASE_ID}`;
    expect(texts).toContain(NOTES);
    expect(linkHrefs(tree)).toEqual([`${phaseUrl}?tab=rounds`]);
    expect(props.get(MatchContextHeader)).toMatchObject({
      publicHref: `${phaseUrl}/matches/${MATCH_ID}`, listHref: `${phaseUrl}?tab=rounds`,
      context: { league_name: 'Sample League', phase_name: 'Groups', best_of: 5 },
    });
    expect(props.get(AdminMatchActions)).toMatchObject({ correctionsOnly: true, bestOf: 5, isSiteAdmin: false, backSuffix: '' });
    expect(props.get(MatchReopenSection)).toMatchObject({ native: true });
    for (const panel of [MatchHistoryPanel, MatchDisputePanel]) expect(types).not.toContain(panel);
    expect(props.get(MatchSchedulePanel)).toMatchObject({ matchId: MATCH_ID, pendingProposals: 0 });
    expect(mocks.countOpenPhaseMatchProposals).toHaveBeenCalledExactlyOnceWith(MATCH_ID, expect.any(String));
    expect(mocks.isPhaseAdminFor).toHaveBeenCalledWith('viewer-1', PHASE_ID);
    expect(mocks.getPhaseRoundById).toHaveBeenCalledWith(ROUND_ID, PHASE_ID);
    expect(mocks.getPhaseWithDetails).toHaveBeenCalledWith(PHASE_ID, SEASON_ID);
    expect(mocks.getMatchById).not.toHaveBeenCalled();
    for (const read of NEW_READS) expect(mocks[read]).not.toHaveBeenCalled();
  });

  it('does not send private notes or load context after revocation on a page render', async () => {
    mocks.isPhaseAdminFor.mockResolvedValue(false);
    const { texts, types } = await renderPage();
    expect(texts).not.toContain(NOTES);
    expect(types).not.toContain(AdminMatchActions);
    expect(mocks.getPhaseWithDetails).not.toHaveBeenCalled();
    expect(mocks.resolvePlayerNames).not.toHaveBeenCalled();
    expect(mocks.countOpenPhaseMatchProposals).not.toHaveBeenCalled();
  });

  it('keeps a native proposal count failure distinct from a real zero', async () => {
    mocks.countOpenPhaseMatchProposals.mockRejectedValueOnce(new Error('Count unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { props } = await renderPage();
      expect(props.get(MatchSchedulePanel)).toMatchObject({ matchId: MATCH_ID, pendingProposals: null });
      expect(mocks.listMatchProposals).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it('renders the native schedule read-only on completion without counting proposals', async () => {
    const match = fullMatchRow({ id: MATCH_ID, round_id: ROUND_ID, status: 'completed' });
    const { tournament_id: _tournamentId, ...phaseMatch } = match;
    mocks.getPhaseMatchById.mockResolvedValue({ ...phaseMatch, phase_id: PHASE_ID });
    const { props } = await renderPage();
    expect(props.get(MatchSchedulePanel)).toMatchObject({ status: 'completed' });
    expect(mocks.countOpenPhaseMatchProposals).not.toHaveBeenCalled();
    expect(mocks.listMatchProposals).not.toHaveBeenCalled();
  });

  it('a new detail entry still checks legacy ownership even when the phase-only viewer keeps the layout', async () => {
    expect((await renderPage()).texts).toContain(NOTES);
    const standaloneId = '88888888-8888-4888-8888-888888888888';
    mocks.findNativePhaseAliasOwner.mockResolvedValue(null);
    mocks.standaloneMatchAliasExists.mockResolvedValue(true);
    mocks.getMatchById.mockResolvedValue(fullMatchRow({ id: standaloneId, tournament_id: TOURNAMENT_ID }));
    const { texts, types } = await renderPage(standaloneId);
    expect(texts).not.toContain(NOTES);
    expect(types).not.toContain(AdminMatchActions);
    expect(mocks.loadAdminMatchContext).not.toHaveBeenCalled();
  });

  it('does not link to the legacy replay import page for a scheduled native match', async () => {
    const { tournament_id: _tournamentId, ...phaseMatch } = fullMatchRow({
      id: MATCH_ID, round_id: ROUND_ID, status: 'scheduled',
    });
    mocks.getPhaseMatchById.mockResolvedValue({ ...phaseMatch, phase_id: PHASE_ID });
    const tree = await AdminMatchPage({ params: Promise.resolve({ id: MATCH_ID }) });
    expect(linkHrefs(tree).some((href) => href.includes('/import-replay'))).toBe(false);
  });

  it('rejects a mismatched phase without falling back to historical rows', async () => {
    mocks.getPhaseMatchById.mockResolvedValue({ id: MATCH_ID, phase_id: SEASON_ID });
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getMatchById).not.toHaveBeenCalled();
    expect(mocks.isPhaseAdminFor).not.toHaveBeenCalled();
  });

  it('does not join context from a different league', async () => {
    mocks.getPhaseWithDetails.mockResolvedValue({ id: PHASE_ID, season_id: PHASE_ID });
    await expect(renderPage()).rejects.toThrow(`Phase ${PHASE_ID} not found in league ${SEASON_ID}`);
  });

  it('refuses on a frozen mode without opening either match store', async () => {
    mocks.readPhaseStorageMode.mockResolvedValue('frozen_phase');
    await expect(renderPage()).rejects.toMatchObject({ code: 'phase_storage_unavailable' });
    expect(mocks.findNativePhaseAliasOwner).not.toHaveBeenCalled();
    expect(mocks.getMatchById).not.toHaveBeenCalled();
  });

  it('admits an active standalone tournament only with the matching standalone owner', async () => {
    mocks.findNativePhaseAliasOwner.mockResolvedValue(null);
    mocks.standaloneMatchAliasExists.mockResolvedValue(true);
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.isResourceAdminFor.mockResolvedValue(true);

    const { props, types } = await renderPage();
    expect(mocks.standaloneMatchAliasExists).toHaveBeenCalledWith(MATCH_ID, TOURNAMENT_ID);
    expect(mocks.isResourceAdminFor).toHaveBeenCalledWith('viewer-1', 'tournament', TOURNAMENT_ID);
    expect(props.get(AdminMatchActions)).toMatchObject({ correctionsOnly: false });
    expect(types).toContain(MatchHistoryPanel);
    expect(mocks.isPhaseAdminFor).not.toHaveBeenCalled();

    mocks.standaloneMatchAliasExists.mockResolvedValue(false);
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('AdminMatchPage: per-match access', () => {
  it('signed out: neither notes nor controls (AdminGuard sends to sign-in)', async () => {
    const { texts, types } = await renderPage();

    expect(texts).not.toContain(NOTES);
    expect(types).toContain(MatchAccessDenied);
    expect(types).not.toContain(AdminMatchActions);
    for (const read of NEW_READS) expect(mocks[read]).not.toHaveBeenCalled();
  });

  it('a player who is no admin: neither notes nor controls', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({}));

    const { texts, types } = await renderPage();

    expect(texts).not.toContain(NOTES);
    expect(types).not.toContain(AdminMatchActions);
    expect(mocks.isResourceAdminFor).not.toHaveBeenCalled();
    for (const read of NEW_READS) expect(mocks[read]).not.toHaveBeenCalled();
  });

  it('a resource admin of ANOTHER tournament or league: access denied, no notes', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.isResourceAdminFor.mockResolvedValue(false);

    const { texts, types } = await renderPage();

    expect(mocks.isResourceAdminFor).toHaveBeenCalledWith('viewer-1', 'tournament', TOURNAMENT_ID);
    expect(texts).not.toContain(NOTES);
    expect(types).toContain(MatchAccessDenied);
    expect(types).not.toContain(AdminMatchActions);
    for (const read of NEW_READS) expect(mocks[read]).not.toHaveBeenCalled();
  });

  it("a resource admin of the match's tournament (or its league): sees notes and controls", async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.isResourceAdminFor.mockResolvedValue(true);

    const { texts, types } = await renderPage();

    expect(texts).toContain(NOTES);
    expect(types).toContain(AdminMatchActions);
    expect(types).not.toContain(MatchAccessDenied);
  });

  it('a site admin (live): sees notes and controls without a resource lookup', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));

    const { texts, types } = await renderPage();

    expect(texts).toContain(NOTES);
    expect(types).toContain(AdminMatchActions);
    expect(mocks.isResourceAdminFor).not.toHaveBeenCalled();
    expect(mocks.readPhaseStorageMode).not.toHaveBeenCalled();
    expect(mocks.findNativePhaseAliasOwner).not.toHaveBeenCalled();
  });

  it('a site admin sees every section of the match page, in order, and the context supplies the format', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));

    const { types, props } = await renderPage();

    const sections = [
      MatchContextHeader,
      MatchSchedulePanel,
      AdminMatchActions,
      MatchReopenSection,
      MatchHistoryPanel,
    ];
    for (const section of sections) expect(types).toContain(section);
    const order = sections.map((section) => types.indexOf(section));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(props.get(AdminMatchActions)).toMatchObject({ bestOf: 3, matchId: MATCH_ID });
    expect(props.get(MatchSchedulePanel)).toMatchObject({ roundDeadline: CONTEXT.round_deadline });
    expect(props.get(MatchContextHeader)).toMatchObject({ context: CONTEXT });
    expect(mocks.listMatchAuditEvents).toHaveBeenCalledWith(MATCH_ID, { limit: MATCH_HISTORY_PAGE_SIZE, offset: 0 });
  });

  it('the dispute panel and its read exist only for a disputed match', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));

    const completed = await renderPage();
    expect(completed.types).not.toContain(MatchDisputePanel);
    expect(mocks.getLatestMatchDispute).not.toHaveBeenCalled();

    const dispute = {
      actor_id: 'player-2',
      actor_name: 'Jonas Reed',
      disputed_at: '2026-03-02T10:00:00.000Z',
      reason: 'Wrong winner',
      by_admin: false,
    };
    mocks.getLatestMatchDispute.mockResolvedValue(dispute);
    mocks.getMatchById.mockResolvedValue(fullMatchRow({ id: MATCH_ID, tournament_id: TOURNAMENT_ID, status: 'disputed' }));

    const disputed = await renderPage();
    expect(disputed.types).toContain(MatchDisputePanel);
    expect(mocks.getLatestMatchDispute).toHaveBeenCalledWith(MATCH_ID);
    expect(disputed.props.get(MatchDisputePanel)).toMatchObject({
      dispute,
      reportedWinnerName: 'Mara Feldkamp',
      reporterName: 'Mara Feldkamp',
    });
  });

  it('keys the history panel on the newest event, so a refresh after an action remounts it', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    const event = (id: string) => ({
      id,
      action: 'match.reopen',
      actor_id: null,
      actor_name: 'Admin',
      created_at: '2026-03-02T10:00:00.000Z',
      reason: null,
      changes: null,
    });
    mocks.listMatchAuditEvents.mockResolvedValue({ entries: [event('e1')], total: 1, offset: 0, limit: MATCH_HISTORY_PAGE_SIZE });
    const before = (await renderPage()).keys.get(MatchHistoryPanel);
    mocks.listMatchAuditEvents.mockResolvedValue({
      entries: [event('e2'), event('e1')],
      total: 2,
      offset: 0,
      limit: MATCH_HISTORY_PAGE_SIZE,
    });
    const after = (await renderPage()).keys.get(MatchHistoryPanel);

    expect(before).toBeTruthy();
    expect(after).not.toBe(before);
  });

  it('still renders the controls when the history, dispute or proposal read fails', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    mocks.getMatchById.mockResolvedValue(fullMatchRow({ id: MATCH_ID, tournament_id: TOURNAMENT_ID, status: 'disputed' }));
    mocks.listMatchAuditEvents.mockRejectedValue(new Error('slow'));
    mocks.getLatestMatchDispute.mockRejectedValue(new Error('down'));
    mocks.listMatchProposals.mockRejectedValue(new Error('down'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { types, props } = await renderPage();

    expect(types).toContain(AdminMatchActions);
    expect(types).toContain(MatchReopenSection);
    expect(props.get(MatchHistoryPanel)).toMatchObject({ loadFailed: true, initialPage: { entries: [], total: 0 } });
    expect(props.get(MatchDisputePanel)).toMatchObject({ dispute: null });
    expect(props.get(MatchSchedulePanel)).toMatchObject({ pendingProposals: 0 });
    expect(log).toHaveBeenCalledTimes(3);
    log.mockRestore();
  });

  it('a failed match or context read is still fatal', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    mocks.loadAdminMatchContext.mockRejectedValue(new Error('context down'));
    await expect(renderPage()).rejects.toThrow('context down');
  });

  it('counts only the proposals that are pending and not yet expired', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const past = new Date(Date.now() - 3_600_000).toISOString();
    mocks.listMatchProposals.mockResolvedValue([
      { status: 'pending', expires_at: future },
      { status: 'pending', expires_at: future },
      { status: 'pending', expires_at: past },
      { status: 'rejected', expires_at: future },
    ]);

    const { props } = await renderPage();

    expect(props.get(MatchSchedulePanel)).toMatchObject({ pendingProposals: 2 });
    expect(mocks.countOpenPhaseMatchProposals).not.toHaveBeenCalled();
  });

  it('a failed live read fails closed (rethrows)', async () => {
    mocks.getLiveAccess.mockRejectedValue(new Error('db down'));
    await expect(renderPage()).rejects.toThrow('db down');
  });

  it('404s a malformed match id without querying', async () => {
    await expect(renderPage('abc')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getMatchById).not.toHaveBeenCalled();
  });
});

describe('AdminMatchPage: series length', () => {
  // The round is read once, by the match context: its best-of reaches the controls (series tally, delete impact).
  it('passes the best-of of the match round, as the context reads it, to the controls', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    mocks.loadAdminMatchContext.mockResolvedValue({ ...CONTEXT, best_of: 5 });
    const { props } = await renderPage();

    expect(mocks.loadAdminMatchContext).toHaveBeenCalledTimes(1);
    expect(props.get(AdminMatchActions)).toMatchObject({ bestOf: 5 });
  });

  it('does not render the controls without the round: an unreadable round fails the whole read', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    mocks.loadAdminMatchContext.mockRejectedValue(new Error('Round r-1 not found'));

    await expect(renderPage()).rejects.toThrow('Round r-1 not found');
  });
});

describe('AdminMatchPage: language (i18n-core §8.2)', () => {
  it('English by default: chrome and the labelled status', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));

    const { texts, props } = await renderPage();

    expect(texts).toContain('Back to matches');
    expect(texts).toContain('Winner:');
    // The status is worded by the badge alone (its labels: MatchStatusBadge.test.tsx).
    expect(props.get(MatchStatusBadge)).toMatchObject({ status: 'completed' });
  });

  it('German with plc_locale=de: chrome and the status label from the enums namespace', async () => {
    mocks.cookies.set('plc_locale', { value: 'de' });
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));

    const { texts } = await renderPage();

    expect(texts).toContain('Zurück zu den Spielen');
    expect(texts).toContain('Sieger:');
    expect(texts).not.toContain('completed');
  });

  it('the access-denied notice follows the language cookie', async () => {
    mocks.cookies.set('plc_locale', { value: 'de' });
    const { texts } = walk(await MatchAccessDenied());
    expect(texts).toContain('Zugriff verweigert');
  });
});

describe('AdminMatchPage: back link to the Matches list', () => {
  const LEAGUE = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    // The replay import link only exists while the match can still take a result.
    mocks.getMatchById.mockResolvedValue(fullMatchRow({ id: MATCH_ID, tournament_id: TOURNAMENT_ID, status: 'scheduled' }));
  });

  it('is the plain list without a back parameter', async () => {
    expect(await backHref()).toBe('/admin/matches');
  });

  it('restores a real list query in canonical order', async () => {
    expect(await backHref(`page=2&league=${LEAGUE}&status=disputed`)).toBe(
      `/admin/matches?status=disputed&league=${LEAGUE}&page=2`,
    );
  });

  it('accepts a leading question mark', async () => {
    expect(await backHref('?status=disputed')).toBe('/admin/matches?status=disputed');
  });

  it('keeps only validated keys and values', async () => {
    const href = await backHref(`status=disputed&evil=1&league=not-a-uuid&redirect=https://evil.example`);
    expect(href).toBe('/admin/matches?status=disputed');
  });

  it.each(['//evil.example', 'https://evil.example/x', 'javascript:alert(1)', '/admin/../../etc'])(
    'never lets %s leave the Matches list',
    async (raw) => {
      const href = await backHref(raw);
      expect(href).toMatch(/^\/admin\/matches(\?|$)/);
      expect(href).not.toContain('evil');
      expect(href).not.toContain('javascript');
    },
  );

  it('uses the first value of an array parameter and ignores an over-long one', async () => {
    expect(await backHref(['status=disputed', 'status=completed'])).toBe('/admin/matches?status=disputed');
    expect(await backHref(`q=${'a'.repeat(2000)}`)).toBe('/admin/matches');
  });

  describe('the detours keep the list query', () => {
    const renderWith = (back?: string) =>
      AdminMatchPage({
        params: Promise.resolve({ id: MATCH_ID }),
        ...(back === undefined ? {} : { searchParams: Promise.resolve({ back }) }),
      });
    const importHref = async (back?: string) => linkHrefs(await renderWith(back)).find((h) => h.includes('/import-replay'));
    const actionsSuffix = async (back?: string) => findAction(await renderWith(back))?.backSuffix;

    it('appends the canonical back query to the replay import link and hands it to the game edit links', async () => {
      const suffix = `?back=${encodeURIComponent('status=disputed&page=2')}`;
      expect(await importHref('page=2&status=disputed')).toBe(`/admin/matches/${MATCH_ID}/import-replay${suffix}`);
      expect(await actionsSuffix('page=2&status=disputed')).toBe(suffix);
    });

    it('drops an invalid or missing back value from both', async () => {
      expect(await importHref('//evil.example')).toBe(`/admin/matches/${MATCH_ID}/import-replay`);
      expect(await actionsSuffix('//evil.example')).toBe('');
      expect(await importHref()).toBe(`/admin/matches/${MATCH_ID}/import-replay`);
    });
  });
});
