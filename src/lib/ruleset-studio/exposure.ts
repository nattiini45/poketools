import 'server-only';
/**
 * Reading a ruleset version by an id that came from a client (or from a model): the public ruleset API, the free team
 * validator, the team importer and the AI tools.
 *
 * A version id is the capability to read that version, so it is served only when the ruleset is meant to be seen: its
 * definition is shared (`league`, `gallery`), or a league or phase pins it (the league's public page shows its rules to
 * everyone). A published version of a PRIVATE ruleset that no league pins yet is not exposed: guessing or leaking an id does
 * not reveal another admin's work in progress. Reading the ruleset a phase PINS goes through `getRulesetById` directly; this
 * module is only for ids nobody vouched for.
 */
import { getDefinitionOfVersion, isVersionPinned } from '@/lib/supabase/queries/ruleset-definitions';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import type { Ruleset } from '@/types/ruleset';

/** The ruleset of an exposed version, or null (unknown id, malformed id, or a private ruleset that nothing pins). */
export async function readExposedRuleset(versionId: string): Promise<Ruleset | null> {
  const found = await getDefinitionOfVersion(versionId);
  if (found === null) return null;
  if (found.definition.visibility === 'private' && !(await isVersionPinned(versionId))) return null;
  return getRulesetById(versionId);
}
