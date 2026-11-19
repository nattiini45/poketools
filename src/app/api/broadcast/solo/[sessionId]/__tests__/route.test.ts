import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CastSession } from '@/types/cast-session';
import type { PhaseCastSession } from '@/types/phase-cast-session';

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
  getIndependentCastSession: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/phase-cast-sessions', () => ({ getPhaseCastSessionById: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-storage', () => ({ readPhaseStorageMode: vi.fn() }));

// The limiter decision is covered in roadcast/__tests__/overlay-limits.test.ts.
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkPublicRateLimit: vi.fn(async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0 })),
}));

import { GET } from '@/app/api/broadcast/solo/[sessionId]/route';
import { getCastSessionById, getIndependentCastSession } from '@/lib/supabase/queries/cast-sessions';
import { getPhaseCastSessionById } from '@/lib/supabase/queries/phase-cast-sessions';
import { readPhaseStorageMode } from '@/lib/supabase/queries/phase-storage';
import { checkPublicRateLimit } from '@/lib/utils/rate-limit';

const SESSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const native = {
  id: SESSION_ID, name: 'Fixture broadcast', mode: 'solo', status: 'live',
  owner_id: 'fixture-owner', realtime_key: 'fixture-private-key',
  phase_id: 'fixture-phase', season_id: 'fixture-league', match_id: 'fixture-match',
  player1_id: 'fixture-player', player1_name: 'Fixture Caster', player1_avatar_url: null,
  player2_id: null, player2_name: null, player2_avatar_url: null, player1_team: [], player2_team: [],
  caster_notes: { match: 'fixture-private-notes' }, tracker_state: null, overlay_config: {},
  format: 'gen9ou', generation: 9, created_at: '2026-04-07T00:00:00Z', updated_at: '2026-04-07T00:00:00Z',
} satisfies PhaseCastSession;

function read(sessionId = SESSION_ID, query = '') {
  return GET(new Request(`http://localhost/api/broadcast/solo/${sessionId}${query}`), {
    params: Promise.resolve({ sessionId }),
  });
}

afterEach(() => vi.unstubAllEnvs());

describe('broadcast solo session route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('READ_PHASE_STORAGE_STATE', 'false');
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
    expect(response.headers.get('cache-control')).toBe('public, s-maxage=2, stale-while-revalidate=5');
    expect(readPhaseStorageMode).not.toHaveBeenCalled();
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

describe('mode-aware OBS solo reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
    vi.mocked(readPhaseStorageMode).mockResolvedValue('phase');
    vi.mocked(getPhaseCastSessionById).mockResolvedValue(native);
  });

  it('serves the existing public DTO for a migrated UUID without any private or competition fields', async () => {
    const response = await read();
    const { data } = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(Object.keys(data).sort()).toEqual([
      'current_game', 'games_submitted', 'losses', 'player1_id', 'player1_name', 'player1_team',
      'player2_name', 'player2_team', 'session_id', 'updated_at', 'wins',
    ]);
    expect(data).toMatchObject({ session_id: SESSION_ID, player1_name: 'Fixture Caster' });
    expect(JSON.stringify(data)).not.toMatch(/fixture-private-|fixture-phase|fixture-league|fixture-match|fixture-owner/);
    expect(getPhaseCastSessionById).toHaveBeenCalledExactlyOnceWith(SESSION_ID);
    expect(getIndependentCastSession).not.toHaveBeenCalled();
    expect(getCastSessionById).not.toHaveBeenCalled();
  });

  it('reads independent solo sessions after native absence but not after a native error', async () => {
    const { phase_id: _phase, ...common } = native;
    vi.mocked(getIndependentCastSession).mockResolvedValue({ ...common, tournament_id: null });
    vi.mocked(getPhaseCastSessionById).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('fixture read failed'));
    expect((await read()).status).toBe(200);
    const failed = await read();
    expect(failed.status).toBe(500);
    expect(failed.headers.get('cache-control')).toBe('no-store');
    expect(getIndependentCastSession).toHaveBeenCalledTimes(1);
    expect(getCastSessionById).not.toHaveBeenCalled();
  });

  it('keeps the legacy reader but avoids CDN caching while enabled in legacy mode', async () => {
    const { phase_id: _phase, ...common } = native;
    vi.mocked(readPhaseStorageMode).mockResolvedValue('legacy');
    vi.mocked(getCastSessionById).mockResolvedValue({ ...common, tournament_id: null });
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(getCastSessionById).toHaveBeenCalledExactlyOnceWith(SESSION_ID);
    expect(getPhaseCastSessionById).not.toHaveBeenCalled();
  });

  it.each(['frozen_legacy', 'frozen_phase'] as const)('refuses %s without reading a session', async (mode) => {
    vi.mocked(readPhaseStorageMode).mockResolvedValue(mode);
    const response = await read();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ code: 'phase_storage_unavailable' });
    expect(getPhaseCastSessionById).not.toHaveBeenCalled();
    expect(getIndependentCastSession).not.toHaveBeenCalled();
    expect(getCastSessionById).not.toHaveBeenCalled();
  });

  it('keeps path, query and rate gates ahead of all generation and session reads', async () => {
    expect((await read('bad')).status).toBe(404);
    expect((await read(SESSION_ID, '?unused=1')).status).toBe(400);
    expect(checkPublicRateLimit).not.toHaveBeenCalled();
    vi.mocked(checkPublicRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 17 });
    const limited = await read();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('17');
    expect(limited.headers.get('cache-control')).toBe('no-store');
    expect(readPhaseStorageMode).not.toHaveBeenCalled();
    expect(getPhaseCastSessionById).not.toHaveBeenCalled();
  });
});
