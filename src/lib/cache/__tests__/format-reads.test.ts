/**
 * The cached format library reads: tags and TTLs, hits within the TTL, expiry through the library tag and the league
 * tag (and only those), and the shape of what is cached: the gallery shelf holds no owner and no draft and survives a
 * JSON round trip.
 *
 * `next/cache` is the in-memory fake; the query modules are mocked. No network, no Supabase.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', async () => (await import('./fake-next-cache')).fakeNextCache.module);

const GALLERY_ROWS = [
  {
    id: 'f1',
    slug: 'swiss-cup',
    name: { base: 'en', en: { v: 'Swiss Cup', s: 'human' } },
    description: null,
    kind: 'custom' as const,
    version_no: 2,
    content_hash: 'a'.repeat(64),
    updated_at: '2026-10-24T10:00:00Z',
  },
];

const SEASON_SUMMARY = {
  season_id: 'season-1',
  definition_id: 'f1',
  version_no: 2,
  spec_hash: 'a'.repeat(64),
  tunables: {},
  engine: 'kit' as const,
  frozen_at: '2026-10-24T10:00:00Z',
  amendments: [],
};

const queries = vi.hoisted(() => ({
  listGalleryDefinitions: vi.fn(),
  getSeasonFormatSummary: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/format-definitions', () => ({ listGalleryDefinitions: queries.listGalleryDefinitions }));
vi.mock('@/lib/supabase/queries/season-formats', () => ({ getSeasonFormatSummary: queries.getSeasonFormatSummary }));
// The route-handler helpers are not under test; the module only needs `publicTags` and `expire*` from here.
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));

import { fakeNextCache } from './fake-next-cache';
import { FORMAT_DETAIL_TTL_S, FORMAT_LIST_TTL_S, formatReads } from '../format-reads';
import { expireFormatLibraryReads, expireSeasonReads, publicTags } from '@/lib/revalidation';

beforeEach(() => {
  fakeNextCache.reset();
  queries.listGalleryDefinitions.mockReset().mockResolvedValue(GALLERY_ROWS);
  queries.getSeasonFormatSummary.mockReset().mockResolvedValue(SEASON_SUMMARY);
});

describe('tags and TTLs', () => {
  it('the gallery read is tagged format-library and revalidates every 60 s', async () => {
    await formatReads.gallery();
    expect(fakeNextCache.reads).toHaveLength(1);
    expect(fakeNextCache.reads[0]).toMatchObject({ tags: ['format-library'], revalidate: 60, hit: false });
    expect(FORMAT_LIST_TTL_S).toBe(60);
    expect(fakeNextCache.reads[0].keyParts.slice(0, 2)).toEqual(['format-read:v1', 'gallery']);
  });

  it('the league read is tagged with the league tag and revalidates every 30 s', async () => {
    await formatReads.seasonFormat('season-1');
    expect(fakeNextCache.reads[0]).toMatchObject({ tags: ['season:season-1'], revalidate: 30, hit: false });
    expect(FORMAT_DETAIL_TTL_S).toBe(30);
    expect(fakeNextCache.reads[0].keyParts.slice(0, 2)).toEqual(['format-read:v1', 'season-format']);
  });

  it('every read has at least one tag', async () => {
    await formatReads.gallery();
    await formatReads.seasonFormat('s');
    for (const read of fakeNextCache.reads) expect(read.tags.length).toBeGreaterThan(0);
  });
});

describe('hits and expiry', () => {
  it('a second call within the TTL is a hit and runs no query', async () => {
    await formatReads.gallery();
    await formatReads.gallery();
    expect(queries.listGalleryDefinitions).toHaveBeenCalledTimes(1);
    expect(fakeNextCache.reads.map((read) => read.hit)).toEqual([false, true]);

    await formatReads.seasonFormat('season-1');
    await formatReads.seasonFormat('season-1');
    expect(queries.getSeasonFormatSummary).toHaveBeenCalledTimes(1);
  });

  it('keeps one entry per league', async () => {
    await formatReads.seasonFormat('season-1');
    await formatReads.seasonFormat('season-2');
    expect(queries.getSeasonFormatSummary).toHaveBeenCalledTimes(2);
    expect(queries.getSeasonFormatSummary).toHaveBeenNthCalledWith(1, 'season-1');
    expect(queries.getSeasonFormatSummary).toHaveBeenNthCalledWith(2, 'season-2');
  });

  it('expireFormatLibraryReads drops the gallery entry and leaves the league entry', async () => {
    await formatReads.gallery();
    await formatReads.seasonFormat('season-1');
    fakeNextCache.reads.length = 0;

    expireFormatLibraryReads();
    expect(fakeNextCache.expiredTags.map((entry) => entry.tag)).toEqual([publicTags.formatLibrary]);

    await formatReads.gallery();
    await formatReads.seasonFormat('season-1');
    expect(fakeNextCache.reads.map((read) => read.hit)).toEqual([false, true]);
    expect(queries.listGalleryDefinitions).toHaveBeenCalledTimes(2);
    expect(queries.getSeasonFormatSummary).toHaveBeenCalledTimes(1);
  });

  it('expireSeasonReads (attach and detach) drops the league entry and leaves the gallery entry', async () => {
    await formatReads.gallery();
    await formatReads.seasonFormat('season-1');
    await formatReads.seasonFormat('season-2');
    fakeNextCache.reads.length = 0;

    expireSeasonReads('season-1', ['stage-1']);

    await formatReads.gallery();
    await formatReads.seasonFormat('season-1');
    await formatReads.seasonFormat('season-2');
    expect(fakeNextCache.reads.map((read) => read.hit)).toEqual([true, false, true]);
  });

  it('caches a league without an attached format as null', async () => {
    queries.getSeasonFormatSummary.mockResolvedValue(null);
    expect(await formatReads.seasonFormat('season-9')).toBeNull();
    expect(await formatReads.seasonFormat('season-9')).toBeNull();
    expect(queries.getSeasonFormatSummary).toHaveBeenCalledTimes(1);
  });
});

describe('what is cached', () => {
  it('the gallery value has no owner key and no draft, and survives a JSON round trip', async () => {
    const value = await formatReads.gallery();
    await formatReads.gallery();
    const stored = [...fakeNextCache.entries.values()].find((entry) => entry.tags.includes('format-library'));
    expect(stored).toBeDefined();
    expect(JSON.parse(stored!.body)).toEqual(value);
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
    const keys = new Set(Object.keys(value[0]));
    expect([...keys].sort()).toEqual(
      ['content_hash', 'description', 'id', 'kind', 'name', 'slug', 'updated_at', 'version_no'].sort(),
    );
    expect(stored!.body).not.toMatch(/owner|draft|current_draft|spec"/);
  });

  it('the league value has no spec and no seed', async () => {
    const value = await formatReads.seasonFormat('season-1');
    expect(value).not.toHaveProperty('spec');
    expect(value).not.toHaveProperty('seed');
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });
});
