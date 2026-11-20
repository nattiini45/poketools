import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A published native team forks into the caller's collection as a personal legacy team, like a legacy source does. */

const m = vi.hoisted(() => ({
  mode: vi.fn(),
  requirePlayer: vi.fn(),
  getTeamById: vi.fn(),
  getPhaseTeamById: vi.fn(),
  forkTeam: vi.fn(),
  checkTeamForkAccess: vi.fn(),
  fork: vi.fn(),
}));

vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: m.requirePlayer }));
vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: m.mode }));
vi.mock('@/lib/supabase/queries/phase-teams', () => ({ getPhaseTeamById: m.getPhaseTeamById }));
vi.mock('@/lib/supabase/queries/teams', () => ({ getTeamById: m.getTeamById, forkTeam: m.forkTeam }));
vi.mock('@/lib/team/visibility', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/team/visibility')>()),
  checkTeamForkAccess: m.checkTeamForkAccess,
}));
vi.mock('@/lib/team/phase-services', () => ({
  createPhaseTeamServices: () => ({ fork: m.fork, share: vi.fn(), unshare: vi.fn(), publish: vi.fn(), unpublish: vi.fn(),
    edit: vi.fn(), delete: vi.fn(), create: vi.fn(), getById: vi.fn(), list: vi.fn(), getPlanned: vi.fn(),
    getForMatch: vi.fn(), getMatchPrep: vi.fn(), listLibrary: vi.fn() }),
}));

import { POST } from '../route';

const sourceId = 'b0000000-0000-4000-8000-000000000001';
const playerId = 'b0000000-0000-4000-8000-000000000002';

const post = (body: Record<string, unknown>) =>
  POST(new NextRequest('http://localhost/api/teams/library/fork', { method: 'POST', body: JSON.stringify(body) }));

const forkedTeam = {
  id: 'b0000000-0000-4000-8000-000000000003', player_id: playerId, tournament_id: null, season_id: null, match_id: null,
  pokemon: [{ species: 'Pikachu' }], import_source: 'manual', locked: false, is_draft_team: false, draft_pool_id: null,
  library_published_at: null, library_title: null, library_description: null, library_tags: null,
  forked_from_team_id: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  m.mode.mockResolvedValue('phase');
  m.requirePlayer.mockResolvedValue({ playerId, isAdmin: false });
  m.getPhaseTeamById.mockResolvedValue({ id: sourceId, phase_id: 'phase-1', library_published_at: '2026-11-01T00:00:00Z' });
  m.fork.mockResolvedValue(forkedTeam);
});

describe('POST /api/teams/library/fork', () => {
  it('forks a native source through the phase service', async () => {
    const response = await post({ sourceTeamId: sourceId });
    expect(response.status).toBe(200);
    expect((await response.json()).team).toMatchObject({ id: forkedTeam.id, player_id: playerId });
    expect(m.fork).toHaveBeenCalledExactlyOnceWith({ playerId, isAdmin: false }, sourceId, undefined);
    expect(m.getTeamById).not.toHaveBeenCalled();
    expect(m.forkTeam).not.toHaveBeenCalled();
  });

  it('keeps the legacy fork for a standalone source', async () => {
    m.mode.mockResolvedValue('legacy');
    m.getTeamById.mockResolvedValue({ id: sourceId, player_id: 'someone' });
    m.checkTeamForkAccess.mockResolvedValue('allowed');
    m.forkTeam.mockResolvedValue(forkedTeam);
    expect((await post({ sourceTeamId: sourceId })).status).toBe(200);
    expect(m.forkTeam).toHaveBeenCalled();
    expect(m.fork).not.toHaveBeenCalled();
    expect(m.getPhaseTeamById).not.toHaveBeenCalled();
  });
});
