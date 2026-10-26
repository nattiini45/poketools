/**
 * Removes the social-image objects of the matches of a league that left the trash for good (decision D6).
 *
 * The expiry deletes the league's rows, and with them the `matches.social_image_url` values that name the uploaded
 * cards in the `social-images` bucket, so the objects are found by the match id instead: every card of a match is
 * `matches/<matchId>/<uuid>.png` (or the legacy `matches/<matchId>.png`). Paths are built only from match ids that
 * pass the uuid check and from listed names that pass `isSocialImageObjectName` (the service-role storage client puts
 * a path into the request unencoded, see the Never Do list in AGENTS.md).
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
} from '@/app/api/matches/[id]/social-image/storage-path';

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function pathsOfMatch(matchId: string): Promise<string[]> {
  const folder = socialImageFolder(matchId);
  const legacy = legacySocialImagePath(matchId);
  if (!folder || !legacy) return [];
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
  const ids = [...new Set(matchIds.map((id) => id.toLowerCase()).filter((id) => UUID_RE.test(id)))];
  const result: SocialImageSweepResult = { swept: 0, unswept: 0, removed: 0, errors: [] };
  const note = (code: LeagueTrashSweepErrorCode) => {
    if (!result.errors.includes(code)) result.errors.push(code);
  };
  const bucket = supabase.storage.from(SOCIAL_IMAGE_BUCKET);

  for (let at = 0; at < ids.length; at += CONCURRENCY) {
    if (Date.now() >= deadline) {
      result.unswept = ids.length - at;
      note(LEAGUE_TRASH_SWEEP_ERROR_CODES.incomplete);
      console.error(`[league-trash] ${LEAGUE_TRASH_SWEEP_ERROR_CODES.incomplete}: ${result.unswept} matches not swept`);
      break;
    }
    const chunk = ids.slice(at, at + CONCURRENCY);
    const listed = await Promise.allSettled(chunk.map(pathsOfMatch));
    const paths: string[] = [];
    listed.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        result.swept += 1;
        paths.push(...outcome.value);
      } else {
        note(LEAGUE_TRASH_SWEEP_ERROR_CODES.list);
        console.error(`[league-trash] ${LEAGUE_TRASH_SWEEP_ERROR_CODES.list}: match ${chunk[i]}`, outcome.reason);
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
