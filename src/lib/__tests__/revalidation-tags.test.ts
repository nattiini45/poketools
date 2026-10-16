/**
 * D36 fix 5 acceptance, write side: every write path that calls
 * `revalidatePath` (through `src/lib/revalidation.ts` and
 * `src/lib/match/aggregate-rebuild.ts`) also expires the matching public
 * read-cache tags, immediately, before it moves to the next path.
 *
 * Two proofs: a source walk (no bare `revalidatePath` outside the two tag-aware
 * helpers) and a behavioural walk (run every write path and check the call
 * log). `src/lib/cache/__tests__/public-reads.test.ts` closes the loop from the
 * read side (each cached read is expired by a match write), and
 * `write-route-tags.test.ts` covers the tournament, league and draft write
 * routes, which revalidate no path and expire their tags directly.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type CacheCall =
  | { kind: 'path'; path: string; type?: 'layout' | 'page' }
  | { kind: 'tag'; tag: string; profile: unknown };

const log = vi.hoisted(() => ({ calls: [] as CacheCall[] }));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn((p: string, type?: 'layout' | 'page') => {
    log.calls.push(type ? { kind: 'path', path: p, type } : { kind: 'path', path: p });
  }),
  revalidateTag: vi.fn((tag: string, profile: unknown) => {
    log.calls.push({ kind: 'tag', tag, profile });
  }),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/aggregates', () => ({
  clearAggregatesForScope: vi.fn(async () => ({ aggregatesDeleted: 0, playerAggregatesDeleted: 0 })),
  updateAggregatesForScope: vi.fn(async () => undefined),
}));
vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsByGame: vi.fn(async () => [{ id: 'bs-1' }]),
  listGamesForAggregateRebuild: vi.fn(),
}));
vi.mock('@/lib/match/aggregate-queue', () => ({
  getAggregateJobStats: vi.fn(),
  processAggregateJobs: vi.fn(),
}));

import {
  EXPIRE_NOW,
  publicTags,
  revalidateMatchPages,
  revalidatePublicPath,
  tagsForPath,
} from '../revalidation';
import { rebuildAggregatesForScope } from '../match/aggregate-rebuild';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { listGamesForAggregateRebuild } from '@/lib/supabase/queries/games';

/**
 * Paths the write paths revalidate that no cached public read backs: pages
 * rendered without the read cache. A new path must either map to tags in
 * `tagsForPath` or be added here on purpose.
 */
const NO_CACHED_READ_PATHS = [/^\/teams$/, /^\/teams\/library$/, /^\/admin\/matches(\/[^/]+)?$/];

/**
 * The property under test, on one call log: each `revalidatePath(path)` is
 * followed — before the next `revalidatePath` — by the expiry of every tag
 * `tagsForPath(path)` names (or that tag was already expired earlier in the
 * same log), and every expiry is immediate.
 */
function expectEveryPathPairedWithItsTags(calls: CacheCall[]): void {
  const pathIndexes = calls.flatMap((c, i) => (c.kind === 'path' ? [i] : []));
  expect(pathIndexes.length).toBeGreaterThan(0);

  pathIndexes.forEach((index, n) => {
    const call = calls[index] as Extract<CacheCall, { kind: 'path' }>;
    const tags = tagsForPath(call.path);
    if (tags.length === 0) {
      expect(
        NO_CACHED_READ_PATHS.some((re) => re.test(call.path)),
        `${call.path} maps to no cache tag and is not listed as uncached`,
      ).toBe(true);
      return;
    }
    const until = pathIndexes[n + 1] ?? calls.length;
    const expiredSoFar = new Set(
      calls.slice(0, until).flatMap((c) => (c.kind === 'tag' ? [c.tag] : [])),
    );
    for (const tag of tags) {
      expect(expiredSoFar.has(tag), `${call.path} → ${tag} expired before the next path`).toBe(true);
    }
  });

  for (const c of calls) {
    if (c.kind === 'tag') expect(c.profile).toEqual(EXPIRE_NOW);
  }
}

function tagsIn(calls: CacheCall[]): string[] {
  return calls.flatMap((c) => (c.kind === 'tag' ? [c.tag] : []));
}

beforeEach(() => {
  log.calls.length = 0;
  vi.clearAllMocks();
});

describe('source walk: no bare revalidatePath', () => {
  const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

  /** Top-level function blocks of a module: name → body. */
  function functionBlocks(source: string): Map<string, string> {
    const blocks = new Map<string, string>();
    const starts = [...source.matchAll(/^(?:export )?(?:async )?function (\w+)/gm)];
    starts.forEach((match, i) => {
      const end = starts[i + 1]?.index ?? source.length;
      blocks.set(match[1], source.slice(match.index, end));
    });
    return blocks;
  }

  it('revalidation.ts calls revalidatePath only inside the two tag-aware helpers, each of which expires tags', () => {
    const blocks = functionBlocks(read('revalidation.ts'));
    const callers = [...blocks].filter(([, body]) => /\brevalidatePath\(/.test(body)).map(([name]) => name);

    expect(callers.sort()).toEqual(['publicRevalidationPass', 'revalidatePublicPath']);
    for (const name of callers) {
      expect(blocks.get(name)).toMatch(/\bexpire(PublicTags)?\(tagsForPath\(path\)\)/);
    }
    expect(blocks.get('revalidateMatchPages')).toMatch(/pass\.path\(/);
  });

  it('aggregate-rebuild.ts never imports or calls revalidatePath directly', () => {
    const source = read('match/aggregate-rebuild.ts');

    expect(source).not.toMatch(/import\s*\{[^}]*\brevalidatePath\b[^}]*\}\s*from 'next\/cache'/);
    expect(source).not.toMatch(/(?<![.\w])revalidatePath\(/);
    expect(source).toMatch(/revalidatePublicPath\(/);
  });
});

describe('tagsForPath', () => {
  it.each([
    ['/', ['seasons', 'tournaments']],
    ['/leagues', ['seasons']],
    ['/tournaments', ['tournaments']],
    ['/insights', ['ratings', 'aggregates:all_time']],
    ['/leaderboard', ['ratings', 'aggregates:all_time']],
    ['/pokemon', ['aggregates:all_time']],
    ['/players', ['players']],
    ['/players/p1', ['player:p1']],
    ['/leagues/s1', ['season:s1']],
    ['/leagues/s1/stats', ['season:s1', 'aggregates:league:s1']],
    ['/leagues/s1/teams', ['season:s1']],
    ['/leagues/s1/matchup', ['season:s1']],
    ['/tournaments/t1', ['tournament:t1']],
    ['/tournaments/t1/stats', ['tournament:t1', 'aggregates:tournament:t1']],
    ['/teams', []],
    ['/teams/library', []],
    ['/admin/matches', []],
    ['/admin/matches/m1', []],
    ['/leagues/s1/draft', []],
  ])('%s → %j', (p, tags) => {
    expect(tagsForPath(p)).toEqual(tags);
  });

  it('uses the tag builders the read cache uses', () => {
    expect(tagsForPath('/leagues/s1/stats')).toEqual([
      publicTags.season('s1'),
      publicTags.aggregates('league', 's1'),
    ]);
    expect(tagsForPath('/tournaments/t1/stats')).toEqual([
      publicTags.tournament('t1'),
      publicTags.aggregates('tournament', 't1'),
    ]);
  });
});

describe('write path: revalidateMatchPages', () => {
  it('league stage match: every revalidated path is paired with its tags', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ id: 't1', season_id: 's1' } as never);

    await revalidateMatchPages('t1', 'm1');

    expectEveryPathPairedWithItsTags(log.calls);
    expect(new Set(tagsIn(log.calls))).toEqual(
      new Set([
        'tournament:t1',
        'aggregates:tournament:t1',
        'tournaments',
        'season:s1',
        'aggregates:league:s1',
        'seasons',
        'ratings',
        'aggregates:all_time',
        'player-profiles',
      ]),
    );
  });

  it('standalone tournament: no league tag, still paired', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ id: 't1', season_id: null } as never);

    await revalidateMatchPages('t1');

    expectEveryPathPairedWithItsTags(log.calls);
    expect(tagsIn(log.calls).filter((t) => t.includes('season') || t.includes('league'))).toEqual(['seasons']);
  });

  it('each tag is expired once per pass', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ id: 't1', season_id: 's1' } as never);

    await revalidateMatchPages('t1', 'm1');

    const tags = tagsIn(log.calls);
    expect(tags).toHaveLength(new Set(tags).size);
  });

  it('keeps every path it revalidated before (pages and tags are invalidated together)', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ id: 't1', season_id: 's1' } as never);

    await revalidateMatchPages('t1', 'm1');

    const paths = log.calls.flatMap((c) => (c.kind === 'path' ? [c.path] : []));
    expect(paths).toEqual([
      '/tournaments/t1',
      '/tournaments/t1/stats',
      '/tournaments',
      '/teams',
      '/teams/library',
      '/leagues/s1',
      '/leagues/s1/stats',
      '/leagues/s1/teams',
      '/leagues/s1/matchup',
      '/leagues',
      '/admin/matches',
      '/admin/matches/m1',
      '/insights',
      '/leaderboard',
      '/pokemon',
      '/',
    ]);
    expect(log.calls).toContainEqual({ kind: 'path', path: '/pokemon', type: 'layout' });
  });
});

describe('write path: revalidatePublicPath', () => {
  it('revalidates the path, then expires its tags', () => {
    revalidatePublicPath('/leagues/s9/stats');

    expect(log.calls).toEqual([
      { kind: 'path', path: '/leagues/s9/stats' },
      { kind: 'tag', tag: 'season:s9', profile: EXPIRE_NOW },
      { kind: 'tag', tag: 'aggregates:league:s9', profile: EXPIRE_NOW },
    ]);
  });
});

describe('write path: rebuildAggregatesForScope', () => {
  beforeEach(() => {
    vi.mocked(getTournamentById).mockResolvedValue({ id: 't1', season_id: 's1' } as never);
    vi.mocked(listGamesForAggregateRebuild)
      .mockResolvedValueOnce([
        { game_id: 'g1', tournament_id: 't1', season_id: 's1', exclude_all_time: false },
      ] as never)
      .mockResolvedValue([] as never);
  });

  it.each([
    ['tournament', 't1'],
    ['league', 's1'],
    ['all_time', null],
  ] as const)('%s rebuild: every revalidated path is paired with its tags', async (scopeType, scopeId) => {
    await rebuildAggregatesForScope(scopeType, scopeId);

    expectEveryPathPairedWithItsTags(log.calls);
  });

  it('league rebuild expires the league scope tags', async () => {
    await rebuildAggregatesForScope('league', 's1');

    expect(tagsIn(log.calls)).toEqual(
      expect.arrayContaining(['season:s1', 'aggregates:league:s1', 'seasons']),
    );
  });

  it('all-time rebuild expires the all-time and leaderboard tags', async () => {
    await rebuildAggregatesForScope('all_time', null);

    expect(tagsIn(log.calls)).toEqual(
      expect.arrayContaining(['aggregates:all_time', 'ratings', 'seasons', 'tournaments']),
    );
  });
});
