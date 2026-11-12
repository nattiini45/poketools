/**
 * Query budget of the player dashboard (`/dashboard`).
 *
 * The page and the real query modules run against a counting fake of the service-role client: every
 * `supabase.from()` is one PostgREST request. The session and the shared standings cache are mocked. The "Now" queue
 * may add one read for every player (draft turns), one more for a player with an upcoming match (team slots) and one
 * wave of five for a player in a running custom league, whatever the number of leagues.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ calls: [] as string[], tables: {} as Record<string, Record<string, unknown>[]> }));

vi.mock('@/lib/supabase/client', () => {
  function builder(table: string) {
    let single = false;
    const run = () => {
      const rows = db.tables[table] ?? [];
      return single ? { data: rows[0] ?? null, error: null, count: rows.length } : { data: rows, error: null, count: rows.length };
    };
    const chain: Record<string, unknown> = {
      maybeSingle: () => {
        single = true;
        return proxy;
      },
      single: () => {
        single = true;
        return proxy;
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    // Any filter or modifier keeps the chain: the fake counts requests, it does not filter.
    const proxy: unknown = new Proxy(chain, { get: (target, key) => (key in target ? target[key as string] : () => proxy) });
    return proxy;
  }
  return {
    supabase: {
      from: (table: string) => {
        db.calls.push(table);
        return builder(table);
      },
    },
  };
});

vi.mock('@/lib/auth/redirect-to-sign-in', () => ({
  requireLiveIdentityOrSignIn: vi.fn(async () => ({ player: { playerId: '11111111-1111-4111-8111-111111111111', name: 'Misty', avatarUrl: null } })),
}));
vi.mock('@/lib/auth/helpers', () => ({ getSession: vi.fn(async () => null) }));
vi.mock('@/lib/cache/public-reads', () => ({ publicReads: { standingsPreview: vi.fn(async () => []) } }));

import DashboardPage from '../page';
import { getPlayerFormatFacts, listActiveDraftTurns, listPlayerTeamSlots } from '@/lib/supabase/queries/dashboard-now';

const NOW_TABLES = ['draft_slots', 'teams', 'season_formats', 'format_flags', 'format_action_submissions', 'format_relation_links', 'format_challenges'];

beforeEach(() => {
  db.calls.length = 0;
  db.tables = {};
});

describe('dashboard query budget', () => {
  it('a player without a league or a match costs 8 requests, one of them for the queue', async () => {
    await DashboardPage();
    expect(db.calls.filter((table) => NOW_TABLES.includes(table))).toEqual(['draft_slots']);
    expect(db.calls).toEqual(['players', 'matches', 'tournament_participants', 'season_participants', 'player_ratings', 'player_streaks', 'player_aggregates', 'draft_slots']);
  });

  it('the queue reads are one request for the draft turns, one for the team slots and five for the format facts', async () => {
    await listActiveDraftTurns('p1');
    await listPlayerTeamSlots('p1', ['t1', 't2', 't3']);
    await getPlayerFormatFacts('p1', ['s1', 's2', 's3'], new Date('2026-11-12T12:00:00.000Z'));
    expect(db.calls).toEqual(['draft_slots', 'teams', 'season_formats', 'format_flags', 'format_action_submissions', 'format_relation_links', 'format_challenges']);
  });

  it('no team or format request without an upcoming match or a running custom league', async () => {
    expect(await listPlayerTeamSlots('p1', [])).toEqual([]);
    expect((await getPlayerFormatFacts('p1', [], new Date())).formats).toEqual([]);
    expect(db.calls).toEqual([]);
  });
});
