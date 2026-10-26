import 'server-only';
/**
 * What moving a pin does to the teams already submitted: for each league or phase, how many teams are valid under the ruleset
 * version it pins now and would not be under the version it is asked to move to. The pin card's confirmation dialog shows the
 * number, so an admin who updates a running league knows what the update costs before it happens.
 *
 * The check is the real validator (`validateTeam`) against the real rules of both versions (`getRulesetById`: the frozen
 * resolved rules, the same read the team check uses), team by team, with the player's assigned core for rulesets that depend
 * on it. It compares the two outcomes, so a team that is invalid under the current version anyway is not counted (it does not
 * become invalid), and rules the move does not touch (draft ownership, Evolution Point Buy limits) cancel out. A team that can
 * no longer change (locked, or linked to a completed match) is not checked.
 *
 * Bounded: at most `MAX_IMPACT_TEAMS` teams per request, read in `.range()` pages; past that the answer says `truncated` and
 * counts what it checked. Reads only; the access rules are the ones of the move itself (`loadMoveTargets`).
 */
import type { Ruleset } from '@/types/ruleset';
import type { SessionPlayer } from '@/types/auth';
import { validateTeam } from '@/lib/pkmn/validation';
import { listParticipantCores } from '@/lib/supabase/queries/seasons';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { listRulesetVersions } from '@/lib/supabase/queries/ruleset-definitions';
import { listTeamsForPinImpact } from '@/lib/supabase/queries/teams';
import type { CoreTriple } from '@/types/season';
import type { PinTarget } from './api-schemas';
import { RulesetStudioError } from './errors';
import type { RulesetDefinitionMeta } from './library-types';
import type { PinImpact, PinImpactTarget } from './pin-info';
import { loadMoveTargets } from './pins';

/** Most teams one request validates, over all its targets (two validations each). */
export const MAX_IMPACT_TEAMS = 2000;

export interface PinImpactInput {
  actor: SessionPlayer;
  definition: RulesetDefinitionMeta;
  toVersionNo: number;
  targets: readonly PinTarget[];
}

/** Teams of one target that are valid under `from` and not under `to`. Pure given the rulesets; no I/O. */
export function countBecomingInvalid(
  teams: ReadonlyArray<{ player_id: string; pokemon: Parameters<typeof validateTeam>[0] }>,
  from: Ruleset,
  to: Ruleset,
  coreOf: (playerId: string) => CoreTriple | null,
): number {
  let broken = 0;
  for (const team of teams) {
    const context = { playerCore: coreOf(team.player_id) };
    if (validateTeam(team.pokemon, from, context).valid && !validateTeam(team.pokemon, to, context).valid) broken += 1;
  }
  return broken;
}

export async function computePinImpact(input: PinImpactInput): Promise<PinImpact> {
  const { actor, definition } = input;
  const versions = await listRulesetVersions(definition.id, 100);
  const to = versions.find((v) => v.version_no === input.toVersionNo);
  if (to === undefined) throw new RulesetStudioError('ruleset_not_found');
  const states = await loadMoveTargets(actor, definition, input.targets);

  const rulesets = new Map<string, Ruleset>();
  const rulesetOf = async (versionId: string): Promise<Ruleset> => {
    const known = rulesets.get(versionId);
    if (known) return known;
    const found = await getRulesetById(versionId);
    if (found === null) throw new RulesetStudioError('ruleset_not_found');
    rulesets.set(versionId, found);
    return found;
  };
  const target = await rulesetOf(to.id);

  const answers: PinImpactTarget[] = [];
  let budget = MAX_IMPACT_TEAMS;
  let truncated = false;
  for (const state of states) {
    const answer: PinImpactTarget = { kind: state.kind, id: state.id, name: state.name, checked: 0, would_break: 0 };
    answers.push(answer);
    // Already on the target version (loadMoveTargets guarantees a pin): nothing changes for it.
    if (state.ruleset_id === null || state.ruleset_id === to.id) continue;
    if (budget === 0) {
      truncated = true;
      continue;
    }

    const { teams, truncated: cut } = await listTeamsForPinImpact({ kind: state.kind, id: state.id }, budget);
    if (cut) truncated = true;
    budget -= teams.length;
    if (teams.length === 0) continue;

    const current = await rulesetOf(state.ruleset_id);
    // Player cores matter only to rulesets whose team rules read them; skip the roster read otherwise.
    const seasonId = state.kind === 'season' ? state.id : state.season_id;
    const needsCores = current.team_constraints !== null || target.team_constraints !== null;
    const cores = needsCores && seasonId !== null ? await listParticipantCores(seasonId) : new Map<string, CoreTriple>();

    answer.checked = teams.length;
    answer.would_break = countBecomingInvalid(teams, current, target, (playerId) => cores.get(playerId) ?? null);
  }

  return {
    version_no: to.version_no,
    checked: answers.reduce((sum, a) => sum + a.checked, 0),
    would_break: answers.reduce((sum, a) => sum + a.would_break, 0),
    truncated,
    targets: answers,
  };
}
