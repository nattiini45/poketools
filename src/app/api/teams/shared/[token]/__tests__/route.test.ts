import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Team } from '@/types/team';

// The limiter decision is mocked; the 429 body comes from the real `rateLimitedResponse`.
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkPublicRateLimit: vi.fn(async () => ({ allowed: true, remaining: 59, retryAfterSeconds: 0 })),
}));

vi.mock('@/lib/supabase/queries/teams', () => ({
  getTeamByShareToken: vi.fn(),
}));

import { GET } from '../route';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';
import { checkPublicRateLimit } from '@/lib/utils/rate-limit';
import { getTeamByShareToken } from '@/lib/supabase/queries/teams';

const TOKEN = '3f2b8c1e-9a4d-4e6f-8b2a-7c5d1e0f9a3b';

const pikachu = {
  name: '',
  species: 'Pikachu',
  gender: '',
  item: 'Light Ball',
  ability: 'Static',
  evs: { hp: 0, atk: 252, def: 0, spa: 4, spd: 0, spe: 252 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  nature: 'Jolly',
  level: 50,
  moves: ['Volt Tackle'],
};

function makeTeam(): Team {
  return {
    id: 'team-1',
    player_id: 'player-1',
    name: 'Owner-only name',
    tournament_id: null,
    season_id: 'season-1',
    match_id: null,
    pokemon: [pikachu],
    import_source: 'ps_text',
    locked: false,
    is_draft_team: false,
    draft_pool_id: null,
    library_published_at: null,
    library_title: 'Shared title',
    library_description: null,
    library_tags: null,
    forked_from_team_id: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
  };
}

describe('GET /api/teams/shared/[token]', () => {
  // Public: no auth required (the token is the authorization)
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Rate limit (per client IP) ────────────────────────────

  it('checks the per-IP public limiter on the request: 60 per minute', async () => {
    vi.mocked(getTeamByShareToken).mockResolvedValueOnce(makeTeam());
    const req = makeRequest();

    await GET(req, { params: makeParams({ token: TOKEN }) });

    expect(vi.mocked(checkPublicRateLimit)).toHaveBeenCalledWith('team-shared', req, { limit: 60, windowSeconds: 60 });
  });

  it('returns 429 with the retry delay and never queries when the limiter denies', async () => {
    vi.mocked(checkPublicRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 17 });

    const res = await GET(makeRequest(), { params: makeParams({ token: TOKEN }) });
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('17');
    expect(body.code).toBe('rate_limited');
    expect(getTeamByShareToken).not.toHaveBeenCalled();
  });

  it('limits malformed tokens too (the check runs before validation)', async () => {
    vi.mocked(checkPublicRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 5 });

    const res = await GET(makeRequest(), { params: makeParams({ token: 'not-a-uuid' }) });

    expect(res.status).toBe(429);
  });

  // ── Validation and lookup ─────────────────────────────────

  it('returns 400 for a token that is not a UUID, without querying', async () => {
    const res = await GET(makeRequest(), { params: makeParams({ token: 'not-a-uuid' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('team_share_token_invalid');
    expect(getTeamByShareToken).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown or disabled token', async () => {
    vi.mocked(getTeamByShareToken).mockResolvedValueOnce(null);

    const res = await GET(makeRequest(), { params: makeParams({ token: TOKEN }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe('team_shared_not_found');
    expect(getTeamByShareToken).toHaveBeenCalledWith(TOKEN);
  });

  it('returns 200 with only the SharedTeamView allowlist for an enabled token', async () => {
    vi.mocked(getTeamByShareToken).mockResolvedValueOnce(makeTeam());

    const res = await GET(makeRequest(), { params: makeParams({ token: TOKEN }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Object.keys(body.team).sort()).toEqual(
      ['created_at', 'id', 'library_description', 'library_title', 'pokemon', 'tournament_id'],
    );
    expect(body.team.pokemon).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('share_token');
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(body.team.player_id).toBeUndefined();
  });

  it('returns a safe 500 when the lookup throws', async () => {
    vi.mocked(getTeamByShareToken).mockRejectedValueOnce(new Error('db exploded: secret detail'));

    const res = await GET(makeRequest(), { params: makeParams({ token: TOKEN }) });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret detail');
  });
});
