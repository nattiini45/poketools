import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/helpers', () => ({
  requireAnyAdmin: vi.fn(),
  requireResourceAdmin: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/players', () => ({
  listPlayers: vi.fn(),
}));

import { GET } from '../route';
import { requireAnyAdmin, requireResourceAdmin } from '@/lib/auth/helpers';
import { listPlayers } from '@/lib/supabase/queries/players';
import { makeRequest } from '@/lib/__tests__/helpers/api-request';
import { expectNoPrivatePlayerData, fullPlayerRow } from '@/lib/players/__tests__/private-player-fields';
import type { SessionPlayer } from '@/types/auth';

const SEASON_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const TOURNAMENT_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';

/** The statusCode-carrying error the real guards throw (safeErrorResponse duck-types it). */
class GuardError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

function livePlayer(overrides: Partial<SessionPlayer> = {}): SessionPlayer {
  return { playerId: 'admin-1', name: 'Admin', isAdmin: false, isResourceAdmin: true, ...overrides } as SessionPlayer;
}

const siteAdmin = livePlayer({ isAdmin: true, isResourceAdmin: false });
const resourceAdmin = livePlayer();

function search(params: Record<string, string>) {
  return GET(makeRequest(undefined, params));
}

describe('GET /api/admin/player-search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(requireAnyAdmin).mockResolvedValue(resourceAdmin);
    vi.mocked(requireResourceAdmin).mockResolvedValue(resourceAdmin);
    vi.mocked(listPlayers).mockResolvedValue({
      data: [
        fullPlayerRow({ id: 'p1', name: 'Mara', is_guest: false }),
        fullPlayerRow({ id: 'p2', name: 'Maro', is_guest: true }),
      ],
      total: 2,
    });
  });

  describe('guards', () => {
    it('refuses a signed-out caller before reading anything', async () => {
      vi.mocked(requireAnyAdmin).mockRejectedValue(new GuardError('Authentication required', 401, 'unauthorized'));

      const res = await search({ q: 'ma', season_id: SEASON_ID });

      expect(res.status).toBe(401);
      expect(requireResourceAdmin).not.toHaveBeenCalled();
      expect(listPlayers).not.toHaveBeenCalled();
    });

    it('refuses a signed-in non-admin', async () => {
      vi.mocked(requireAnyAdmin).mockRejectedValue(new GuardError('Admin access required', 403, 'forbidden'));

      const res = await search({ q: 'ma', season_id: SEASON_ID });

      expect(res.status).toBe(403);
      expect(listPlayers).not.toHaveBeenCalled();
    });

    it('checks the admin guard before it validates the query', async () => {
      vi.mocked(requireAnyAdmin).mockRejectedValue(new GuardError('Admin access required', 403, 'forbidden'));

      const res = await search({});

      expect(res.status).toBe(403);
    });

    it('lets a site admin search without naming a resource', async () => {
      vi.mocked(requireAnyAdmin).mockResolvedValue(siteAdmin);

      const res = await search({ q: 'ma' });

      expect(res.status).toBe(200);
      expect(requireResourceAdmin).not.toHaveBeenCalled();
      expect(listPlayers).toHaveBeenCalledWith({ limit: 10, offset: 0, search: 'ma' });
    });

    it('does not re-check the resource for a site admin who names one', async () => {
      vi.mocked(requireAnyAdmin).mockResolvedValue(siteAdmin);

      const res = await search({ q: 'ma', season_id: SEASON_ID });

      expect(res.status).toBe(200);
      expect(requireResourceAdmin).not.toHaveBeenCalled();
    });
  });

  describe('scoping a resource admin', () => {
    it('requires season_id or tournament_id', async () => {
      const res = await search({ q: 'ma' });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe('validation_failed');
      expect(requireResourceAdmin).not.toHaveBeenCalled();
      expect(listPlayers).not.toHaveBeenCalled();
    });

    it('rejects both ids at once, for a site admin too', async () => {
      for (const player of [resourceAdmin, siteAdmin]) {
        vi.mocked(requireAnyAdmin).mockResolvedValue(player);
        const res = await search({ q: 'ma', season_id: SEASON_ID, tournament_id: TOURNAMENT_ID });
        expect(res.status).toBe(400);
      }
      expect(listPlayers).not.toHaveBeenCalled();
    });

    it('checks season admin rights for season_id', async () => {
      const res = await search({ q: 'ma', season_id: SEASON_ID });

      expect(res.status).toBe(200);
      expect(requireResourceAdmin).toHaveBeenCalledWith('season', SEASON_ID);
      expect(listPlayers).toHaveBeenCalledTimes(1);
    });

    it('checks tournament admin rights (cascading to the season) for tournament_id', async () => {
      const res = await search({ q: 'ma', tournament_id: TOURNAMENT_ID });

      expect(res.status).toBe(200);
      expect(requireResourceAdmin).toHaveBeenCalledWith('tournament', TOURNAMENT_ID);
    });

    it('answers 403 and searches nothing for a resource the caller does not administer', async () => {
      vi.mocked(requireResourceAdmin).mockRejectedValue(
        new GuardError('Admin access required for this resource', 403, 'forbidden'),
      );

      const res = await search({ q: 'ma', season_id: SEASON_ID });
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.success).toBe(false);
      expect(listPlayers).not.toHaveBeenCalled();
    });
  });

  describe('what the search can see', () => {
    it('limits a season admin to what the public directory shows, across the whole directory', async () => {
      await search({ q: 'ma', season_id: SEASON_ID });

      const options = vi.mocked(listPlayers).mock.calls[0][0];
      expect(options?.visibleOnly).toBe(true);
      // The scope is a guard, not a filter: the picker finds players who are not participants yet.
      expect(Object.keys(options ?? {}).sort()).toEqual(['limit', 'offset', 'search', 'visibleOnly']);
    });

    it('limits a tournament admin the same way', async () => {
      await search({ q: 'ma', tournament_id: TOURNAMENT_ID });

      expect(vi.mocked(listPlayers).mock.calls[0][0]?.visibleOnly).toBe(true);
    });

    it('lets a site admin search every account, banned, suspended and test accounts included', async () => {
      vi.mocked(requireAnyAdmin).mockResolvedValue(siteAdmin);

      await search({ q: 'ma' });
      await search({ q: 'ma', season_id: SEASON_ID, registered: '1' });

      for (const [options] of vi.mocked(listPlayers).mock.calls) {
        expect(options).not.toHaveProperty('visibleOnly');
      }
    });
  });

  describe('validation', () => {
    it.each([
      ['a missing q', {}],
      ['a blank q', { q: '   ' }],
      ['a q over 64 characters', { q: 'x'.repeat(65) }],
      ['a season_id that is not a uuid', { q: 'ma', season_id: 'not-a-uuid' }],
      ['a tournament_id that is not a uuid', { q: 'ma', tournament_id: '123' }],
      ['an empty season_id', { q: 'ma', season_id: '' }],
      ['a limit of 0', { q: 'ma', season_id: SEASON_ID, limit: '0' }],
      ['a limit over 20', { q: 'ma', season_id: SEASON_ID, limit: '21' }],
      ['a non-numeric limit', { q: 'ma', season_id: SEASON_ID, limit: 'many' }],
      ['a fractional limit', { q: 'ma', season_id: SEASON_ID, limit: '2.5' }],
    ])('rejects %s with 400 validation_failed', async (_label, params) => {
      vi.mocked(requireAnyAdmin).mockResolvedValue(siteAdmin);

      const res = await search(params as Record<string, string>);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json).toMatchObject({ success: false, code: 'validation_failed' });
      expect(listPlayers).not.toHaveBeenCalled();
    });

    it('trims q and accepts the 64 and 20 boundaries', async () => {
      await search({ q: `  ${'x'.repeat(64)}  `, season_id: SEASON_ID, limit: '20' });

      expect(listPlayers).toHaveBeenCalledWith({ limit: 20, offset: 0, search: 'x'.repeat(64), visibleOnly: true });
    });

    it('passes the typed text to the player search unchanged, so a name or Showdown username can match', async () => {
      await search({ q: 'a_b%c,d', season_id: SEASON_ID });

      expect(listPlayers).toHaveBeenCalledWith({ limit: 10, offset: 0, search: 'a_b%c,d', visibleOnly: true });
    });

    it('defaults the limit to 10', async () => {
      await search({ q: 'ma', season_id: SEASON_ID });

      expect(listPlayers).toHaveBeenCalledWith({ limit: 10, offset: 0, search: 'ma', visibleOnly: true });
    });

    it('asks for registered accounts only with registered=1 (the guest-link picker)', async () => {
      await search({ q: 'ma', season_id: SEASON_ID, registered: '1' });

      expect(listPlayers).toHaveBeenCalledWith({
        limit: 10,
        offset: 0,
        search: 'ma',
        registeredOnly: true,
        visibleOnly: true,
      });
    });

    it('rejects any other registered value', async () => {
      const res = await search({ q: 'ma', season_id: SEASON_ID, registered: 'yes' });

      expect(res.status).toBe(400);
      expect(listPlayers).not.toHaveBeenCalled();
    });
  });

  describe('response', () => {
    it('returns only id, name and is_guest, plus the total', async () => {
      const res = await search({ q: 'ma', season_id: SEASON_ID });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({
        success: true,
        data: [
          { id: 'p1', name: 'Mara', is_guest: false },
          { id: 'p2', name: 'Maro', is_guest: true },
        ],
        total: 2,
      });
    });

    it('never carries a private player column, even from a full row', async () => {
      const res = await search({ q: 'ma', tournament_id: TOURNAMENT_ID });
      const json = await res.json();

      expectNoPrivatePlayerData(json);
      expect(JSON.stringify(json)).not.toContain('avatar');
      expect(JSON.stringify(json)).not.toContain('ps_username');
    });

    it('reports the full match count when the page is shorter', async () => {
      vi.mocked(listPlayers).mockResolvedValue({ data: [fullPlayerRow({ id: 'p1', name: 'Mara' })], total: 63 });

      const json = await (await search({ q: 'ma', season_id: SEASON_ID, limit: '1' })).json();

      expect(json.data).toHaveLength(1);
      expect(json.total).toBe(63);
    });
  });

  describe('errors', () => {
    it('answers a failed search with a generic 500 that leaks no database text', async () => {
      vi.mocked(listPlayers).mockRejectedValue(new Error('relation "players" does not exist'));

      const res = await search({ q: 'ma', season_id: SEASON_ID });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json).toMatchObject({ success: false, error: 'Failed to search players' });
      expect(JSON.stringify(json)).not.toContain('relation');
    });

    it('answers a failed resource-admin read with 500, not as a refusal', async () => {
      vi.mocked(requireResourceAdmin).mockRejectedValue(new Error('connection reset'));

      const res = await search({ q: 'ma', season_id: SEASON_ID });

      expect(res.status).toBe(500);
      expect(listPlayers).not.toHaveBeenCalled();
    });
  });
});
