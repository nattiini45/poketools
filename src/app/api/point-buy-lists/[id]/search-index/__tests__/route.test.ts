import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '@/lib/draft/__tests__/fixtures/example-list.json';
import { makeParams, makeRequest } from '@/lib/__tests__/helpers/api-request';
import { makePlayer, MockAuthError } from '@/lib/__tests__/helpers/auth-mock';
import type { PointBuyListEntry } from '@/types/point-buy';

vi.mock('@/lib/auth/helpers', () => ({
  getLiveAccess: vi.fn(),
  AuthError: MockAuthError,
}));

vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({
  getListEntries: vi.fn(),
  isVersionBoundToAnySeason: vi.fn(),
}));

import { GET } from '../route';
import { getLiveAccess } from '@/lib/auth/helpers';
import { getListEntries, isVersionBoundToAnySeason } from '@/lib/supabase/queries/point-buy-lists';
import { hashCatalog } from '@/lib/draft-finder/line-catalog';
import { INDEX_SCHEMA_VERSION, type DraftSearchIndex } from '@/lib/draft-finder/index-types';

const V = String(INDEX_SCHEMA_VERSION);

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function entriesFor(listId: string, lineIds?: readonly string[]): PointBuyListEntry[] {
  return fixture.entries
    .filter((e) => !lineIds || lineIds.includes(e.line_id))
    .map((e) => ({
      ...e,
      id: `entry-${e.line_number}`,
      list_version_id: listId,
      price_group: e.price_group as PointBuyListEntry['price_group'],
    }));
}

const SMALL = ['gastly--gengar', 'eevee--vaporeon', 'eevee--jolteon'];

async function call(id: string, query: Record<string, string>) {
  const res = await GET(makeRequest(undefined, query), { params: makeParams({ id }) });
  return { res, json: await res.json() };
}

const admin = { player: makePlayer({ isAdmin: true }), isSiteAdmin: true, isAnyAdmin: true, isCreator: true };
const nonAdmin = { player: makePlayer(), isSiteAdmin: false, isAnyAdmin: false, isCreator: false };

describe('GET /api/point-buy-lists/[id]/search-index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isVersionBoundToAnySeason).mockResolvedValue(true);
    vi.mocked(getLiveAccess).mockResolvedValue(null);
  });

  it.each(['not-a-uuid', `${uuid(1)}x`, "1' OR '1'='1"])(
    '404 INVALID_POINT_BUY_LIST_ID for the malformed id %j, before the query-string checks and any query',
    async (id) => {
      // No `v`: the id guard answers first, so a bad id never reads as a validation failure.
      const { res, json } = await call(id, {});
      expect(res.status).toBe(404);
      expect(json).toEqual({ success: false, error: 'Point-buy list not found', code: 'INVALID_POINT_BUY_LIST_ID' });
      expect(isVersionBoundToAnySeason).not.toHaveBeenCalled();
      expect(getListEntries).not.toHaveBeenCalled();
      expect(getLiveAccess).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a missing version', uuid(1), {}],
    ['the old version 1', uuid(1), { v: '1' }],
    ['a malformed hash', uuid(1), { v: V, h: 'XYZ' }],
  ])('400 validation_failed on %s', async (_label, id, query) => {
    const { res, json } = await call(id, query);
    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(json.error).toBe(`Validation failed: ${json.params.issues}`);
    expect(isVersionBoundToAnySeason).not.toHaveBeenCalled();
    expect(getListEntries).not.toHaveBeenCalled();
  });

  it('404 LIST_NOT_FOUND for a version bound to no season, for anonymous and non-admin callers', async () => {
    vi.mocked(isVersionBoundToAnySeason).mockResolvedValue(false);
    for (const access of [null, nonAdmin]) {
      vi.mocked(getLiveAccess).mockResolvedValue(access);
      const { res, json } = await call(uuid(2), { v: V });
      expect(res.status).toBe(404);
      expect(json).toMatchObject({ success: false, code: 'LIST_NOT_FOUND', error: 'Point-buy list not found.' });
    }
    expect(getListEntries).not.toHaveBeenCalled();
  });

  it('200 with private, no-store for an unbound version as an admin', async () => {
    vi.mocked(isVersionBoundToAnySeason).mockResolvedValue(false);
    vi.mocked(getLiveAccess).mockResolvedValue(admin);
    const entries = entriesFor(uuid(3), SMALL);
    vi.mocked(getListEntries).mockResolvedValue(entries);
    const { res, json } = await call(uuid(3), { v: V, h: hashCatalog(entries) });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(json.data.lines.map((l: { lineId: string }) => l.lineId)).toEqual(SMALL);
  }, 60_000);

  it('404 on an empty list', async () => {
    vi.mocked(getListEntries).mockResolvedValue([]);
    const { res, json } = await call(uuid(4), { v: V });
    expect(res.status).toBe(404);
    expect(json.code).toBe('LIST_NOT_FOUND');
  });

  it('a bound version with the current hash is public and immutable; the bound check skips the auth read', async () => {
    const entries = entriesFor(uuid(5), SMALL);
    vi.mocked(getListEntries).mockResolvedValue(entries);
    const { res, json } = await call(uuid(5), { v: V, h: hashCatalog(entries) });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(json.success).toBe(true);
    expect(json.data).toMatchObject({ v: INDEX_SCHEMA_VERSION, listVersionId: uuid(5) });
    expect(getLiveAccess).not.toHaveBeenCalled();
  }, 60_000);

  it('a changed price or species id changes the hash and the served index; a stale hash is never cached', async () => {
    const id = uuid(6);
    const before = entriesFor(id, SMALL);
    vi.mocked(getListEntries).mockResolvedValue(before);
    const first = await call(id, { v: V, h: hashCatalog(before) });
    const gastlyPrice = before.find((e) => e.line_id === 'gastly--gengar')?.price ?? 0;
    expect(first.json.data.lines[0].price).toBe(gastlyPrice);

    const repriced = before.map((e) => (e.line_id === 'gastly--gengar' ? { ...e, price: gastlyPrice + 1 } : e));
    expect(hashCatalog(repriced)).not.toBe(hashCatalog(before));
    vi.mocked(getListEntries).mockResolvedValue(repriced);
    const stale = await call(id, { v: V, h: hashCatalog(before) });
    expect(stale.json.data.lines[0].price).toBe(gastlyPrice + 1);
    expect(stale.res.headers.get('Cache-Control')).toBe('private, no-store');

    const respecies = before.map((e) =>
      e.line_id === 'gastly--gengar' && e.species_ids ? { ...e, species_ids: { ...e.species_ids, stage2: 'gengar' } } : e,
    );
    expect(hashCatalog(respecies)).not.toBe(hashCatalog(before));
  }, 60_000);

  it('fails safe through safeErrorResponse', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getListEntries).mockRejectedValue(new Error('db down: secret detail'));
    const { res, json } = await call(uuid(7), { v: V });
    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to build the search index');
    expect(JSON.stringify(json)).not.toContain('secret');
    error.mockRestore();
  });

  it('stays within the size budget for the example list (≤ 160 KB raw, ≤ 42 KB gzip)', async () => {
    const entries = entriesFor(uuid(8));
    expect(entries).toHaveLength(fixture.entries.length);
    vi.mocked(getListEntries).mockResolvedValue(entries);
    const { res, json } = await call(uuid(8), { v: V, h: hashCatalog(entries) });
    expect(res.status).toBe(200);
    const index = json.data as DraftSearchIndex;
    expect(index.lines).toHaveLength(fixture.entries.length);
    const raw = Buffer.byteLength(JSON.stringify(json));
    const gzip = gzipSync(JSON.stringify(json)).byteLength;
    expect(raw).toBeLessThanOrEqual(160 * 1024);
    expect(gzip).toBeLessThanOrEqual(42 * 1024);
  }, 120_000);
});
