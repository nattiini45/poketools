import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { CastSession, CastSessionStatus } from '@/types/cast-session';

/**
 * PATCH /api/cast-sessions/[id] and `cast_sessions.status`
 * (docs/state-machines.md, "Cast session"). No screen writes the status; the
 * route accepts it from the owner or an admin. Uses the real
 * safeErrorResponse so refusals show their status and code.
 */

vi.mock('@/lib/auth/helpers', () => ({
  requireCreator: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/cast-sessions', () => ({
  getCastSessionById: vi.fn(),
  updateCastSession: vi.fn(),
  updateCastSessionFromStatus: vi.fn(),
  deleteCastSession: vi.fn(),
}));

import { PATCH } from '../route';
import { requireCreator } from '@/lib/auth/helpers';
import {
  getCastSessionById,
  updateCastSession,
  updateCastSessionFromStatus,
} from '@/lib/supabase/queries/cast-sessions';

const ID = '9f2cf170-09cd-49c8-81a4-9898aefdcd21';

function session(status: CastSessionStatus): CastSession {
  return {
    id: ID,
    owner_id: 'player-1',
    realtime_key: '00000000-0000-4000-8000-000000000001',
    match_id: null,
    tournament_id: null,
    season_id: null,
    name: 'Test Session',
    mode: 'cast',
    status,
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
  };
}

const OWNER = {
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

const ADMIN = { ...OWNER, playerId: 'player-admin', name: 'Admin', isAdmin: true } as const;

function patch(body: Record<string, unknown>) {
  const req = { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
  return PATCH(req, { params: Promise.resolve({ id: ID }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCreator).mockResolvedValue(OWNER);
  vi.mocked(updateCastSession).mockImplementation(async (_id, update) => ({
    ...session('draft'),
    ...(update.status ? { status: update.status } : {}),
  }));
  vi.mocked(updateCastSessionFromStatus).mockImplementation(async (_id, update) => ({
    ...session('draft'),
    ...(update.status ? { status: update.status } : {}),
  }));
});

describe('PATCH /api/cast-sessions/[id] status', () => {
  it.each([
    ['draft', 'live'],
    ['live', 'draft'],
    ['draft', 'archived'],
    ['live', 'archived'],
    ['archived', 'draft'],
  ] as const)('the owner moves a session %s → %s', async (from, to) => {
    vi.mocked(getCastSessionById).mockResolvedValue(session(from));
    const res = await patch({ status: to });
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe(to);
    expect(updateCastSessionFromStatus).toHaveBeenCalledWith(ID, { status: to }, from);
    expect(updateCastSession).not.toHaveBeenCalled();
  });

  it('refuses archived → live: an archived session goes back to draft first', async () => {
    vi.mocked(getCastSessionById).mockResolvedValue(session('archived'));
    const res = await patch({ status: 'live', name: 'Renamed' });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe('state_transition_invalid');
    expect(json.params).toEqual({ machine: 'cast_session', from: 'archived', to: 'live' });
    expect(updateCastSession).not.toHaveBeenCalled();
    expect(updateCastSessionFromStatus).not.toHaveBeenCalled();
  });

  it('answers 409 cast_session_changed when the status moved between the read and the write', async () => {
    vi.mocked(getCastSessionById).mockResolvedValue(session('draft'));
    vi.mocked(updateCastSessionFromStatus).mockResolvedValue(null);
    const res = await patch({ status: 'live' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Session changed in the meantime',
      code: 'cast_session_changed',
    });
  });

  it('an admin moves another caster’s session', async () => {
    vi.mocked(requireCreator).mockResolvedValue(ADMIN);
    vi.mocked(getCastSessionById).mockResolvedValue(session('live'));
    const res = await patch({ status: 'archived' });
    expect(res.status).toBe(200);
  });

  it('a status equal to the current one is not a move: the save goes through unguarded', async () => {
    vi.mocked(getCastSessionById).mockResolvedValue(session('live'));
    const res = await patch({ status: 'live', name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(updateCastSession).toHaveBeenCalledWith(ID, { status: 'live', name: 'Renamed' });
  });

  it('an autosave without a status is not guarded by the status', async () => {
    vi.mocked(getCastSessionById).mockResolvedValue(session('archived'));
    const res = await patch({ name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(updateCastSession).toHaveBeenCalledWith(ID, { name: 'Renamed' });
  });

  it('rejects a status outside draft / live / archived', async () => {
    vi.mocked(getCastSessionById).mockResolvedValue(session('draft'));
    const res = await patch({ status: 'deleted' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
    expect(updateCastSession).not.toHaveBeenCalled();
  });
});
