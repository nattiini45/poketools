import 'server-only';
/**
 * The check every route that sets `ruleset_id` on a league, a phase or a tournament runs before it writes.
 *
 * `ruleset_id` holds the id of an immutable ruleset VERSION (the pin). Two rules apply to a change of that value; resending
 * the stored value is never a change:
 *  - the player must be allowed to use the ruleset (`assertRulesetUsable`: it exists, and the player may see it). Without
 *    this check any admin who learned the id of another admin's private ruleset could pin it, which also makes its published
 *    version public;
 *  - once the target has started, the pin cannot be re-pointed or cleared through a plain edit (clearing is a change too, or
 *    a second request could then pin anything): the move goes through
 *    `POST /api/ruleset-definitions/[id]/pins`, which asks for a confirmation that names the league and records the move.
 *    (A finished phase or standalone tournament is locked by its own guard.)
 */
import type { SessionPlayer } from '@/types/auth';
import { RulesetStudioError } from './errors';
import { assertRulesetUsable } from './guards';

export interface RulesetChange {
  /** The live player making the request. */
  player: SessionPlayer;
  /** The stored pin (`null` for a league without a ruleset). */
  current: string | null;
  /** The pin in the request: `undefined` leaves it alone, `null` clears it, an id sets it. */
  requested: string | null | undefined;
  /** Whether the league or phase has started. */
  started: boolean;
}

/** Throws a typed `RulesetStudioError` when the change is not allowed; returns normally for no change. */
export async function assertRulesetChangeAllowed(change: RulesetChange): Promise<void> {
  const { player, current, requested, started } = change;
  if (requested === undefined || requested === current) return;
  if (requested !== null) await assertRulesetUsable(player, requested);
  if (started && current !== null) throw new RulesetStudioError('ruleset_pin_started');
}

/** The check for a request that creates a league, phase or tournament with a ruleset: usable by the player. */
export async function assertRulesetUsableForCreate(player: SessionPlayer, requested: string | null | undefined): Promise<void> {
  if (requested === undefined || requested === null) return;
  await assertRulesetUsable(player, requested);
}
