/**
 * `/admin/matches/[id]` renders one match's admin notes and override
 * controls. `AdminGuard` admits an admin of ANY tournament or league, so the
 * page itself requires that the viewer administers THIS match: a site admin,
 * or a resource admin of the match's tournament or league, decided from the
 * live role read. The page runs as a plain async function (vitest 'node'
 * env) and its element tree is walked without rendering the children.
 */
import { isValidElement, type ReactNode } from 'react';
import Link from 'next/link';
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

    expect(texts).toContain('Back to matches');
    expect(texts).toContain('Completed');
  });

  it('German with plc_locale=de: chrome and the status label from the enums namespace', async () => {
    mocks.cookies.set('plc_locale', { value: 'de' });
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));

    const { texts } = await renderPage();

    expect(texts).toContain('Zurück zu den Spielen');
    expect(texts).toContain('Beendet');
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
