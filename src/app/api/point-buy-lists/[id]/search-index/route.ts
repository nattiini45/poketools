import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { getLiveAccess } from '@/lib/auth/helpers';
import { draftErrorMessage } from '@/lib/draft/errors';
import { buildDraftSearchIndex } from '@/lib/draft-finder/build-index.server';
import { INDEX_SCHEMA_VERSION, type DraftSearchIndex } from '@/lib/draft-finder/index-types';
import { hashCatalog } from '@/lib/draft-finder/line-catalog';
import { getListEntries, isVersionBoundToAnySeason } from '@/lib/supabase/queries/point-buy-lists';
import type { ApiResult } from '@/types/api';
import type { PointBuyListEntry } from '@/types/point-buy';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const HASH_PATTERN = /^[0-9a-f]{8}$/;

const PUBLIC_IMMUTABLE = 'public, max-age=31536000, immutable';
const PRIVATE_NO_STORE = 'private, no-store';

/** In-process memo of built indexes, keyed `${versionId}:${catalogHash}`. */
const MEMO_LIMIT = 8;
const memo = new Map<string, Promise<DraftSearchIndex>>();

function memoisedIndex(versionId: string, hash: string, entries: readonly PointBuyListEntry[]): Promise<DraftSearchIndex> {
  const key = `${versionId}:${hash}`;
  const hit = memo.get(key);
  if (hit) {
    // Refresh recency (Map keeps insertion order: the first key is the least recently used).
    memo.delete(key);
    memo.set(key, hit);
    return hit;
  }
  const built = buildDraftSearchIndex(versionId, entries).then((r) => r.index);
  memo.set(key, built);
  // A failed build is not remembered.
  built.catch(() => memo.delete(key));
  while (memo.size > MEMO_LIMIT) {
    const oldest = memo.keys().next().value;
    if (oldest === undefined) break;
    memo.delete(oldest);
  }
  return built;
}

function listNotFound(): NextResponse<ApiResult<never>> {
  return NextResponse.json<ApiResult<never>>(
    { success: false, error: draftErrorMessage('LIST_NOT_FOUND'), code: 'LIST_NOT_FOUND' },
    { status: 404 },
  );
}

/**
 * GET /api/point-buy-lists/[id]/search-index?v=<INDEX_SCHEMA_VERSION>&h=<catalogHash>
 * The draft finder's search index of one list version.
 *
 * Public: no auth required, for list versions bound to at least one season (list data is already public on
 * league pages). A version bound to no season answers 404 unless the live caller is an admin, who gets it
 * with `private, no-store`. The `public, immutable` answer is sent only when `h` equals the current catalog
 * hash, so a stale or missing cache buster never pins content under its URL.
 */
// Public: no auth required
export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse<ApiResult<DraftSearchIndex>>> {
  try {
    const { id } = await params;
    // A malformed id names no list: 404 before the query-string checks and any query (code review M6).
    const invalidId = rejectInvalidPathId(id, 'INVALID_POINT_BUY_LIST_ID');
    if (invalidId) return invalidId;
    const v = request.nextUrl.searchParams.get('v');
    const h = request.nextUrl.searchParams.get('h');

    const problems: string[] = [];
    if (v !== String(INDEX_SCHEMA_VERSION)) problems.push(`v must be ${INDEX_SCHEMA_VERSION}`);
    if (h !== null && !HASH_PATTERN.test(h)) problems.push('h must be 8 lowercase hex digits');
    if (problems.length > 0) {
      const issues = problems.join(', ');
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: `Validation failed: ${issues}`, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    // Bound check before the memo: an unbound version is never served to non-admins, even when memoised.
    const bound = await isVersionBoundToAnySeason(id);
    if (!bound) {
      const access = await getLiveAccess();
      if (!access?.isAnyAdmin) return listNotFound();
    }

    const entries = await getListEntries(id);
    if (entries.length === 0) return listNotFound();

    const hash = hashCatalog(entries);
    const index = await memoisedIndex(id, hash, entries);

    const res = NextResponse.json<ApiResult<DraftSearchIndex>>({ success: true, data: index });
    res.headers.set('Cache-Control', bound && h === hash ? PUBLIC_IMMUTABLE : PRIVATE_NO_STORE);
    return res;
  } catch (err) {
    return safeErrorResponse(err, 'Failed to build the search index');
  }
}
