import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/trainer-avatars-3d', () => ({
  getTrainerAvatar3D: vi.fn(),
  upsertTrainerAvatar3D: vi.fn(),
}));

import { GET, PUT } from '@/app/api/avatar/3d/route';
import { requireAuth } from '@/lib/auth/helpers';
import { getTrainerAvatar3D, upsertTrainerAvatar3D } from '@/lib/supabase/queries/trainer-avatars-3d';

const SESSION_WITH_PLAYER = {
  expires: new Date(Date.now() + 86_400_000).toISOString(),
  user: { id: 'u1' },
  player: { playerId: 'p1' },
};

const SESSION_NO_PLAYER = {
  expires: new Date(Date.now() + 86_400_000).toISOString(),
  user: { id: 'u1' },
  player: null,
};

const VALID_CONFIG = {
  skinTone: '#f1c27d',
  hairStyle: 2,
  hairColor: '#222222',
  outfitColor: '#cc0000',
  pantsColor: '#333333',
  hatStyle: 1,
  hatColor: '#ffffff',
  teamColor: '#0044ff',
};

function makeRequest(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

describe('/api/avatar/3d error codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(SESSION_WITH_PLAYER as never);
  });

  it('GET: 403 player_registration_required without a player row', async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION_NO_PLAYER as never);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toMatchObject({ error: 'Player registration required', code: 'player_registration_required' });
  });

  it('GET: returns the stored config', async () => {
    vi.mocked(getTrainerAvatar3D).mockResolvedValue(VALID_CONFIG);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.config).toEqual(VALID_CONFIG);
  });

  it('PUT: 403 player_registration_required without a player row', async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION_NO_PLAYER as never);

    const res = await PUT(makeRequest({ config: VALID_CONFIG }));

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('player_registration_required');
  });

  it('PUT: 400 invalid_json for a non-object body, keeping the English text', async () => {
    const res = await PUT(makeRequest(null));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({ error: 'Request body must be a JSON object', code: 'invalid_json' });
  });

  it("PUT: 403 avatar_3d_not_owned when the body names another player's id", async () => {
    const res = await PUT(makeRequest({ player_id: 'p2', config: VALID_CONFIG }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toMatchObject({ error: "Cannot modify another player's avatar", code: 'avatar_3d_not_owned' });
    expect(upsertTrainerAvatar3D).not.toHaveBeenCalled();
  });

  it('PUT: 400 avatar_3d_config_invalid for a malformed config', async () => {
    const res = await PUT(makeRequest({ config: { ...VALID_CONFIG, hairStyle: 99 } }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid avatar configuration', code: 'avatar_3d_config_invalid' });
  });

  it('PUT: a failed save answers with the avatar_3d_save_failed fallback code', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(upsertTrainerAvatar3D).mockRejectedValue(new Error('db down'));

    const res = await PUT(makeRequest({ config: VALID_CONFIG }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toMatchObject({ error: 'Failed to save 3D avatar', code: 'avatar_3d_save_failed' });
  });
});
