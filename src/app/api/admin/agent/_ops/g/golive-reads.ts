/**
 * The reads the Go-live read-backs use (spec §18.8): existing query modules only, none of them cached, because a read-back
 * must see the write it checks. Every function here reads and nothing writes; a read-back never calls the route again.
 *
 * Kept apart from `shared.ts` (the Build read-backs) so a test of the Build bindings does not load the ruleset and round
 * query modules.
 */
import type { PinTarget } from '@/lib/ruleset-studio/api-schemas';
import { getPinTargetStates, getRulesetDefinitionDraft, getRulesetDefinitionMeta, listRulesetVersions } from '@/lib/supabase/queries/ruleset-definitions';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { isRecord, uuidOrNull } from './shared';
import type { Outcome } from '@/lib/ai/admin-agent/dispatch';

/** A ruleset has at most 100 versions (the publish function's quota), so one page of them is all of them. */
const VERSION_PAGE = 100;

/** The versions of a ruleset definition, newest first (summaries: no spec, no rules). */
export const readRulesetVersions = (definitionId: string) => listRulesetVersions(definitionId, VERSION_PAGE);

/** The leagues and phases of a pin move, as they pin now. An id that is not a row is absent from the answer. */
export function readPinStates(targets: readonly PinTarget[]) {
  return getPinTargetStates(
    targets.filter((target) => target.kind === 'season').map((target) => target.id),
    targets.filter((target) => target.kind === 'tournament').map((target) => target.id),
  );
}

/** The rounds of a tournament, in round order. */
export const readRounds = (tournamentId: string) => getRoundsByTournament(tournamentId);

/** A tournament by id (`null`: no such row); `current_round` moves last in both start routes. */
export const readTournamentState = (tournamentId: string) => getTournamentById(tournamentId);

/** The id of the version a publish answered with (`data.version.id`), or `null` when it answered nothing usable. */
export function publishedVersionId(outcome: Outcome): string | null {
  if (outcome.kind !== 'ok' || !isRecord(outcome.data) || !isRecord(outcome.data.version)) return null;
  return uuidOrNull(outcome.data.version.id);
}

/** The working draft of a definition and its revision (`null`: no such definition). */
export const readDraft = (definitionId: string) => getRulesetDefinitionDraft(definitionId);

/** The definition's metadata (`null`: no such definition). */
export const readDefinition = (definitionId: string) => getRulesetDefinitionMeta(definitionId);
