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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveAccess } from '@/lib/auth/helpers';
import { fullMatchRow, PRIVATE_MATCH_SENTINELS } from '@/lib/match/__tests__/private-match-fields';

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, { value: string }>(),
  getMatchById: vi.fn(),
  getLiveAccess: vi.fn<() => Promise<LiveAccess | null>>(),
  isResourceAdminFor: vi.fn(),
  loadAdminMatchContext: vi.fn(),
  listMatchAuditEvents: vi.fn(),
  getLatestMatchDispute: vi.fn(),
  listMatchProposals: vi.fn(),
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
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: mocks.isResourceAdminFor }));
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/components/shared/AdminGuard', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/match/MatchStatusBadge', () => ({ default: () => null }));
vi.mock('@/components/match/GameList', () => ({ default: () => null }));
vi.mock('@/lib/admin/match-context', () => ({ loadAdminMatchContext: mocks.loadAdminMatchContext }));
vi.mock('@/lib/audit/queries', () => ({
  listMatchAuditEvents: mocks.listMatchAuditEvents,
  getLatestMatchDispute: mocks.getLatestMatchDispute,
}));
vi.mock('@/lib/supabase/queries/match-proposals', () => ({ listMatchProposals: mocks.listMatchProposals }));
vi.mock('../AdminMatchActions', () => ({ default: () => null }));
vi.mock('../MatchContextHeader', () => ({ default: () => null }));
vi.mock('../MatchDisputePanel', () => ({ default: () => null }));
vi.mock('../MatchHistoryPanel', () => ({ default: () => null }));
vi.mock('../MatchReopenSection', () => ({ default: () => null }));
vi.mock('../MatchSchedulePanel', () => ({ default: () => null }));

import AdminMatchPage from '../page';
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.clear();
  mocks.getMatchById.mockResolvedValue(fullMatchRow({ id: MATCH_ID, tournament_id: TOURNAMENT_ID }));
  mocks.getLiveAccess.mockResolvedValue(null);
  mocks.isResourceAdminFor.mockResolvedValue(false);
  mocks.loadAdminMatchContext.mockResolvedValue(CONTEXT);
  mocks.listMatchAuditEvents.mockResolvedValue({ entries: [], total: 0, offset: 0, limit: MATCH_HISTORY_PAGE_SIZE });
  mocks.getLatestMatchDispute.mockResolvedValue(null);
  mocks.listMatchProposals.mockResolvedValue([]);
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

    const { texts } = await renderPage();

    expect(texts).toContain('Back to admin');
    expect(texts).toContain('Completed');
  });

  it('German with plc_locale=de: chrome and the status label from the enums namespace', async () => {
    mocks.cookies.set('plc_locale', { value: 'de' });
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));

    const { texts } = await renderPage();

    expect(texts).toContain('Zurück zum Adminbereich');
    expect(texts).toContain('Beendet');
    expect(texts).not.toContain('completed');
  });

  it('the access-denied notice follows the language cookie', async () => {
    mocks.cookies.set('plc_locale', { value: 'de' });
    const { texts } = walk(await MatchAccessDenied());
    expect(texts).toContain('Zugriff verweigert');
  });
});
