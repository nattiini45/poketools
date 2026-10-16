import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Records every builder call per `from(table)` and resolves each query with
 * the next queued result. No network: the supabase client is fully mocked.
 */
const mock = vi.hoisted(() => {
  type Call = [method: string, args: unknown[]];
  const state = {
    queries: [] as Array<{ table: string; calls: Call[] }>,
    results: [] as Array<{ data: unknown; error: unknown }>,
  };

  function builder(entry: { table: string; calls: Call[] }): unknown {
    const proxy: unknown = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'then') {
          const result = state.results.shift() ?? { data: null, error: null };
          return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          entry.calls.push([String(prop), args]);
          return proxy;
        };
      },
    });
    return proxy;
  }

  const supabase = {
    from: (table: string) => {
      const entry = { table, calls: [] as Call[] };
      state.queries.push(entry);
      return builder(entry);
    },
  };

  return { state, supabase };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: mock.supabase }));

import {
  getCommunityAvatars,
  listGalleryItemsForThumbs,
  listPlayersNeedingAvatarThumb,
  swapPlayerAvatarUrl,
} from '../avatar-gallery';

const BASE = 'https://proj.supabase.co/storage/v1/object/public/avatars';

function galleryRow(id: string, imageUrl: string) {
  return {
    id,
    player_id: 'p-other',
    image_url: imageUrl,
    choices: { type: 'photo_transform' },
    style: 'pixel_sprite',
    created_at: '2026-09-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  mock.state.queries = [];
  mock.state.results = [];
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getCommunityAvatars', () => {
  it('matches thumbnail avatar_urls back to the gallery originals', async () => {
    mock.state.results.push(
      {
        data: [
          { id: 'p2', name: 'Bea', avatar_url: `${BASE}/gallery/p2/a.png.thumb.webp` },
          { id: 'p3', name: 'Cid', avatar_url: `${BASE}/gallery/p3/b.png` }, // not yet backfilled
        ],
        error: null,
      },
      {
        data: [
          galleryRow('g1', `${BASE}/gallery/p2/a.png`),
          galleryRow('g2', `${BASE}/gallery/p3/b.png`),
        ],
        error: null,
      },
    );

    const items = await getCommunityAvatars('p1');

    const [playersQuery, galleryQuery] = mock.state.queries;
    expect(playersQuery.calls).toContainEqual(['like', ['avatar_url', '%/gallery/%']]);
    expect(playersQuery.calls).toContainEqual(['neq', ['id', 'p1']]);
    expect(galleryQuery.calls).toContainEqual([
      'in',
      ['image_url', [`${BASE}/gallery/p2/a.png`, `${BASE}/gallery/p3/b.png`]],
    ]);
    expect(items.map((item) => [item.id, item.player_name])).toEqual([['g1', 'Bea'], ['g2', 'Cid']]);
  });

  it('returns [] without a second query when no player uses a gallery avatar', async () => {
    mock.state.results.push({ data: [], error: null });
    expect(await getCommunityAvatars('p1')).toEqual([]);
    expect(mock.state.queries).toHaveLength(1);
  });
});

describe('listPlayersNeedingAvatarThumb', () => {
  it('selects this project\'s bucket avatars that are not thumbnails yet, paged by id', async () => {
    mock.state.results.push({
      data: [
        { id: 'a', avatar_url: `${BASE}/gallery/p/a.png` },
        { id: 'b', avatar_url: null },
      ],
      error: null,
    });

    const rows = await listPlayersNeedingAvatarThumb({ limit: 5, afterId: 'cursor-id' });

    const [query] = mock.state.queries;
    expect(query.table).toBe('players');
    expect(query.calls).toEqual([
      ['select', ['id, avatar_url']],
      // Anchored at the project URL: a foreign URL that merely contains the
      // bucket path (e.g. a Showdown-prefixed one) cannot match.
      ['like', ['avatar_url', 'https://proj.supabase.co/storage/v1/object/public/avatars/%']],
      ['not', ['avatar_url', 'like', '%.thumb.webp']],
      ['gt', ['id', 'cursor-id']],
      ['order', ['id', { ascending: true }]],
      ['limit', [5]],
    ]);
    expect(rows).toEqual([{ id: 'a', avatar_url: `${BASE}/gallery/p/a.png` }]);
  });

  it('escapes LIKE wildcards in the project URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://my_host:54321/');
    mock.state.results.push({ data: [], error: null });

    await listPlayersNeedingAvatarThumb({ limit: 1 });

    expect(mock.state.queries[0].calls).toContainEqual(
      ['like', ['avatar_url', 'http://my\\_host:54321/storage/v1/object/public/avatars/%']],
    );
  });

  it('throws without querying when NEXT_PUBLIC_SUPABASE_URL is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');

    await expect(listPlayersNeedingAvatarThumb({ limit: 1 })).rejects.toThrow('NEXT_PUBLIC_SUPABASE_URL');
    expect(mock.state.queries).toHaveLength(0);
  });

  it('starts from the beginning without a cursor and rethrows query errors', async () => {
    const error = { message: 'boom' };
    mock.state.results.push({ data: null, error });

    await expect(listPlayersNeedingAvatarThumb({ limit: 10 })).rejects.toBe(error);
    expect(mock.state.queries[0].calls.some(([method]) => method === 'gt')).toBe(false);
  });
});

describe('listGalleryItemsForThumbs', () => {
  it('pages gallery rows by id with narrow columns', async () => {
    mock.state.results.push({ data: [{ id: 'g1', player_id: 'p', image_url: 'u' }], error: null });

    const rows = await listGalleryItemsForThumbs({ limit: 3, afterId: 'g0' });

    expect(mock.state.queries[0].table).toBe('ai_avatar_gallery');
    expect(mock.state.queries[0].calls).toEqual([
      ['select', ['id, player_id, image_url']],
      ['gt', ['id', 'g0']],
      ['order', ['id', { ascending: true }]],
      ['limit', [3]],
    ]);
    expect(rows).toEqual([{ id: 'g1', player_id: 'p', image_url: 'u' }]);
  });
});

describe('swapPlayerAvatarUrl', () => {
  it('updates only while avatar_url still holds the old value', async () => {
    mock.state.results.push({ data: [{ id: 'p1' }], error: null });

    const swapped = await swapPlayerAvatarUrl('p1', 'old-url', 'new-url');

    expect(swapped).toBe(true);
    expect(mock.state.queries[0].calls).toEqual([
      ['update', [{ avatar_url: 'new-url' }]],
      ['eq', ['id', 'p1']],
      ['eq', ['avatar_url', 'old-url']],
      ['select', ['id']],
    ]);
  });

  it('returns false when no row matched (the avatar changed meanwhile)', async () => {
    mock.state.results.push({ data: [], error: null });
    expect(await swapPlayerAvatarUrl('p1', 'old-url', 'new-url')).toBe(false);
  });
});
