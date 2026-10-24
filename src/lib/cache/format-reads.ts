import 'server-only';

import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { publicTags } from '@/lib/revalidation';
import { listGalleryDefinitions } from '@/lib/supabase/queries/format-definitions';
import { getSeasonFormatSummary } from '@/lib/supabase/queries/season-formats';
import type { FormatGalleryItem, SeasonFormatSummary } from '@/lib/format-studio/library-types';

/**
 * Cached reads of the format library, kept apart from `public-reads.ts` (whose test requires a sample for every
 * key it exports, and which pulls in every query module). Same rules as there:
 *
 * - PUBLIC: no session, nothing about the viewer; one entry serves every caller.
 * - TAGGED: `publicTags.formatLibrary` for the gallery (every library write route expires it through
 *   `expireFormatLibraryReads`), the league's tag for a league's attached format (attach and detach expire it through
 *   `expireSeasonReads`).
 * - JSON only: a hit is `JSON.parse`d, so no `Map`, `Set` or `Date`, no `t()` and no locale in a value.
 * - Public shapes only: the gallery shelf holds no owner id, no draft and no spec; the league read is the summary
 *   (no spec, no seed).
 *
 * `formatReads.seasonFormat` has no public consumer yet: it exists so the league tag is the one attach and detach
 * already expire. Remove it if nothing reads it.
 */

/** TTL of the gallery shelf (a list). */
export const FORMAT_LIST_TTL_S = 60;
/** TTL of one league's attached format. */
export const FORMAT_DETAIL_TTL_S = 30;

const KEY_PREFIX = 'format-read:v1';

interface ReadSpec {
  /** Unique read name; the first part of the cache key. */
  name: string;
  /** Everything besides the name that identifies the result (ids, limits). */
  key: readonly (string | number | null)[];
  /** At least one tag, so a write path can expire the entry. */
  tags: readonly string[];
  /** Seconds before the entry is refreshed. */
  ttl: number;
}

function cachedRead<T>(spec: ReadSpec, read: () => Promise<T>): Promise<T> {
  if (spec.tags.length === 0) {
    throw new Error(`[format-reads] ${spec.name}: a cached read needs at least one tag`);
  }
  return unstable_cache(read, [KEY_PREFIX, spec.name, JSON.stringify(spec.key)], {
    tags: [...spec.tags],
    revalidate: spec.ttl,
  })();
}

const gallery = cache(
  (): Promise<FormatGalleryItem[]> =>
    cachedRead(
      { name: 'gallery', key: [], tags: [publicTags.formatLibrary], ttl: FORMAT_LIST_TTL_S },
      () => listGalleryDefinitions(),
    ),
);

const seasonFormat = cache(
  (seasonId: string): Promise<SeasonFormatSummary | null> =>
    cachedRead(
      { name: 'season-format', key: [seasonId], tags: [publicTags.season(seasonId)], ttl: FORMAT_DETAIL_TTL_S },
      () => getSeasonFormatSummary(seasonId),
    ),
);

export const formatReads = { gallery, seasonFormat } as const;
