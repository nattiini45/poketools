/**
 * GET /api/players/[id]/public-profile needs no login. Its player part must be
 * the `PublicPlayer` card only: before, `redactPlayer` dropped just
 * `discord_id` / `auth_user_id`, so `status`, `ban_reason`,
 * `suspended_until`, `is_admin`, `is_test_account` and `avatar_config` went
 * out to anonymous callers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/profile/compose', () => ({
  composePlayerProfile: vi.fn(),
}));

import { GET } from '../route';
import { composePlayerProfile } from '@/lib/profile/compose';
import { expectNoPrivatePlayerData, fullPlayerRow } from '@/lib/players/__tests__/private-player-fields';
import type { PlayerProfile } from '@/types/profile';

const routeArgs = (id: string) => ({ params: Promise.resolve({ id }) });

function makeProfile(): PlayerProfile {
  return {
    player: fullPlayerRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Alice', is_guest: true }),
    headline: { total_wins: 3, total_losses: 1 } as PlayerProfile['headline'],
    current_participations: [],
    past_participations: [],
    upcoming_matches: [],
    recent_matches: [],
    most_used_pokemon: [],
    best_kill_pokemon: [],
    recent_form: ['W'],
    trophies: [],
    rating: null,
    streaks: null,
    signatures: [],
    achievements: [],
  };
}

describe('GET /api/players/[id]/public-profile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the public view with the PublicPlayer card', async () => {
    const profile = makeProfile();
    vi.mocked(composePlayerProfile).mockResolvedValue(profile);

    const res = await GET({} as NextRequest, routeArgs('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.player).toEqual({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'Alice',
      avatar_url: profile.player.avatar_url,
      ps_username: 'mara_ps',
      champions_username: 'mara_champs',
      joined_date: '2026-01-01',
      is_creator: true,
      is_guest: true,
    });
    // Login-only sections stay out of the public view.
    expect(json.data).not.toHaveProperty('recent_matches');
    expect(json.data).not.toHaveProperty('upcoming_matches');
    expect(json.data).not.toHaveProperty('streaks');
  });

  it('the response carries no private player column (JSON.stringify check)', async () => {
    vi.mocked(composePlayerProfile).mockResolvedValue(makeProfile());

    const res = await GET({} as NextRequest, routeArgs('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));

    expectNoPrivatePlayerData(await res.json());
  });

  it('returns 404 for an unknown player', async () => {
    vi.mocked(composePlayerProfile).mockResolvedValue(null);

    const res = await GET({} as NextRequest, routeArgs('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('player_not_found');
  });

  it('returns 500 when composing fails', async () => {
    vi.mocked(composePlayerProfile).mockRejectedValue(new Error('compose failed'));

    const res = await GET({} as NextRequest, routeArgs('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to fetch player profile');
  });
});
