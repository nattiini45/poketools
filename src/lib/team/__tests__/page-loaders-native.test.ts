import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The page loaders in phase mode: a shared link and a library entry resolve whichever store holds the id, so a link
 * minted before cutover keeps working after it. The legacy paths keep their single read.
 */

const m = vi.hoisted(() => ({
  resolveSharedTeam: vi.fn(),
  mode: vi.fn(),
  getTeamById: vi.fn(),
  getPhaseTeamById: vi.fn(),
  headers: vi.fn(),
  checkPublicRateLimit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: m.headers }));
vi.mock('@/lib/team/shared-team', () => ({ resolveSharedTeam: m.resolveSharedTeam }));
vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: m.mode }));
vi.mock('@/lib/supabase/queries/phase-teams', () => ({ getPhaseTeamById: m.getPhaseTeamById }));
vi.mock('@/lib/supabase/queries/teams', () => ({ getTeamById: m.getTeamById }));
vi.mock('@/lib/utils/rate-limit', () => ({ checkPublicRateLimit: m.checkPublicRateLimit }));

import { loadLibraryEntry, loadSharedTeam } from '../page-loaders';

const TOKEN = '00000000-0000-4000-8000-000000000065';
const TEAM_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const PLAYER_ID = '0b1c2d3e-4f5a-4b6c-9d7e-1f2a3b4c5d6e';

const phaseTeam = {
  id: TEAM_ID,
  player_id: PLAYER_ID,
  phase_id: 'phase-1',
  season_id: null,
  name: 'Native',
  match_id: null,
  pokemon: [{ species: 'Garchomp', moves: [] }, { species: '' }],
  import_source: 'manual' as const,
  locked: false,
  is_draft_team: false,
  draft_pool_id: null,
  library_published_at: '2026-10-01T10:00:00Z' as string | null,
  library_title: 'Rain Offense',
  library_description: 'Fast and mean',
  library_tags: ['rain'],
  forked_from_team_id: null,
  forked_from_phase_team_id: null,
  created_at: '2026-09-30T10:00:00Z',
  updated_at: '2026-10-03T10:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  m.headers.mockResolvedValue(new Headers());
  m.checkPublicRateLimit.mockResolvedValue({ allowed: true, remaining: 59, retryAfterSeconds: 0 });
  m.mode.mockResolvedValue('phase');
  m.getPhaseTeamById.mockResolvedValue(phaseTeam);
});

describe('loadSharedTeam', () => {
  it('answers a native token through the shared allowlist the legacy link uses', async () => {
    m.resolveSharedTeam.mockResolvedValue({ kind: 'phase', team: phaseTeam });
    expect(await loadSharedTeam(TOKEN)).toEqual({
      status: 'ok',
      team: {
        id: TEAM_ID,
        pokemon: [{ species: 'Garchomp', moves: [] }],
        library_title: 'Rain Offense',
        library_description: 'Fast and mean',
        tournament_id: null,
        created_at: '2026-09-30T10:00:00Z',
      },
    });
  });
});

describe('loadLibraryEntry', () => {
  it('renders a published native entry without its owner', async () => {
    const result = await loadLibraryEntry(TEAM_ID);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.entry).toMatchObject({ id: TEAM_ID, library_title: 'Rain Offense', library_tags: ['rain'] });
    expect(result.entry).not.toHaveProperty('player_id');
    expect(m.getTeamById).not.toHaveBeenCalled();
  });

  it('answers not_found for an unpublished native row', async () => {
    m.getPhaseTeamById.mockResolvedValue({ ...phaseTeam, library_published_at: null });
    expect(await loadLibraryEntry(TEAM_ID)).toEqual({ status: 'not_found' });
  });

  it('keeps the legacy read for a standalone row, without touching the phase store', async () => {
    m.mode.mockResolvedValue('legacy');
    m.getTeamById.mockResolvedValue({
      id: TEAM_ID, player_id: PLAYER_ID, pokemon: [{ species: 'Pikachu', moves: [] }], library_title: 'Rain',
      library_description: null, library_tags: null, library_published_at: '2026-10-01T10:00:00Z',
      forked_from_team_id: null, created_at: '2026-09-30T10:00:00Z', updated_at: '2026-10-03T10:00:00Z',
    });
    const result = await loadLibraryEntry(TEAM_ID);
    expect(result.status).toBe('ok');
    expect(m.getPhaseTeamById).not.toHaveBeenCalled();
  });
});
