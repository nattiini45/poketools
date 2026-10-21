import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * A league with groups owns its phases' groups: the phase editor's regenerate, delete and member move are
 * refused (409 PHASE_GROUPS_LEAGUE_MANAGED) before anything is written. A league without groups keeps them.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({ requireResourceAdmin: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getParticipants: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({
  getGroupsByTournament: vi.fn(),
  createGroupBatch: vi.fn(),
  deleteGroupsByTournament: vi.fn(),
  addGroupMembersBatch: vi.fn(),
  moveGroupMember: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/season-groups', () => ({
  getSeasonGroups: vi.fn(),
  seasonHasGroups: vi.fn(),
}));

import { DELETE, POST } from '../route';
import { PATCH } from '../members/route';
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import {
  createGroupBatch,
  deleteGroupsByTournament,
  getGroupsByTournament,
  moveGroupMember,
} from '@/lib/supabase/queries/tournament-groups';
import { seasonHasGroups } from '@/lib/supabase/queries/season-groups';

const SEASON_ID = '5d1b0c62-1e0b-4b8e-9b5e-0c3f1d2a7b10';
const PHASE_ID = '5d1b0c62-1e0b-4b8e-9b5e-0c3f1d2a7b11';
const G1 = '5d1b0c62-1e0b-4b8e-9b5e-0c3f1d2a7b21';
const G2 = '5d1b0c62-1e0b-4b8e-9b5e-0c3f1d2a7b22';
const P1 = '5d1b0c62-1e0b-4b8e-9b5e-0c3f1d2a7b31';
const params = { params: Promise.resolve({ id: SEASON_ID, phaseId: PHASE_ID }) };

function jsonRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTournamentById).mockResolvedValue({ id: PHASE_ID, season_id: SEASON_ID } as never);
  vi.mocked(getParticipants).mockResolvedValue([
    { id: 'p1', seed: 1 },
    { id: 'p2', seed: 2 },
  ] as never);
  vi.mocked(getGroupsByTournament).mockResolvedValue([
    { id: G1, members: [{ player_id: P1, seed: 1 }] },
    { id: G2, members: [] },
  ] as never);
  vi.mocked(createGroupBatch).mockResolvedValue([{ id: 'g' }] as never);
});

describe('phase groups of a league with groups', () => {
  beforeEach(() => {
    vi.mocked(seasonHasGroups).mockResolvedValue(true);
  });

  it('POST (regenerate) is refused, pointing at the league groups editor', async () => {
    const res = await POST(jsonRequest({ group_count: 2, serpentine: true }), params);
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.code).toBe('PHASE_GROUPS_LEAGUE_MANAGED');
    expect(deleteGroupsByTournament).not.toHaveBeenCalled();
    expect(createGroupBatch).not.toHaveBeenCalled();
  });

  it('DELETE is refused', async () => {
    const res = await DELETE({} as NextRequest, params);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('PHASE_GROUPS_LEAGUE_MANAGED');
    expect(deleteGroupsByTournament).not.toHaveBeenCalled();
  });

  it('a member move is refused', async () => {
    const res = await PATCH(jsonRequest({ player_id: P1, from_group_id: G1, to_group_id: G2 }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('PHASE_GROUPS_LEAGUE_MANAGED');
    expect(moveGroupMember).not.toHaveBeenCalled();
  });
});

describe('phase groups of a league without groups (unchanged)', () => {
  beforeEach(() => {
    vi.mocked(seasonHasGroups).mockResolvedValue(false);
  });

  it('POST regenerates the phase groups as before', async () => {
    const res = await POST(jsonRequest({ group_count: 2, serpentine: false }), params);
    expect(res.status).toBe(201);
    expect(deleteGroupsByTournament).toHaveBeenCalledWith(PHASE_ID);
    expect(createGroupBatch).toHaveBeenCalledWith([
      { tournament_id: PHASE_ID, name: 'Group A', group_number: 1 },
      { tournament_id: PHASE_ID, name: 'Group B', group_number: 2 },
    ]);
  });

  it('a malformed path id is a 404 before any read', async () => {
    const res = await DELETE({} as NextRequest, { params: Promise.resolve({ id: 'nope', phaseId: PHASE_ID }) });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('INVALID_SEASON_ID');
    expect(getTournamentById).not.toHaveBeenCalled();
  });
});
