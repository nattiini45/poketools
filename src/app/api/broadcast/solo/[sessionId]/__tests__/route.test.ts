import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CastSession } from '@/types/cast-session';

vi.mock('@/lib/auth/helpers', () => ({
  AuthError: class AuthError extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/cast-sessions', () => ({
  getCastSessionById: vi.fn(),
}));

import { GET } from '@/app/api/broadcast/solo/[sessionId]/route';
import { getCastSessionById } from '@/lib/supabase/queries/cast-sessions';

describe('broadcast solo session route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a public-safe solo broadcast payload', async () => {
    vi.mocked(getCastSessionById).mockResolvedValue({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      owner_id: 'owner-1',
      realtime_key: '00000000-0000-4000-8000-000000000001',
      match_id: null,
      tournament_id: null,
      season_id: null,
      name: 'Solo Session',
      mode: 'solo',
      status: 'live',
      player1_id: 'owner-1',
      player1_name: 'Streamer',
      player1_avatar_url: 'https://example.com/me.png',
      player2_id: '',
      player2_name: '',
      player2_avatar_url: null,
      player1_team: [
        {
          species: 'Pikachu',
          name: 'Pikachu',
          gender: '',
          item: 'Light Ball',
          ability: 'Static',
          evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
          ivs: { hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31 },
          nature: 'Timid',
          level: 100,
          moves: ['Thunderbolt'],
        },
      ],
      player2_team: [],
      tracker_state: {
        match_id: '',
        games_submitted: [{ id: 'g1', game_number: 1, winner_id: 'owner-1', replay_url: '', source: 'manual' }],
        current_game: {
          game_number: 2,
          turn: 0,
          player1: {
            player_id: '',
            player_name: '',
            avatar_url: null,
            slots: [
              {
                pokemon_name: 'Pikachu',
                was_brought: true,
                was_lead: false,
                was_koed: false,
                kos_dealt: 2,
                moves_used: ['Thunderbolt'],
                turns_active: 4,
              },
            ],
          },
          player2: {
            player_id: '',
            player_name: '',
            avatar_url: null,
            slots: [],
          },
          moments: [],
        },
        history: [],
      },
      overlay_config: {},
      caster_notes: {},
      format: 'gen9ou',
      generation: 9,
      created_at: '2026-04-07T00:00:00.000Z',
      updated_at: '2026-04-07T00:00:00.000Z',
    } satisfies CastSession);

    const response = await GET(new Request('http://localhost/api/broadcast/solo/dddddddd-dddd-4ddd-8ddd-dddddddddddd'), {
      params: Promise.resolve({ sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
    });
    const payload = await response.json() as {
      success: boolean;
      data: {
        player1_id: string;
        player1_team: Array<{ species: string }>;
        current_game: {
          player1: { player_id: string; player_name: string; slots: Array<{ pokemon_name: string | null; kos_dealt: number }> };
          player2: { player_id: string; player_name: string };
        };
        wins: number;
        losses: number;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.player1_team).toEqual([{ species: 'Pikachu' }]);
    expect(payload.data.current_game.player1.player_id).toBe('owner-1');
    expect(payload.data.current_game.player1.player_name).toBe('Streamer');
    expect(payload.data.current_game.player2.player_id).toBe('solo-opponent');
    expect(payload.data.current_game.player2.player_name).toBe('Opponent');
    expect(payload.data.current_game.player1.slots[0]).toEqual({
      pokemon_name: 'Pikachu',
      was_brought: true,
      was_koed: false,
      kos_dealt: 2,
    });
    // Server-computed W/L from games_submitted
    expect(payload.data.player1_id).toBe('owner-1');
    expect(payload.data.wins).toBe(1);
    expect(payload.data.losses).toBe(0);
  });

  it('returns 404 for non-solo sessions', async () => {
    vi.mocked(getCastSessionById).mockResolvedValue({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      owner_id: 'owner-1',
      realtime_key: '00000000-0000-4000-8000-000000000002',
      match_id: null,
      tournament_id: null,
      season_id: null,
      name: 'Cast Session',
      mode: 'cast',
      status: 'draft',
      player1_id: null,
      player1_name: null,
      player1_avatar_url: null,
      player2_id: null,
      player2_name: null,
      player2_avatar_url: null,
      player1_team: [],
      player2_team: [],
      tracker_state: null,
      overlay_config: {},
      caster_notes: {},
      format: 'gen9ou',
      generation: 9,
      created_at: '2026-04-07T00:00:00.000Z',
      updated_at: '2026-04-07T00:00:00.000Z',
    } satisfies CastSession);

    const response = await GET(new Request('http://localhost/api/broadcast/solo/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), {
      params: Promise.resolve({ sessionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }),
    });

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload).toEqual({ success: false, error: 'Solo session not found', code: 'solo_session_not_found' });
  });
});
