import { supabase } from '../client';
import { isLocale, type Locale } from '@/i18n/config';

/**
 * Narrow reads of a league's content language (`seasons.language`,
 * i18n-core §6.1): the language of text produced without a viewer (Discord,
 * social, stored AI reports, overlays without `?lang=`). Each function reads
 * one column through at most two embeds and returns `null` when the row is
 * missing, the tournament/match has no season (standalone tournament), or the
 * stored value is not a supported locale. Callers resolve `null` to
 * `DEFAULT_CONTENT_LOCALE` via `resolveContentLocale` (`src/i18n/content-locale.ts`).
 *
 * Never wrap these in `unstable_cache`: they back viewerless side effects only,
 * not a public page's default render path.
 */

function toLocale(value: unknown): Locale | null {
  return isLocale(value) ? value : null;
}

/** `seasons.language` of one season. */
export async function getSeasonLanguage(seasonId: string): Promise<Locale | null> {
  const { data, error } = await supabase
    .from('seasons')
    .select('language')
    .eq('id', seasonId)
    .maybeSingle();

  if (error) throw error;
  return toLocale(data?.language);
}

/** The content language of a tournament's season; `null` for a standalone tournament. */
export async function getTournamentSeasonLanguage(tournamentId: string): Promise<Locale | null> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('seasons ( language )')
    .eq('id', tournamentId)
    .maybeSingle();

  if (error) throw error;
  return toLocale(data?.seasons?.language);
}

/** The content language of a match's tournament's season; `null` when there is none. */
export async function getMatchSeasonLanguage(matchId: string): Promise<Locale | null> {
  const { data, error } = await supabase
    .from('matches')
    .select('tournaments ( seasons ( language ) )')
    .eq('id', matchId)
    .maybeSingle();

  if (error) throw error;
  return toLocale(data?.tournaments?.seasons?.language);
}
