import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  getLiveAccess: vi.fn(),
  listArchivedSeasons: vi.fn(),
  listSeasonsByIds: vi.fn(),
  listArchivedTournaments: vi.fn(),
  listTournamentsByIds: vi.fn(),
  getAdminSeasonIds: vi.fn(),
  getAdminTournamentIds: vi.fn(),
}));

function stub(name: string) {
  const C = function Stub({ children }: { children?: ReactNode }) {
    return children ?? null;
  };
  Object.defineProperty(C, 'name', { value: name });
  return { default: C };
}

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => stub('Link'));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return { getLocale: async () => 'en', getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en') };
});
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ listArchivedSeasons: mocks.listArchivedSeasons, listSeasonsByIds: mocks.listSeasonsByIds }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  listArchivedTournaments: mocks.listArchivedTournaments,
  listTournamentsByIds: mocks.listTournamentsByIds,
}));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  getAdminSeasonIds: mocks.getAdminSeasonIds,
  getAdminTournamentIds: mocks.getAdminTournamentIds,
}));
vi.mock('@/lib/admin/competition-list', () => ({
  toLeagueRow: (league: { id: string }) => ({ id: league.id }),
  toTournamentRow: (tournament: { id: string }) => ({ id: tournament.id }),
}));
vi.mock('@/components/shared/AdminGuard', () => stub('AdminGuard'));
vi.mock('@/components/admin/competitions/CompetitionList', () => stub('CompetitionList'));
vi.mock('@/components/ui/PageContainer', () => stub('PageContainer'));
vi.mock('@/components/ui/Button', () => stub('Button'));

import ArchivedLeaguesPage from '../leagues/archived/page';
import ArchivedTournamentsPage from '../tournaments/archived/page';

const player = { playerId: 'p1' };
const access = (patch: Record<string, unknown>) => ({ player, isSiteAdmin: false, isAnyAdmin: false, isSuperadmin: false, ...patch });

/** The CompetitionList element's rows, found in the rendered tree. */
function rowsOf(node: unknown): { id: string }[] | null {
  if (!node || typeof node !== 'object') return null;
  const el = node as ReactElement<{ rows?: { id: string }[]; children?: unknown }>;
  if (el.props?.rows) return el.props.rows;
  const children = el.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = rowsOf(child);
    if (found) return found;
  }
  return null;
}

const item = (id: string) => ({ id, tournament_count: 1, best_of_default: 3, is_doubles: false });

const pages = [
  {
    name: 'leagues',
    Page: ArchivedLeaguesPage,
    all: mocks.listArchivedSeasons,
    byIds: mocks.listSeasonsByIds,
    ids: mocks.getAdminSeasonIds,
    options: { archived: true },
  },
  {
    name: 'tournaments',
    Page: ArchivedTournamentsPage,
    all: mocks.listArchivedTournaments,
    byIds: mocks.listTournamentsByIds,
    ids: mocks.getAdminTournamentIds,
    options: { archived: true, standaloneOnly: true },
  },
];

describe.each(pages)('archived $name page', ({ Page, all, byIds, ids, options }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    all.mockResolvedValue([item('a'), item('b')]);
    byIds.mockResolvedValue([item('b')]);
    ids.mockResolvedValue(['b']);
  });

  it.each([
    ['an anonymous visitor', null],
    ['a player', access({})],
  ])('reads nothing for %s', async (_who, live) => {
    mocks.getLiveAccess.mockResolvedValue(live);
    await Page();
    expect(all).not.toHaveBeenCalled();
    expect(byIds).not.toHaveBeenCalled();
    expect(ids).not.toHaveBeenCalled();
  });

  it("lists only the caller's own archived items for a resource admin", async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    const rows = rowsOf(await Page());
    expect(all).not.toHaveBeenCalled();
    expect(ids).toHaveBeenCalledWith('p1');
    expect(byIds).toHaveBeenCalledWith(['b'], options);
    expect(rows).toEqual([{ id: 'b' }]);
  });

  it('lists nothing for a resource admin of another competition', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    ids.mockResolvedValue([]);
    byIds.mockResolvedValue([]);
    expect(rowsOf(await Page())).toEqual([]);
    expect(all).not.toHaveBeenCalled();
  });

  it('lists every archived item for a site admin', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true, isSiteAdmin: true }));
    const rows = rowsOf(await Page());
    expect(all).toHaveBeenCalledTimes(1);
    expect(byIds).not.toHaveBeenCalled();
    expect(rows).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
});
