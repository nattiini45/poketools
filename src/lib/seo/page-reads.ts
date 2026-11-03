import { cache } from 'react';
import { publicReads } from '@/lib/cache/public-reads';

/**
 * The reads a detail page and its `generateMetadata` share. Next memoises `fetch` only, not Supabase client calls,
 * and `unstable_cache` does not dedupe two concurrent cold calls, so each page and its metadata go through one
 * React `cache()` entry per request: the metadata adds no query to the page's cold-cache budget.
 */
export const readLeague = cache((id: string) => publicReads.season(id));
export const readTournament = cache((id: string) => publicReads.tournament(id));
export const readPlayerProfile = cache((id: string) => publicReads.playerProfile(id));