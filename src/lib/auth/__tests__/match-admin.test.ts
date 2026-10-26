import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  isResourceAdminFor: vi.fn(),
}));

import { authorizeMatchAdmin } from '../match-admin';
import { requirePlayer } from '@/lib/auth/helpers';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';

const MATCH_ID = 'daa274a2-59da-43fd-84a5-8cede96e15a4';
const match = { id: MATCH_ID, tournament_id: 'tourn-1', status: 'completed' };

function player(overrides: Record<string, unknown> = {}) {
  return { playerId: 'player-1', name: 'Pat', isAdmin: false, ...overrides };
}

async function bodyOf(response: Response) {
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMatchById).mockResolvedValue(match as never);
  vi.mocked(isResourceAdminFor).mockResolvedValue(false);
});

describe('authorizeMatchAdmin', () => {
  it('lets a site admin in without a resource lookup', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player({ isAdmin: true }) as never);

    const result = await authorizeMatchAdmin(MATCH_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.match).toBe(match);
      expect(result.player.playerId).toBe('player-1');
    }
    expect(isResourceAdminFor).not.toHaveBeenCalled();
  });

  it('lets a resource admin of the match tournament in', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player() as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(true);

    const result = await authorizeMatchAdmin(MATCH_ID);

    expect(result.ok).toBe(true);
    expect(isResourceAdminFor).toHaveBeenCalledWith('player-1', 'tournament', 'tourn-1');
  });

  it('answers 403 forbidden for a player without admin access', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player() as never);

    const result = await authorizeMatchAdmin(MATCH_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(await bodyOf(result.response)).toEqual({
        status: 403,
        body: { success: false, error: 'Admin access required', code: 'forbidden' },
      });
    }
  });

  it('answers 404 match_not_found before the access check', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player({ isAdmin: true }) as never);
    vi.mocked(getMatchById).mockResolvedValue(null);

    const result = await authorizeMatchAdmin(MATCH_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const { status, body } = await bodyOf(result.response);
      expect(status).toBe(404);
      expect(body.code).toBe('match_not_found');
    }
    expect(isResourceAdminFor).not.toHaveBeenCalled();
  });

  it('answers 404 INVALID_MATCH_ID for a malformed id without reading the match', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(player({ isAdmin: true }) as never);

    const result = await authorizeMatchAdmin('not-a-uuid');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const { status, body } = await bodyOf(result.response);
      expect(status).toBe(404);
      expect(body.code).toBe('INVALID_MATCH_ID');
    }
    expect(getMatchById).not.toHaveBeenCalled();
  });

  it('propagates an auth failure from the live guard', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(new Error('Unauthorized'));

    await expect(authorizeMatchAdmin(MATCH_ID)).rejects.toThrow('Unauthorized');
    expect(getMatchById).not.toHaveBeenCalled();
  });
});
