import { describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { PlayerProfile } from '@/types/profile';
import { fullPlayerRow } from '@/lib/players/__tests__/private-player-fields';

vi.mock('@/lib/profile/compose', () => ({ composePlayerProfile: vi.fn() }));
vi.mock('@/lib/pack-extensions', () => ({ loadSupplement: vi.fn(), packExtensions: { historicalProfile: vi.fn() } }));

import { GET } from '../route';
import { composePlayerProfile } from '@/lib/profile/compose';
import { loadSupplement } from '@/lib/pack-extensions';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function profile(): PlayerProfile {
  return {
    player: fullPlayerRow({ id, name: 'Trainer Orbit' }),
    headline: { total_matches: 2, total_wins: 1, total_losses: 1, win_rate: 50, total_kos_dealt: 4, unique_pokemon_used: 1, tournaments_entered: 1, tournaments_won: 0 },
    current_participations: [], past_participations: [], upcoming_matches: [], recent_matches: [],
    most_used_pokemon: [], best_kill_pokemon: [], recent_form: [], trophies: [], rating: null, streaks: null, signatures: [], achievements: [],
    live_pokemon_counters: [{ pokemon_name: 'Mew', total_games: 2, total_wins: 1, total_kos_dealt: 4, total_koed: 1 }],
  };
}

describe('public profile history boundary', () => {
  it('combines per request, strips full counters, and never enables CDN caching', async () => {
    vi.mocked(composePlayerProfile).mockResolvedValue(profile());
    vi.mocked(loadSupplement).mockResolvedValue({ state: 'ready', value: { state: 'ready', data: {
      record: { played: 3, wins: 2, draws: 1, losses: 0 },
      pokemon: [{ pokemonName: 'Mew', appearances: 3, wins: 2, kos: 8 }], honors: [], participations: [], coverage: [],
    } } });
    const response = await GET({} as NextRequest, { params: Promise.resolve({ id }) });
    const { data } = await response.json();
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(data.headline).toMatchObject({ total_matches: 5, total_kos_dealt: 12 });
    expect(data.most_used_pokemon[0].total_games).toBe(5);
    expect(data).not.toHaveProperty('live_pokemon_counters');
    expect(data.player).not.toHaveProperty('discord_id');
  });

  it.each(['excluded', 'failed'] as const)('returns explicit %s state with live numbers and private caching', async (state) => {
    vi.mocked(composePlayerProfile).mockResolvedValue(profile());
    vi.mocked(loadSupplement).mockResolvedValue({ state });
    const response = await GET({} as NextRequest, { params: Promise.resolve({ id }) });
    const { data } = await response.json();
    expect(data.history.state).toBe(state);
    expect(data.headline.total_kos_dealt).toBe(4);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
