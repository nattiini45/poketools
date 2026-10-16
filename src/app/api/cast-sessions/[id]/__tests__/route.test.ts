import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';
import type { CastSession } from '@/types/cast-session';

// ── Mocks ──────────────────────────────────────────────────────────────

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

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/supabase/queries/cast-sessions', () => ({
  getCastSessionById: vi.fn(),
  updateCastSession: vi.fn(),
  deleteCastSession: vi.fn(),
}));

import { GET, PATCH, DELETE } from '../route';
import { requireCreator } from '@/lib/auth/helpers';
import {
  getCastSessionById,
  updateCastSession,
  deleteCastSession,
} from '@/lib/supabase/queries/cast-sessions';

// ── Fixtures ───────────────────────────────────────────────────────────

const MOCK_SESSION: CastSession = {
  id: 'session-1',
  owner_id: 'player-1',
  realtime_key: '00000000-0000-4000-8000-000000000001',
  match_id: null,
  tournament_id: null,
  season_id: null,
  name: 'Test Session',
  mode: 'cast',
  status: 'draft',
  player1_id: 'player-1',
  player1_name: 'Alice',
  player1_avatar_url: null,
  player2_id: 'player-2',
  player2_name: 'Bob',
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
};

const OWNER_PLAYER = {
  playerId: 'player-1',
  name: 'Alice',
  isAdmin: false,
  isResourceAdmin: false,
  isCreator: true,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
} as const;

const ADMIN_PLAYER = {
  playerId: 'player-admin',
  name: 'Admin',
  isAdmin: true,
  isResourceAdmin: false,
  isCreator: true,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
} as const;

const OTHER_PLAYER = {
  playerId: 'player-other',
  name: 'Other',
  isAdmin: false,
  isResourceAdmin: false,
  isCreator: true,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
} as const;

function makeRouteParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('GET /api/cast-sessions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCreator).mockResolvedValue(OWNER_PLAYER);
    vi.mocked(getCastSessionById).mockResolvedValue(MOCK_SESSION);
  });

  it('returns a session for the owner', async () => {
    const req = {} as NextRequest;
    const res = await GET(req, makeRouteParams('session-1'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.id).toBe('session-1');
  });

  it('allows admin access to any session', async () => {
    vi.mocked(requireCreator).mockResolvedValue(ADMIN_PLAYER);

    const req = {} as NextRequest;
    const res = await GET(req, makeRouteParams('session-1'));
    const json = await res.json();

    expect(json.success).toBe(true);
  });

  it('returns 403 for non-owner non-admin', async () => {
    vi.mocked(requireCreator).mockResolvedValue(OTHER_PLAYER);

    const req = {} as NextRequest;
    const res = await GET(req, makeRouteParams('session-1'));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Not authorized');
    expect(json.code).toBe('cast_session_forbidden');
  });

  it('returns 404 when session does not exist', async () => {
    vi.mocked(getCastSessionById).mockResolvedValue(null);

    const req = {} as NextRequest;
    const res = await GET(req, makeRouteParams('nonexistent'));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Session not found');
    expect(json.code).toBe('cast_session_not_found');
  });
});

describe('PATCH /api/cast-sessions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCreator).mockResolvedValue(OWNER_PLAYER);
    vi.mocked(getCastSessionById).mockResolvedValue(MOCK_SESSION);
    vi.mocked(updateCastSession).mockResolvedValue({
      ...MOCK_SESSION,
      name: 'Updated Session',
    });
  });

  it('updates a session for the owner', async () => {
    const req = {
      json: vi.fn().mockResolvedValue({ name: 'Updated Session' }),
    } as unknown as NextRequest;

    const res = await PATCH(req, makeRouteParams('session-1'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.name).toBe('Updated Session');
    expect(updateCastSession).toHaveBeenCalledWith('session-1', { name: 'Updated Session' });
  });

  it('returns 403 for non-owner non-admin', async () => {
    vi.mocked(requireCreator).mockResolvedValue(OTHER_PLAYER);

    const req = {
      json: vi.fn().mockResolvedValue({ name: 'Hack' }),
    } as unknown as NextRequest;

    const res = await PATCH(req, makeRouteParams('session-1'));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Not authorized');
    expect(json.code).toBe('cast_session_forbidden');
  });

  it('returns 404 when session does not exist', async () => {
    vi.mocked(getCastSessionById).mockResolvedValue(null);

    const req = {
      json: vi.fn().mockResolvedValue({ name: 'x' }),
    } as unknown as NextRequest;

    const res = await PATCH(req, makeRouteParams('nonexistent'));
    await res.json();

    expect(res.status).toBe(404);
  });

  it('allows admin to update any session', async () => {
    vi.mocked(requireCreator).mockResolvedValue(ADMIN_PLAYER);

    const req = {
      json: vi.fn().mockResolvedValue({ name: 'Admin Edit' }),
    } as unknown as NextRequest;

    const res = await PATCH(req, makeRouteParams('session-1'));
    const json = await res.json();

    expect(json.success).toBe(true);
  });
});

describe('DELETE /api/cast-sessions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCreator).mockResolvedValue(OWNER_PLAYER);
    vi.mocked(getCastSessionById).mockResolvedValue(MOCK_SESSION);
    vi.mocked(deleteCastSession).mockResolvedValue(undefined);
  });

  it('deletes a session for the owner', async () => {
    const req = {} as NextRequest;
    const res = await DELETE(req, makeRouteParams('session-1'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.deleted).toBe(true);
    expect(deleteCastSession).toHaveBeenCalledWith('session-1');
  });

  it('returns 403 for non-owner non-admin', async () => {
    vi.mocked(requireCreator).mockResolvedValue(OTHER_PLAYER);

    const req = {} as NextRequest;
    const res = await DELETE(req, makeRouteParams('session-1'));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Not authorized');
    expect(json.code).toBe('cast_session_forbidden');
  });

  it('returns 404 when session does not exist', async () => {
    vi.mocked(getCastSessionById).mockResolvedValue(null);

    const req = {} as NextRequest;
    const res = await DELETE(req, makeRouteParams('nonexistent'));
    await res.json();

    expect(res.status).toBe(404);
  });

  it('allows admin to delete any session', async () => {
    vi.mocked(requireCreator).mockResolvedValue(ADMIN_PLAYER);

    const req = {} as NextRequest;
    const res = await DELETE(req, makeRouteParams('session-1'));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.deleted).toBe(true);
  });
});
