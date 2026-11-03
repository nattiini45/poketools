import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Team } from '@/types/team';

const mocks = vi.hoisted(() => ({
  getTeamByShareToken: vi.fn(),
  getTeamById: vi.fn(),
  checkPublicRateLimit: vi.fn(),
  headers: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('@/lib/supabase/queries/teams', () => ({
  getTeamByShareToken: mocks.getTeamByShareToken,
  getTeamById: mocks.getTeamById,
}));
vi.mock('@/lib/utils/rate-limit', () => ({ checkPublicRateLimit: mocks.checkPublicRateLimit }));

import { loadLibraryEntry, loadSharedTeam } from '../page-loaders';

const SHARE_LINK_ID = '00000000-0000-4000-8000-000000000065';
const TEAM_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const PLAYER_ID = '0b1c2d3e-4f5a-4b6c-9d7e-1f2a3b4c5d6e';
const REQUEST_HEADERS = new Headers({ 'x-forwarded-for': '203.0.113.7' });

function team(over: Partial<Team> = {}): Team {
  return {
    id: TEAM_ID,
    player_id: PLAYER_ID,
    pokemon: [{ species: 'Garchomp', moves: [] }, { species: '' }],
    library_title: 'Rain Offense',
    library_description: 'Fast and mean',
    library_tags: ['rain'],
    library_published_at: '2026-10-01T10:00:00Z',
    share_token: SHARE_LINK_ID,
    share_enabled_at: '2026-10-02T10:00:00Z',
    tournament_id: null,
    forked_from_team_id: null,
    created_at: '2026-09-30T10:00:00Z',
    updated_at: '2026-10-03T10:00:00Z',
    ...over,
  } as unknown as Team;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.headers.mockResolvedValue(REQUEST_HEADERS);
  mocks.checkPublicRateLimit.mockResolvedValue({ allowed: true, remaining: 59, retryAfterSeconds: 0 });
});

describe('loadSharedTeam', () => {
  it('returns the share allowlist only, never the owner or the token', async () => {
    mocks.getTeamByShareToken.mockResolvedValue(team());
    const result = await loadSharedTeam(SHARE_LINK_ID);
    expect(result.status).toBe('ok');
    const json = JSON.stringify(result);
    expect(json).not.toContain(PLAYER_ID);
    expect(json).not.toContain('share_token');
    expect(json).not.toContain('share_enabled_at');
    expect(result).toMatchObject({ team: { id: TEAM_ID, library_title: 'Rain Offense' } });
  });

  it('checks the per-IP limit of the API route before it looks at the token', async () => {
    mocks.getTeamByShareToken.mockResolvedValue(team());
    await loadSharedTeam(SHARE_LINK_ID);
    expect(mocks.checkPublicRateLimit).toHaveBeenCalledWith('team-shared', { headers: REQUEST_HEADERS }, { limit: 60, windowSeconds: 60 });
  });

  it('does not charge a request the proxy already charged', async () => {
    mocks.headers.mockResolvedValue(new Headers({ 'x-forwarded-for': '203.0.113.7', 'x-poketools-share-limit': 'allowed' }));
    mocks.getTeamByShareToken.mockResolvedValue(team());
    expect((await loadSharedTeam(SHARE_LINK_ID)).status).toBe('ok');
    expect(mocks.checkPublicRateLimit).not.toHaveBeenCalled();
  });

  it('shows the proxy verdict when the proxy spent the allowance', async () => {
    mocks.headers.mockResolvedValue(new Headers({ 'x-poketools-share-limit': 'denied:33' }));
    expect(await loadSharedTeam(SHARE_LINK_ID)).toEqual({ status: 'rate_limited', retryAfterSeconds: 33 });
    expect(mocks.checkPublicRateLimit).not.toHaveBeenCalled();
    expect(mocks.getTeamByShareToken).not.toHaveBeenCalled();
  });

  it('charges itself when the header is not a verdict it can read', async () => {
    mocks.getTeamByShareToken.mockResolvedValue(team());
    for (const value of ['', 'true', 'denied:0', 'denied:abc', 'allowed:1', 'ALLOWED']) {
      mocks.checkPublicRateLimit.mockClear();
      mocks.headers.mockResolvedValue(new Headers({ 'x-poketools-share-limit': value }));
      await loadSharedTeam(SHARE_LINK_ID);
      expect(mocks.checkPublicRateLimit, value).toHaveBeenCalledTimes(1);
    }
  });

  it('serves no team data past the limit', async () => {
    mocks.checkPublicRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 41 });
    expect(await loadSharedTeam(SHARE_LINK_ID)).toEqual({ status: 'rate_limited', retryAfterSeconds: 41 });
    expect(mocks.getTeamByShareToken).not.toHaveBeenCalled();
  });

  it('counts a malformed token against the limit and never queries it', async () => {
    expect(await loadSharedTeam('nope')).toEqual({ status: 'invalid' });
    expect(mocks.checkPublicRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.getTeamByShareToken).not.toHaveBeenCalled();
  });

  it('reports a disabled or unknown link as not found', async () => {
    mocks.getTeamByShareToken.mockResolvedValue(null);
    expect(await loadSharedTeam(SHARE_LINK_ID)).toEqual({ status: 'not_found' });
  });

  it('lets a failed read propagate instead of calling the link dead', async () => {
    mocks.getTeamByShareToken.mockRejectedValue(new Error('db down'));
    await expect(loadSharedTeam(SHARE_LINK_ID)).rejects.toThrow('db down');
  });
});

describe('loadLibraryEntry', () => {
  it('returns a published entry without its owner', async () => {
    mocks.getTeamById.mockResolvedValue(team());
    const result = await loadLibraryEntry(TEAM_ID);
    expect(result.status).toBe('ok');
    const json = JSON.stringify(result);
    expect(json).not.toContain(PLAYER_ID);
    expect(json).not.toContain(SHARE_LINK_ID);
    expect(result).toMatchObject({
      entry: { id: TEAM_ID, library_title: 'Rain Offense', library_tags: ['rain'], library_published_at: '2026-10-01T10:00:00Z' },
    });
  });

  it('treats an unpublished or missing team as not found', async () => {
    mocks.getTeamById.mockResolvedValue(team({ library_published_at: null }));
    expect(await loadLibraryEntry(TEAM_ID)).toEqual({ status: 'not_found' });
    mocks.getTeamById.mockResolvedValue(null);
    expect(await loadLibraryEntry(TEAM_ID)).toEqual({ status: 'not_found' });
  });

  it('treats a malformed id as not found without a query', async () => {
    expect(await loadLibraryEntry('nope')).toEqual({ status: 'invalid' });
    expect(mocks.getTeamById).not.toHaveBeenCalled();
  });
});