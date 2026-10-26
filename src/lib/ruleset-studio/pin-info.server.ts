import 'server-only';
/**
 * The read behind the pin card of a league, a phase or a standalone tournament (`RulesetPinCard`): which ruleset version the
 * target pins, whether a newer one is published, and what moving to it would change. Three narrow reads (the version's
 * definition, the pinned rules, the head rules); no document is selected.
 *
 * `can_view` is the live access rule of the studio for the viewing player (`actorFor`), so the card links to the ruleset only
 * for someone the read-only page would let in.
 */
import { getDefinitionOfVersion } from '@/lib/supabase/queries/ruleset-definitions';
import { getHeadRuleset, getRulesetById } from '@/lib/supabase/queries/rulesets';
import { canViewDefinition, type RulesetActor } from './access';
import { actorFor } from './guards';
import { summarizeChange, type RulesetPinInfo } from './pin-info';

/** The pin of a target, or `null` when it pins nothing (or a version that no longer exists). */
export async function getRulesetPinInfo(versionId: string | null, viewer: Pick<RulesetActor, 'playerId' | 'isAdmin'> | null): Promise<RulesetPinInfo | null> {
  if (versionId === null) return null;
  const found = await getDefinitionOfVersion(versionId);
  if (found === null) return null;
  const [pinned, head] = await Promise.all([getRulesetById(versionId), getHeadRuleset(found.definition.id)]);
  if (pinned === null) return null;

  const newer = head !== null && head.version !== null && head.version.version_no > found.version_no ? head : null;
  const actor = viewer === null ? null : await actorFor(viewer, found.definition);
  return {
    definition_id: found.definition.id,
    name: pinned.name,
    version_id: versionId,
    version_no: found.version_no,
    update: newer === null || newer.version === null ? null : { version_no: newer.version.version_no, change: summarizeChange(pinned.rules, newer.rules) },
    can_view: actor !== null && canViewDefinition(actor, found.definition),
  };
}
