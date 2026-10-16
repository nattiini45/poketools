import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { CastSession } from '@/types/cast-session';

vi.mock('@/lib/auth/helpers', () => ({
  requireCreator: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/cast-sessions', () => ({
  listCastSessions: vi.fn(),
  createCastSession: vi.fn(),
}));

import { GET, POST } from '@/app/api/cast-sessions/route';
import { requireCreator } from '@/lib/auth/helpers';
import { listCastSessions, createCastSession } from '@/lib/supabase/queries/cast-sessions';

const creatorPlayer = {
  playerId: 'player-1',
  name: 'Streamer',
  isAdmin: false,
  isResourceAdmin: false,
  isCreator: true,
  psUsername: 'StreamerPS',
  championsUsername: 'StreamerChamp',
  avatarUrl: 'https://example.com/avatar.png',
};

describe('GET /api/cast-sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCreator).mockResolvedValue(creatorPlayer as never);
  });

  it('returns sessions for current user', async () => {
    vi.mocked(listCastSessions).mockResolvedValue([
      {
        id: 'session-1',
        owner_id: 'player-1',
        match_id: null,
        tournament_id: null,
        season_id: null,
        name: 'My Session',
        mode: 'solo',
        status: 'draft',
        player1_id: 'player-1',
        player1_name: 'Streamer',
        player1_avatar_url: null,
        player2_id: null,
        player2_name: 'Opponent',
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
      },
    ] as never);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].name).toBe('My Session');
    expect(vi.mocked(listCastSessions)).toHaveBeenCalledWith('player-1');
  });

  it('returns auth error when not a creator', async () => {
    const { AuthError } = await import('@/lib/auth/helpers');
    vi.mocked(requireCreator).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not a creator', 403),
    );

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.success).toBe(false);
  });
});

describe('POST /api/cast-sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCreator).mockResolvedValue(creatorPlayer as never);
  });

  it('seeds solo sessions with creator identity and opponent placeholder', async () => {
    vi.mocked(createCastSession).mockResolvedValue({
      id: 'session-1',
      owner_id: 'player-1',
      realtime_key: '00000000-0000-4000-8000-000000000001',
      match_id: null,
      tournament_id: null,
      season_id: null,
      name: 'Solo Session',
      mode: 'solo',
      status: 'draft',
      player1_id: 'player-1',
      player1_name: 'Streamer',
      player1_avatar_url: 'https://example.com/avatar.png',
      player2_id: null,
      player2_name: 'Opponent',
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

    const request = {
      json: vi.fn().mockResolvedValue({ mode: 'solo' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json() as { success: boolean; data: CastSession };

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(vi.mocked(createCastSession)).toHaveBeenCalledWith('player-1', expect.objectContaining({
      mode: 'solo',
      player1_id: 'player-1',
      player1_name: 'Streamer',
      player1_avatar_url: 'https://example.com/avatar.png',
      player2_id: null,
      player2_name: 'Opponent',
      player2_avatar_url: null,
    }));
  });

  it('passes through body as-is for non-solo mode', async () => {
    const matchUuid = 'a0000000-0000-4000-a000-000000000001';
    const tournUuid = 'a0000000-0000-4000-a000-000000000002';
    vi.mocked(createCastSession).mockResolvedValue({
      id: 'session-2',
      owner_id: 'player-1',
      realtime_key: '00000000-0000-4000-8000-000000000002',
      match_id: matchUuid,
      tournament_id: tournUuid,
      season_id: null,
      name: 'Tournament Cast',
      mode: 'cast',
      status: 'draft',
      player1_id: 'p1',
      player1_name: 'Player 1',
      player1_avatar_url: null,
      player2_id: 'p2',
      player2_name: 'Player 2',
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
    } as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        mode: 'cast',
        match_id: matchUuid,
        tournament_id: tournUuid,
      }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    // Non-solo mode should NOT inject player defaults
    expect(vi.mocked(createCastSession)).toHaveBeenCalledWith('player-1', expect.objectContaining({
      mode: 'cast',
      match_id: matchUuid,
    }));
  });

  it('returns auth error when not a creator', async () => {
    const { AuthError } = await import('@/lib/auth/helpers');
    vi.mocked(requireCreator).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not a creator', 403),
    );

    const request = {
      json: vi.fn().mockResolvedValue({ mode: 'solo' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.success).toBe(false);
  });

  it('returns 400 with validation_failed for an invalid body', async () => {
    vi.mocked(requireCreator).mockResolvedValue(creatorPlayer as never);

    const request = {
      json: vi.fn().mockResolvedValue({ match_id: 'not-a-uuid' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('validation_failed');
    expect(payload.params).toEqual({ issues: payload.error });
    expect(createCastSession).not.toHaveBeenCalled();
  });
});
