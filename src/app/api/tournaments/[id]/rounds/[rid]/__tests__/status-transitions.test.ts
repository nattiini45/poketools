/**
 * The status moves of a round through PATCH /api/tournaments/[id]/rounds/[rid] other than completion (roundMachine,
 * src/lib/tournament/round-state.ts): Start (pending -> active, RoundManager) and the admin's move back to pending.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Round, RoundStatus } from '@/types/round';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({ requireResourceAdmin: vi.fn(), AuthError: class AuthError extends Error {} }));
vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
  getRoundsByTournament: vi.fn(),
  updateRoundStatus: vi.fn(),
  completeRound: vi.fn(),
  updateRoundBestOf: vi.fn(),
  updateRoundDeadline: vi.fn(),
}));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchesByRound: vi.fn(), getCompletedMatchRecords: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn(), getParticipants: vi.fn() }));
vi.mock('@/lib/tournament/season-standings', () => ({ computeStandingsForSeason: vi.fn() }));
vi.mock('@/lib/discord/notify', () => ({ emitDiscordEvent: vi.fn() }));
vi.mock('@/lib/social/notify', () => ({ emitSocialEvent: vi.fn() }));
vi.mock('@/lib/ai/trigger', () => ({ triggerTournamentReport: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/hooks', () => ({ onRoundCompleted: vi.fn() }));

import { PATCH } from '@/app/api/tournaments/[id]/rounds/[rid]/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getRoundById, updateRoundStatus } from '@/lib/supabase/queries/rounds';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';

const T_ID = '11111111-1111-4111-8111-111111111111';
const R_ID = '22222222-2222-4222-8222-222222222222';

const round = (status: RoundStatus): Round => ({
  id: R_ID,
  tournament_id: T_ID,
  name: 'Round 1',
  round_number: 1,
  best_of: 3,
  status,
  pairings_generated: true,
  deadline: null,
  bracket_side: null,
  bye_player_ids: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const patch = (body: unknown) =>
  PATCH({ json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest, { params: Promise.resolve({ id: T_ID, rid: R_ID }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'p-1', name: 'Admin' } as never);
  vi.mocked(getTournamentById).mockResolvedValue({ id: T_ID, season_id: null, status: 'active' } as never);
  vi.mocked(updateRoundStatus).mockImplementation(async (_id, status) => round(status));
});

describe('PATCH rounds/[rid]: legal non-completing status moves', () => {
  it.each<[RoundStatus, RoundStatus]>([
    ['pending', 'active'],
    ['active', 'pending'],
    ['completed', 'pending'],
  ])('%s -> %s is written', async (from, to) => {
    vi.mocked(getRoundById).mockResolvedValue(round(from));
    const res = await patch({ status: to });
    expect(res.status).toBe(200);
    expect(updateRoundStatus).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateRoundStatus).mock.calls[0].slice(0, 2)).toEqual([R_ID, to]);
  });
});
