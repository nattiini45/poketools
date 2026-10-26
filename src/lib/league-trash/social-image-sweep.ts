/**
 * Removes the social-image objects of the matches of a league that left the trash for good (decision D6).
 *
 * The expiry deletes the league's rows, and with them the `matches.social_image_url` values that name the uploaded
 * cards in the `social-images` bucket, so the objects are found by the match id instead: every card of a match is
 * `matches/<matchId>/<uuid>.png` (or the legacy `matches/<matchId>.png`). Paths are built only from match ids that
 * the path helpers accept (lowercase uuids) and from listed names that pass `isSocialImageObjectName` (the
 * service-role storage client puts a path into the request unencoded, see the Never Do list in AGENTS.md).
 *
 * A sweep never undoes or fails the expiry: every failure is counted, logged with one of
 * `LEAGUE_TRASH_SWEEP_ERROR_CODES` and reported in the result. The run stops starting new work at `deadline`
 * (epoch milliseconds); the matches it did not reach are counted in `unswept` and their objects stay in the bucket.
 * Server only.
 */
import 'server-only';

import { supabase } from '@/lib/supabase/client';
import {
  SOCIAL_IMAGE_BUCKET,
  isSocialImageObjectName,
  legacySocialImagePath,
  socialImageFolder,
} from '@/lib/match/social-image-path';

/** The log codes of the sweep, one per cause. */
export const LEAGUE_TRASH_SWEEP_ERROR_CODES = {
  list: 'league_trash_social_sweep_list_failed',
  remove: 'league_trash_social_sweep_remove_failed',
  incomplete: 'league_trash_social_sweep_incomplete',
} as const;

export type LeagueTrashSweepErrorCode =
  (typeof LEAGUE_TRASH_SWEEP_ERROR_CODES)[keyof typeof LEAGUE_TRASH_SWEEP_ERROR_CODES];

export interface SocialImageSweepResult {
  /** Matches whose folder was listed. */
  swept: number;
  /** Matches the deadline kept the sweep from reaching. */
  unswept: number;
  /** Objects the bucket confirmed removed. */
  removed: number;
  /** Distinct causes that occurred (empty when everything worked). */
  errors: LeagueTrashSweepErrorCode[];
}

/** Matches listed in parallel. */
const CONCURRENCY = 10;

/** Objects one list call returns at most (a match has a handful of cards). */
const LIST_LIMIT = 1000;

/** Where the cards of one match live: its folder and the legacy fixed name. */
interface MatchTarget {
  id: string;
  folder: string;
  legacy: string;
}

/** The target of a match id, or null when the id is not a lowercase uuid (the path helpers decide that). */
function targetOf(matchId: string): MatchTarget | null {
  const folder = socialImageFolder(matchId);
  const legacy = legacySocialImagePath(matchId);
  return folder && legacy ? { id: matchId, folder, legacy } : null;
}

async function pathsOfMatch({ folder, legacy }: MatchTarget): Promise<string[]> {
  const { data, error } = await supabase.storage.from(SOCIAL_IMAGE_BUCKET).list(folder, { limit: LIST_LIMIT });
  if (error) throw error;
  const names = (data ?? []).map((object) => object.name).filter(isSocialImageObjectName);
  return [legacy, ...names.map((name) => `${folder}/${name}`)];
}

/** Removes the cards of `matchIds` from the bucket; never throws. */
export async function sweepLeagueSocialImages(
  matchIds: readonly string[],
  deadline: number,
): Promise<SocialImageSweepResult> {
  const targets = [...new Set(matchIds.map((id) => id.toLowerCase()))].flatMap((id) => targetOf(id) ?? []);
  const result: SocialImageSweepResult = { swept: 0, unswept: 0, removed: 0, errors: [] };
  const note = (code: LeagueTrashSweepErrorCode) => {
    if (!result.errors.includes(code)) result.errors.push(code);
  };
  const bucket = supabase.storage.from(SOCIAL_IMAGE_BUCKET);

  for (let at = 0; at < targets.length; at += CONCURRENCY) {
    if (Date.now() >= deadline) {
      result.unswept = targets.length - at;
      note(LEAGUE_TRASH_SWEEP_ERROR_CODES.incomplete);
      console.error(`[league-trash] ${LEAGUE_TRASH_SWEEP_ERROR_CODES.incomplete}: ${result.unswept} matches not swept`);
      break;
    }
    const chunk = targets.slice(at, at + CONCURRENCY);
    const listed = await Promise.allSettled(chunk.map(pathsOfMatch));
    const paths: string[] = [];
    listed.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        result.swept += 1;
        paths.push(...outcome.value);
      } else {
        note(LEAGUE_TRASH_SWEEP_ERROR_CODES.list);
        console.error(`[league-trash] ${LEAGUE_TRASH_SWEEP_ERROR_CODES.list}: match ${chunk[i].id}`, outcome.reason);
      }
    });
    if (paths.length === 0) continue;
    try {
      const { data, error } = await bucket.remove(paths);
      if (error) throw error;
      result.removed += data?.length ?? 0;
    } catch (err) {
      note(LEAGUE_TRASH_SWEEP_ERROR_CODES.remove);
      console.error(`[league-trash] ${LEAGUE_TRASH_SWEEP_ERROR_CODES.remove}: ${paths.length} objects`, err);
    }
  }
  return result;
}
