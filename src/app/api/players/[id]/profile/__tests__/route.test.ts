import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return { requireAuth: vi.fn(), AuthError };
});

vi.mock('@/lib/profile/compose', () => ({
  composePlayerProfile: vi.fn(),
}));

import { GET } from '../route';
import { requireAuth, AuthError } from '@/lib/auth/helpers';
import { composePlayerProfile } from '@/lib/profile/compose';
import { expectNoPrivatePlayerData, fullPlayerRow } from '@/lib/players/__tests__/private-player-fields';
import type { PlayerProfile } from '@/types/profile';

const mockRequireAuth = requireAuth as ReturnType<typeof vi.fn>;
const mockCompose = composePlayerProfile as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────

function makeArgs(id: string): [NextRequest, { params: Promise<{ id: string }> }] {
  const url = new URL(`http://localhost:3000/api/players/${id}/profile`);
  const req = { url: url.toString(), nextUrl: url } as unknown as NextRequest;
  return [req, { params: Promise.resolve({ id }) }];
}

/** A composed profile of player p-1 whose player row carries every private column. */
function makeProfile(): PlayerProfile {
  return {
    player: fullPlayerRow({ id: 'p-1', name: 'Alice' }),
    headline: { total_wins: 10, total_losses: 4 } as PlayerProfile['headline'],
    current_participations: [],
    past_participations: [],
    upcoming_matches: [],
    recent_matches: [],
    most_used_pokemon: [],
    best_kill_pokemon: [],
    recent_form: ['W', 'L'],
    trophies: [],
    rating: null,
    streaks: null,
    signatures: [],
    achievements: [],
  };
}

/** A requireAuth session whose LIVE player is `playerId`. */
function sessionFor(playerId: string, isAdmin = false) {
  return { user: { id: `discord-${playerId}` }, player: { playerId, name: playerId, isAdmin } };
}

describe('GET /api/players/[id]/profile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('another signed-in player gets the profile with the PublicPlayer card only', async () => {
    const profile = makeProfile();
    mockRequireAuth.mockResolvedValue(sessionFor('p-2'));
    mockCompose.mockResolvedValue(profile);

    const [req, ctx] = makeArgs('p-1');
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.player).toEqual({
      id: 'p-1',
      name: 'Alice',
      avatar_url: profile.player.avatar_url,
      ps_username: 'mara_ps',
      champions_username: 'mara_champs',
      joined_date: '2026-01-01',
      is_creator: true,
      is_guest: false,
    });
    // The other sections are unchanged.
    expect(json.data.headline).toEqual(profile.headline);
    expect(json.data.recent_form).toEqual(['W', 'L']);
    expect(mockCompose).toHaveBeenCalledWith('p-1');
  });

  it('the non-self response carries no private player column (JSON.stringify check)', async () => {
    mockRequireAuth.mockResolvedValue(sessionFor('p-2'));
    mockCompose.mockResolvedValue(makeProfile());

    const [req, ctx] = makeArgs('p-1');
    const res = await GET(req, ctx);

    expectNoPrivatePlayerData(await res.json());
  });

  it('a signed-in identity with no player row gets the public card too', async () => {
    mockRequireAuth.mockResolvedValue({ user: { id: 'discord-new' }, player: null });
    mockCompose.mockResolvedValue(makeProfile());

    const [req, ctx] = makeArgs('p-1');
    const res = await GET(req, ctx);

    expectNoPrivatePlayerData(await res.json());
  });

  it('the player themself gets the full row', async () => {
    const profile = makeProfile();
    mockRequireAuth.mockResolvedValue(sessionFor('p-1'));
    mockCompose.mockResolvedValue(profile);

    const [req, ctx] = makeArgs('p-1');
    const json = await (await GET(req, ctx)).json();

    expect(json.data).toEqual(profile);
  });

  it('a site admin (live player from requireAuth) gets the full row', async () => {
    const profile = makeProfile();
    mockRequireAuth.mockResolvedValue(sessionFor('admin-1', true));
    mockCompose.mockResolvedValue(profile);

    const [req, ctx] = makeArgs('p-1');
    const json = await (await GET(req, ctx)).json();

    expect(json.data.player.discord_id).toBe(profile.player.discord_id);
  });

  it('returns 404 when player not found', async () => {
    mockRequireAuth.mockResolvedValue(sessionFor('p-2'));
    mockCompose.mockResolvedValue(null);

    const [req, ctx] = makeArgs('p-missing');
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Player not found');
    expect(json.code).toBe('player_not_found');
  });

  it('returns auth error when not authenticated', async () => {
    mockRequireAuth.mockRejectedValue(new AuthError('Not authenticated', 401));

    const [req, ctx] = makeArgs('p-1');
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Not authenticated');
    expect(mockCompose).not.toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    mockRequireAuth.mockResolvedValue(sessionFor('p-2'));
    mockCompose.mockRejectedValue(new Error('compose failed'));

    const [req, ctx] = makeArgs('p-1');
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to fetch player profile');
  });
});
