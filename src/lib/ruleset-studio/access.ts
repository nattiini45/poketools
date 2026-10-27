/**
 * Who may do what with a stored ruleset definition. Pure rules, no I/O. The rules are the studio core's
 * (`src/lib/studio-core/access.ts`, the same as the format library's); this module binds them to rulesets and adds the
 * one verb only rulesets have.
 *
 * `RulesetActor.isAdmin` must be a LIVE site-admin flag from a `require*` guard (never the token's copy). League and
 * tournament admins are "owners" of the definitions they created and nothing else: they see their own definitions and
 * the ones shared with all admins (`league`, `gallery`), and they edit only their own.
 *
 * - A `kind = 'preset'` row (a site catalog ruleset) is only ever edited by site admins.
 * - A ruleset a format attach created for one league (`season_id` set) is also managed by the admins of THAT league:
 *   the guard fills `leagueIds` with the league when the actor administers it.
 * - A `gallery` definition belongs to the site: its owner cannot publish a new version of it nor move it.
 * - Using a ruleset (pinning it to a league or phase, attaching a format that names it) needs the right to see it AND a
 *   published version: a draft is not a ruleset yet.
 */
import { canViewDefinition, type StudioActor } from '@/lib/studio-core/access';
import type { RulesetDefinitionMeta } from './library-types';

export { canDeleteDefinition, canEditDraft, canPublishVersion, canSetVisibility, canViewDefinition } from '@/lib/studio-core/access';

export type RulesetActor = StudioActor;

/** Pin a version of the definition to a league or phase, or name it in a format: visible and published. */
export function canUseRuleset(
  actor: RulesetActor,
  def: Pick<RulesetDefinitionMeta, 'kind' | 'owner_id' | 'visibility' | 'season_id'>,
  hasPublishedVersion: boolean,
): boolean {
  return hasPublishedVersion && canViewDefinition(actor, def);
}
