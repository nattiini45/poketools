import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_GAME_FIELDS, PUBLIC_MATCH_FIELDS } from '@/lib/match/public-match';
import { getPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { listContentMatches } from '../creator-content';

const { fetchStub } = vi.hoisted(() => ({ fetchStub: vi.fn<typeof fetch>() }));

vi.mock('@/lib/supabase/client', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    supabase: createClient('http://postgrest.test', 'test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchStub },
    }),
  };
});

const recent = '2026-11-19T00:00:00+00:00';
const earlier = '2026-11-18T00:00:00+00:00';
const old = '2026-11-17T00:00:00+00:00';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function match(n: number, createdAt = recent) {
  return {
    id: id(n), round_id: 'round', player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p2',
    status: 'completed', date_played: null, scheduled_at: null, social_image_url: null,
    bracket_side: null, bracket_pos: null, created_at: createdAt, updated_at: createdAt,
    player_1: { name: 'Orbit', avatar_url: 'https://example.test/avatar.webp' },
    player_2: { name: 'Kite', avatar_url: null }, winner: { name: 'Kite' }, round: { status: 'completed' },
    games: [2, 1].map((num) => ({
      id: `game-${num}`, game_number: num, winner_id: 'p2', replay_url: '', source: 'manual',
      stats_locked: false, overlay_key: 'private', submitted_by: 'private',
    })),
    notes: 'private', submitter_id: 'private', auto_confirm_at: 'private', confirmed_at: 'private',
    finalized_at: 'private', overlay_key: 'private',
  };
}

const legacy = (n: number, createdAt = recent, seasonId: string | null = null) => ({
  ...match(n, createdAt), tournament_id: 'tournament', tournament: { season_id: seasonId },
});
const native = (n: number, createdAt = recent) => ({
  ...match(n, createdAt), phase_id: 'phase', phase: { season_id: 'league', overlay_key: 'private' },
});
const json = (data: unknown) => Response.json(data);
const requests = () => fetchStub.mock.calls.map(([url]) => new URL(String(url)));

beforeEach(() => {
  fetchStub.mockReset();
  vi.unstubAllEnvs();
});

describe('creator dashboard match read', () => {
  it('keeps flag-off and frozen-legacy reads on the previous source, order, visibility and cap', async () => {
    vi.stubEnv('READ_PHASE_STORAGE_STATE', 'false');
    fetchStub.mockImplementation(async () => json([legacy(1, recent, 'legacy-league'), legacy(2)]));

    for (const mode of [await getPhaseRouteMode(), 'frozen_legacy'] as const) {
      const rows = await listContentMatches(mode);
      expect(rows.map((row) => row.id)).toEqual([id(1), id(2)]);
      expect(Object.keys(rows[0]).sort()).toEqual([...PUBLIC_MATCH_FIELDS].sort());
      expect(rows[0]).toMatchObject({ tournament_id: 'tournament', player_1_name: 'Orbit', winner_name: 'Kite' });
      expect(rows[0].games.map(({ game_number }) => game_number)).toEqual([1, 2]);
    }
    expect(requests()).toHaveLength(2);
    for (const url of requests()) {
      expect(url.pathname).toBe('/rest/v1/matches');
      expect(url.searchParams.get('order')).toBe('created_at.desc');
      expect(url.searchParams.get('limit')).toBe('200');
      expect(url.searchParams.get('tournament.season_id')).toBeNull();
    }
  });

  it.each(['phase', 'frozen_phase'] as const)('uses verified owners and returns only public fields in %s', async (mode) => {
    fetchStub.mockImplementation(async (input) => {
      const url = new URL(String(input));
      const select = url.searchParams.get('select');
      if (url.pathname.endsWith('/phase_matches')) {
        expect(select).toContain('phase:league_phases!phase_matches_phase_id_fkey!inner(season_id)');
        expect(select).toContain('games:phase_games(');
        return json([native(3), native(4, earlier)]);
      }
      expect(select).toContain('tournament:tournaments!matches_tournament_id_fkey!inner(season_id)');
      expect(url.searchParams.get('tournament.season_id')).toBe('is.null');
      return json([legacy(2), legacy(3)]);
    });

    const rows = await listContentMatches(mode);
    expect(rows.map((row) => row.id)).toEqual([id(2), id(3), id(4)]);
    expect(rows[1]).toMatchObject({ phase_id: 'phase', season_id: 'league', status: 'completed', round_status: 'completed' });
    expect(Object.keys(rows[1]).sort()).toEqual(
      [...PUBLIC_MATCH_FIELDS.filter((field) => field !== 'tournament_id'), 'phase_id', 'season_id'].sort(),
    );
    expect(Object.keys(rows[1].games[0]).sort()).toEqual([...PUBLIC_GAME_FIELDS].sort());
    expect(JSON.stringify(rows)).not.toContain('private');
    expect(requests()).toHaveLength(2);
    for (const url of requests()) {
      expect(url.searchParams.get('order')).toBe('created_at.desc,id.asc');
      expect(url.searchParams.get('limit')).toBe('200');
      expect(url.searchParams.get('select')).not.toMatch(/\*|notes|overlay_key|submitter_id|confirm|finalized_at/);
    }
  });

  it('backfills the one global cap and does not expose a collision outside the native head', async () => {
    const nativeHead = Array.from({ length: 200 }, (_, i) => native(i + 1, old));
    const firstLegacyPage = Array.from({ length: 200 }, (_, i) => legacy(i + 1));
    firstLegacyPage[199] = legacy(201);
    fetchStub.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/phase_matches')) {
        const requestedIds = url.searchParams.get('id');
        if (!requestedIds) return json(nativeHead);
        return json(requestedIds.includes(id(201)) ? [{ id: id(201) }] : []);
      }
      if (url.searchParams.get('offset') === '200') return json([legacy(202, earlier)]);
      return json(firstLegacyPage);
    });

    const rows = await listContentMatches('phase');
    expect(rows).toHaveLength(200);
    expect(rows.slice(0, 3).map((row) => row.id)).toEqual([id(202), id(1), id(2)]);
    expect(rows.at(-1)?.id).toBe(id(199));
    expect(rows.some((row) => row.id === id(201))).toBe(false);
    expect(requests().filter((url) => url.searchParams.has('id')).map((url) => url.searchParams.get('id')))
      .toEqual([`in.(${id(201)})`, `in.(${id(202)})`]);
  });

  it.each(['matches', 'phase_matches'])('propagates a failed %s read, rather than falling back', async (table) => {
    fetchStub.mockImplementation(async (url) => new URL(String(url)).pathname.endsWith(`/${table}`)
      ? Response.json({ message: 'read failed' }, { status: 400 })
      : json([]));
    await expect(listContentMatches('phase')).rejects.toMatchObject({ message: 'read failed' });
  });
});
