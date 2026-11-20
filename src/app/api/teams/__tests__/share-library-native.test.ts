import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The share and library writes for a native phase team: the phase services decide the move and answer the same codes
 * the legacy path answers for the same cause, and the legacy path keeps exactly today's code.
 */

const m = vi.hoisted(() => ({
  mode: vi.fn(),
  getTeamById: vi.fn(),
  getPhaseTeamById: vi.fn(),
  listLibraryPage: vi.fn(),
  requirePlayer: vi.fn(),
  share: vi.fn(), unshare: vi.fn(), publish: vi.fn(), unpublish: vi.fn(),
  setTeamShareToken: vi.fn(), disableTeamShareToken: vi.fn(),
  publishTeamToLibrary: vi.fn(), unpublishTeamFromLibrary: vi.fn(),
}));

vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: m.requirePlayer }));
vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: m.mode }));
vi.mock('@/lib/supabase/queries/phase-teams', () => ({
  getPhaseTeamById: m.getPhaseTeamById,
  getPhaseTeamVisibilityFacts: vi.fn(async () => new Map()),
}));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn(async () => null) }));
vi.mock('@/lib/team/phase-services', () => ({
  createPhaseTeamServices: () => ({
    share: m.share, unshare: m.unshare, publish: m.publish, unpublish: m.unpublish,
    edit: vi.fn(), delete: vi.fn(), create: vi.fn(), fork: vi.fn(), getById: vi.fn(),
    list: vi.fn(), getPlanned: vi.fn(), getForMatch: vi.fn(), getMatchPrep: vi.fn(), listLibrary: vi.fn(),
  }),
}));
vi.mock('@/lib/team/library-listing', () => ({ listLibraryPage: m.listLibraryPage }));
vi.mock('@/lib/supabase/queries/teams', () => ({
  getTeamById: m.getTeamById,
  setTeamShareToken: m.setTeamShareToken,
  disableTeamShareToken: m.disableTeamShareToken,
  publishTeamToLibrary: m.publishTeamToLibrary,
  unpublishTeamFromLibrary: m.unpublishTeamFromLibrary,
  listLibraryTeams: vi.fn(),
}));
vi.mock('@/lib/team/team-share-state', async (importOriginal) => importOriginal());

import { POST as createShare, DELETE as disableShare } from '@/app/api/teams/share/route';
import { GET as listLibrary, POST as publish, DELETE as unpublish } from '@/app/api/teams/library/route';

const teamId = 'ae000000-0000-4000-8000-000000000001';
const phaseId = 'ae000000-0000-4000-8000-000000000002';
const playerId = 'ae000000-0000-4000-8000-000000000003';

const phaseTeam = {
  id: teamId,
  player_id: playerId,
  phase_id: phaseId,
  season_id: null,
  name: 'League team',
  match_id: null,
  pokemon: [{ species: 'Pikachu' }],
  import_source: 'manual',
  locked: false,
  is_draft_team: false,
  draft_pool_id: null,
  library_published_at: null as string | null,
  library_title: null as string | null,
  library_description: null,
  library_tags: null,
  forked_from_team_id: null,
  forked_from_phase_team_id: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

const request = (body: Record<string, unknown>, origin = 'https://poke.example') =>
  ({ json: () => Promise.resolve(body), headers: new Headers({ origin }) }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  m.mode.mockResolvedValue('phase');
  m.requirePlayer.mockResolvedValue({ playerId, isAdmin: false });
  m.getPhaseTeamById.mockResolvedValue(phaseTeam);
  m.share.mockResolvedValue({ team_id: teamId, share_token: 'token-1', share_enabled_at: '2026-11-02T00:00:00Z' });
  m.publish.mockResolvedValue({ ...phaseTeam, library_published_at: '2026-11-02T00:00:00Z', library_title: 'Rain' });
});

describe('POST /api/teams/share on a native phase team', () => {
  it('enables the link through the phase service and answers the same body as the legacy path', async () => {
    const response = await createShare(request({ teamId }));
    expect(await response.json()).toEqual({
      success: true,
      shareToken: 'token-1',
      shareUrl: 'https://poke.example/teams/shared/token-1',
    });
    expect(m.share).toHaveBeenCalledExactlyOnceWith({ playerId, isAdmin: false }, teamId);
    expect(m.setTeamShareToken).not.toHaveBeenCalled();
    expect(m.getTeamById).not.toHaveBeenCalled();
  });

  it('refuses a missing site origin before enabling any link', async () => {
    const response = await createShare(request({ teamId }, ''));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: 'team_share_site_url_missing' });
    expect(m.share).not.toHaveBeenCalled();
  });

  it('keeps the legacy path for a standalone team', async () => {
    m.mode.mockResolvedValue('legacy');
    m.getTeamById.mockResolvedValue({ id: teamId, player_id: playerId, share_token: null });
    m.setTeamShareToken.mockResolvedValue({ team_id: teamId, share_token: 'token-2', share_enabled_at: 'now' });
    const response = await createShare(request({ teamId }));
    expect(await response.json()).toMatchObject({ shareToken: 'token-2' });
    expect(m.setTeamShareToken).toHaveBeenCalledExactlyOnceWith(teamId);
    expect(m.getPhaseTeamById).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/teams/share on a native phase team', () => {
  it('disables the link through the phase service', async () => {
    const response = await disableShare(request({ teamId }));
    expect(await response.json()).toEqual({ success: true });
    expect(m.unshare).toHaveBeenCalledExactlyOnceWith({ playerId, isAdmin: false }, teamId);
    expect(m.disableTeamShareToken).not.toHaveBeenCalled();
  });
});

describe('POST /api/teams/library on a native phase team', () => {
  it('publishes through the phase service and answers the public phase team without the share columns', async () => {
    const response = await publish(request({ teamId, title: 'Rain' }));
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.team).toMatchObject({ id: teamId, phase_id: phaseId, library_title: 'Rain' });
    expect(json.team).not.toHaveProperty('share_token');
    expect(m.publish).toHaveBeenCalledExactlyOnceWith({ playerId, isAdmin: false }, teamId, { title: 'Rain', description: undefined, tags: undefined });
    expect(m.publishTeamToLibrary).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/teams/library on a native phase team', () => {
  it('unpublishes through the phase service', async () => {
    const response = await unpublish(request({ teamId }));
    expect(await response.json()).toEqual({ success: true });
    expect(m.unpublish).toHaveBeenCalledExactlyOnceWith({ playerId, isAdmin: false }, teamId);
    expect(m.unpublishTeamFromLibrary).not.toHaveBeenCalled();
  });
});

describe('GET /api/teams/library', () => {
  it('lists through the merged listing', async () => {
    m.listLibraryPage.mockResolvedValue({ data: [], total: 0 });
    const response = await listLibrary(new NextRequest('http://localhost/api/teams/library?limit=5&offset=0'));
    expect(await response.json()).toEqual({ success: true, data: [], total: 0 });
    expect(m.listLibraryPage).toHaveBeenCalledExactlyOnceWith({ search: undefined, tags: undefined, limit: 5, offset: 0 });
  });
});
