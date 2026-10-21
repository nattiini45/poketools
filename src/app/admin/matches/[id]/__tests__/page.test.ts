/**
 * `/admin/matches/[id]` renders one match's admin notes and override
 * controls. `AdminGuard` admits an admin of ANY tournament or league, so the
 * page itself requires that the viewer administers THIS match: a site admin,
 * or a resource admin of the match's tournament or league, decided from the
 * live role read. The page runs as a plain async function (vitest 'node'
 * env) and its element tree is walked without rendering the children.
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
vi.mock('../AdminMatchActions', () => ({ default: () => null }));

import AdminMatchPage from '../page';
import AdminMatchActions from '../AdminMatchActions';
import { MatchAccessDenied } from '../match-access';

const TOURNAMENT_ID = '11111111-1111-4111-8111-111111111111';
const MATCH_ID = '33333333-3333-4333-8333-333333333333';
const NOTES = PRIVATE_MATCH_SENTINELS.notes;

function access(flags: Partial<Omit<LiveAccess, 'player'>>, playerId: string | null = 'viewer-1'): LiveAccess {
  return {
    player: playerId ? ({ playerId } as LiveAccess['player']) : null,
    isSiteAdmin: false,
    isAnyAdmin: false,
    isCreator: false,
    ...flags,
  };
}

/** Every string and element type anywhere in an element tree (props.children / props.action). */
function walk(node: ReactNode, out: { texts: string[]; types: unknown[] } = { texts: [], types: [] }) {
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, out));
  } else if (typeof node === 'string' || typeof node === 'number') {
    out.texts.push(String(node));
  } else if (isValidElement<{ children?: ReactNode; action?: ReactNode }>(node)) {
    out.types.push(node.type);
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
});

describe('AdminMatchPage: per-match access', () => {
  it('signed out: neither notes nor controls (AdminGuard sends to sign-in)', async () => {
    const { texts, types } = await renderPage();

    expect(texts).not.toContain(NOTES);
    expect(types).toContain(MatchAccessDenied);
    expect(types).not.toContain(AdminMatchActions);
  });

  it('a player who is no admin: neither notes nor controls', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({}));

    const { texts, types } = await renderPage();

    expect(texts).not.toContain(NOTES);
    expect(types).not.toContain(AdminMatchActions);
    expect(mocks.isResourceAdminFor).not.toHaveBeenCalled();
  });

  it('a resource admin of ANOTHER tournament or league: access denied, no notes', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.isResourceAdminFor.mockResolvedValue(false);

    const { texts, types } = await renderPage();

    expect(mocks.isResourceAdminFor).toHaveBeenCalledWith('viewer-1', 'tournament', TOURNAMENT_ID);
    expect(texts).not.toContain(NOTES);
    expect(types).toContain(MatchAccessDenied);
    expect(types).not.toContain(AdminMatchActions);
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

  it('a failed live read fails closed (rethrows)', async () => {
    mocks.getLiveAccess.mockRejectedValue(new Error('db down'));
    await expect(renderPage()).rejects.toThrow('db down');
  });

  it('404s a malformed match id without querying', async () => {
    await expect(renderPage('abc')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getMatchById).not.toHaveBeenCalled();
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
