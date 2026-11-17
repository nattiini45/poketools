import { deleteMatchOutcome, getMatchOutcome } from '@/lib/supabase/queries/match-outcomes';
import { logger } from '@/lib/logger';

/**
 * Taking back a match's outcome row when the match leaves `completed` or `disputed` (reopen, reset, a game change, a
 * re-pairing). The row is read BEFORE the status write and deleted with the `set_at` it carried, never by match id
 * alone: the delete is a second request after the status commit, and an admin settle for the now open match may stage
 * its own row (and even complete the match) in between. A row written since carries another `set_at` and survives.
 */

export interface OutcomeTakebackStorage {
  getMatchOutcome(matchId: string): Promise<{ set_at: string } | null>;
  deleteMatchOutcome(matchId: string, options: { onlyIfSetAt: string }): Promise<number>;
}

export function createOutcomeTakeback(storage: OutcomeTakebackStorage) {
  async function readOutcomeMark(matchId: string): Promise<string | null> {
    return (await storage.getMatchOutcome(matchId))?.set_at ?? null;
  }

  async function deleteMarkedOutcome(matchId: string, mark: string | null): Promise<void> {
    if (mark === null) return;
    await storage.deleteMatchOutcome(matchId, { onlyIfSetAt: mark });
  }

  async function takeBackMarkedOutcome(matchId: string, mark: string | null): Promise<boolean> {
    try {
      await deleteMarkedOutcome(matchId, mark);
      return true;
    } catch (error) {
      logger.error('match/outcome', 'the outcome row of a match that left its decided status could not be removed', { matchId, error });
      return false;
    }
  }

  return { readOutcomeMark, deleteMarkedOutcome, takeBackMarkedOutcome };
}

const legacyTakeback = createOutcomeTakeback({
  getMatchOutcome: (id) => getMatchOutcome(id),
  deleteMatchOutcome: (id, options) => deleteMatchOutcome(id, options),
});

/** The `set_at` of the match's current outcome row, or null when there is none (nothing to take back). */
export async function readOutcomeMark(matchId: string): Promise<string | null> {
  return legacyTakeback.readOutcomeMark(matchId);
}

/** Deletes the row `readOutcomeMark` saw, only while it is still that row. Throws on a failed delete. */
export async function deleteMarkedOutcome(matchId: string, mark: string | null): Promise<void> {
  return legacyTakeback.deleteMarkedOutcome(matchId, mark);
}

/**
 * `deleteMarkedOutcome` for a caller whose status write is already saved and that must still finish its other steps: a
 * failed delete is logged with its cause and answers false. The stale row is inert while the match is open (standings
 * read outcomes of completed matches only) and the next completion's finalize replaces it.
 */
export async function takeBackMarkedOutcome(matchId: string, mark: string | null): Promise<boolean> {
  return legacyTakeback.takeBackMarkedOutcome(matchId, mark);
}
