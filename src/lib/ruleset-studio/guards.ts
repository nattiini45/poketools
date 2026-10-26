import 'server-only';
/**
 * Route guards of the ruleset library: the live guard of a definition (`requireRulesetOwner` / `requireRulesetViewer`) and
 * the check a route runs on a ruleset id it is about to pin (`assertRulesetUsable`).
 *
 * Every guard re-reads the player (`requireAnyAdmin`: live, never the token) and the definition (metadata only, never the
 * draft body), so a stale token or a concurrent owner change cannot widen access. A league admin of a league-owned
 * ruleset is found with one extra read of `resource_admins`, only for such rows. A malformed or unknown id is
 * `404 ruleset_not_found` for site admins too (a malformed id would fail the uuid filter as a 500 otherwise).
 */
import { AuthError, requireAnyAdmin } from '@/lib/auth/helpers';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getDefinitionOfVersion, getRulesetDefinitionMeta } from '@/lib/supabase/queries/ruleset-definitions';
import { isValidUuid } from '@/lib/utils/uuid';
import type { SessionPlayer } from '@/types/auth';
import { canEditDraft, canUseRuleset, canViewDefinition, type RulesetActor } from './access';
import { FormatStudioError } from '@/lib/format-studio/errors';
import { RulesetStudioError } from './errors';
import type { RulesetDefinitionMeta } from './library-types';

/** A stored ruleset definition and the live player who may use it. */
export interface RulesetAccess {
  player: SessionPlayer;
  definition: RulesetDefinitionMeta;
  actor: RulesetActor;
}

/** The actor for one definition: the league id is filled only when the player administers the league that owns it. */
export async function actorFor(player: Pick<SessionPlayer, 'playerId' | 'isAdmin'>, definition: RulesetDefinitionMeta): Promise<RulesetActor> {
  const base: RulesetActor = { playerId: player.playerId, isAdmin: player.isAdmin };
  if (player.isAdmin || definition.season_id === null) return base;
  const administers = await isResourceAdminFor(player.playerId, 'season', definition.season_id);
  return administers ? { ...base, leagueIds: new Set([definition.season_id]) } : base;
}

async function loadAccess(
  definitionId: string,
  allowed: (actor: RulesetActor, definition: RulesetDefinitionMeta) => boolean,
  forbiddenMessage: string,
): Promise<RulesetAccess> {
  const player = await requireAnyAdmin();
  if (!isValidUuid(definitionId)) throw new RulesetStudioError('ruleset_not_found');
  const definition = await getRulesetDefinitionMeta(definitionId);
  if (!definition) throw new RulesetStudioError('ruleset_not_found');
  const actor = await actorFor(player, definition);
  if (!allowed(actor, definition)) throw new AuthError(forbiddenMessage, 403, 'forbidden');
  return { player, definition, actor };
}

/**
 * Requires any admin tier AND the right to edit the ruleset definition (live): its owner, the admins of the league that owns
 * it, or a site admin. A `preset` row is site admin only.
 */
export async function requireRulesetOwner(definitionId: string): Promise<RulesetAccess> {
  return loadAccess(definitionId, canEditDraft, 'Ruleset owner access required');
}

/** Like `requireRulesetOwner`, for reading: also lets any admin see a definition shared with all admins. */
export async function requireRulesetViewer(definitionId: string): Promise<RulesetAccess> {
  return loadAccess(definitionId, canViewDefinition, 'Ruleset access required');
}

/**
 * The check every route that accepts a ruleset id to PIN (a league, a phase, a tournament, a clone) runs. `rulesetId` is a
 * version id. An unknown or malformed id is `ruleset_not_found`; a version of a definition the player may not see is
 * `ruleset_forbidden` (a private ruleset of another admin must not become usable, and its published version public, by
 * guessing an id). Returns the definition and the version number.
 */
export async function assertRulesetUsable(
  player: SessionPlayer,
  rulesetId: string,
): Promise<{ definition: RulesetDefinitionMeta; version_no: number }> {
  if (!isValidUuid(rulesetId)) throw new RulesetStudioError('ruleset_not_found');
  const found = await getDefinitionOfVersion(rulesetId);
  if (found === null) throw new RulesetStudioError('ruleset_not_found');
  const actor = await actorFor(player, found.definition);
  // A version exists, so the definition has a published version.
  if (!canUseRuleset(actor, found.definition, true)) throw new RulesetStudioError('ruleset_forbidden');
  return found;
}

/**
 * The check the format attach runs on the rulesets a format document names (DEFINITION ids): each must exist and be usable by
 * the player. A named ruleset the player may not use is `format_attach_ruleset_forbidden`; an id that names nothing is left to
 * the compile (`ruleset_not_found` diagnostic).
 */
export async function assertDefinitionsUsable(player: SessionPlayer, definitionIds: readonly string[]): Promise<void> {
  for (const id of definitionIds) {
    const definition = await getRulesetDefinitionMeta(id);
    if (definition === null) continue;
    const actor = await actorFor(player, definition);
    if (!canUseRuleset(actor, definition, definition.current_version_id !== null)) {
      throw new FormatStudioError('format_attach_ruleset_forbidden');
    }
  }
}
