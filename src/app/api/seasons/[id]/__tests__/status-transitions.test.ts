/**
 * The status moves of a league through PATCH /api/seasons/[id] (seasonMachine, src/lib/season/season-state.ts). The admin
 * control (LeagueStatusControl) and the admin agent's propose_league_status offer every status from every status, so every
 * admin move stays legal; what the machine adds is the compare-and-set on the status read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  requireResourceAdmin: vi.fn(),
  AuthError: class AuthError extends Error {},
}));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonWithDetails: vi.fn(),
  updateSeason: vi.fn(),
  getSeasonById: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/league-trash', () => ({
  moveLeagueToTrash: vi.fn(),
  getLeagueTrashBySeason: vi.fn(),
  markLeagueTrashRebuildDone: vi.fn(),
  markLeagueRestoreRebuildDone: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ archiveTournamentsBySeason: vi.fn() }));
vi.mock('@/lib/supabase/queries/season-start', () => ({ getSeasonPhaseStartSignals: vi.fn() }));
vi.mock('@/lib/reconcile/entity-delete-rebuild', () => ({
  rebuildAfterSeasonDelete: vi.fn(),
  rebuildAfterSeasonRestore: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/season-formats', () => ({
  getSeasonFormatSummary: vi.fn(),
  getSeasonStartSignals: vi.fn(),
}));
vi.mock('@/lib/ruleset-studio/pin-change', () => ({ assertRulesetChangeAllowed: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn(), diffField: vi.fn() }));
vi.mock('@/lib/rating/test-league-rebuild', () => ({ rebuildRatingsAfterTestFlagChange: vi.fn() }));

import { PATCH } from '@/app/api/seasons/[id]/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getSeasonById, updateSeason } from '@/lib/supabase/queries/seasons';
import type { SeasonStatus } from '@/types/season';

const ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const season = (status: SeasonStatus) => ({
  id: ID,
  name: 'Season One',
  description: '',
  format_type: 'singles',
  status,
  archived: false,
  is_test_season: false,
  start_date: null,
  end_date: null,
  ruleset_id: null,
  route_theme: null,
  language: 'de',
});

const patch = (body: unknown) =>
  PATCH({ json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest, { params: Promise.resolve({ id: ID }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'p-1', name: 'Admin', isAdmin: true } as never);
  vi.mocked(updateSeason).mockImplementation(async (_id, input) => ({ ...season('upcoming'), ...input }) as never);
});

const STATUSES: SeasonStatus[] = ['upcoming', 'active', 'completed'];
const MOVES = STATUSES.flatMap((from) => STATUSES.filter((to) => to !== from).map((to) => [from, to] as const));

describe('PATCH /api/seasons/[id]: every admin status move is written', () => {
  it.each(MOVES)('%s -> %s', async (from, to) => {
    vi.mocked(getSeasonById).mockResolvedValue(season(from) as never);
    const res = await patch({ status: to });
    expect(res.status).toBe(200);
    expect(updateSeason).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateSeason).mock.calls[0][1]).toEqual({ status: to });
  });

  it.each(STATUSES)('resending %s is written as before', async (status) => {
    vi.mocked(getSeasonById).mockResolvedValue(season(status) as never);
    const res = await patch({ status });
    expect(res.status).toBe(200);
    expect(vi.mocked(updateSeason).mock.calls[0][1]).toEqual({ status });
  });
});
