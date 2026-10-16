import 'server-only';
import { cache } from 'react';
import { DEFAULT_CONTENT_LOCALE, type Locale } from './config';
import {
  getMatchSeasonLanguage,
  getSeasonLanguage,
  getTournamentSeasonLanguage,
} from '@/lib/supabase/queries/content-locale';
import { logger } from '@/lib/logger';

/**
 * The content language of viewerless text (i18n-core §6.1): Discord embeds,
 * social images/posts, stored AI reports, and OBS overlays opened without
 * `?lang=`. It follows the league (`seasons.language`), never the viewer's
 * cookie. Use it only on those paths: it is one narrow DB read, never cached
 * in `unstable_cache`, and never on a public page's default render path.
 */
export type ContentRef = {
  seasonId?: string | null;
  tournamentId?: string | null;
  matchId?: string | null;
};

/**
 * Keyed on primitives so React `cache()` can memoize within one server
 * request (an object argument would never hit). Outside a React request it
 * simply re-runs.
 */
const resolveCached = cache(
  async (seasonId: string | null, tournamentId: string | null, matchId: string | null): Promise<Locale> => {
    try {
      if (seasonId) {
        const l = await getSeasonLanguage(seasonId);
        if (l) return l;
      }
      if (tournamentId) {
        const l = await getTournamentSeasonLanguage(tournamentId);
        if (l) return l;
      }
      if (matchId) {
        const l = await getMatchSeasonLanguage(matchId);
        if (l) return l;
      }
    } catch (err) {
      // Viewerless text still goes out, in the default league language, rather
      // than being dropped because the language read failed.
      logger.warn('i18n', 'resolveContentLocale: language read failed; using default', describeError(err));
    }
    return DEFAULT_CONTENT_LOCALE;
  },
);

/**
 * Log fields for a thrown value. Supabase throws a `PostgrestError`, a plain
 * object (not an `Error`) whose `String()` is "[object Object]", so its
 * `message` and `code` are read directly.
 */
function describeError(err: unknown): { error: string; code?: string } {
  if (err instanceof Error) return { error: err.message };
  if (typeof err === 'object' && err !== null) {
    const { message, code } = err as { message?: unknown; code?: unknown };
    return {
      error: typeof message === 'string' ? message : 'unknown error',
      ...(typeof code === 'string' ? { code } : {}),
    };
  }
  return { error: String(err) };
}

/**
 * First non-null of season → tournament → match language, read lazily in that
 * order (a later ref is read only when the earlier ones yield nothing); else
 * `DEFAULT_CONTENT_LOCALE` (`'de'`). Empty strings count as absent.
 */
export const resolveContentLocale = (ref: ContentRef): Promise<Locale> =>
  resolveCached(ref.seasonId || null, ref.tournamentId || null, ref.matchId || null);
