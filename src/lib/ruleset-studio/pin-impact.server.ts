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
import { teamPokemonSchema } from '@/lib/validation/schemas';
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

/** What `summarizePinImpact` counted: teams that become invalid, and stored rows that are not a team at all. */
export interface PinImpactCount {
  broken: number;
  /** Rows whose `pokemon` is not a list of well-formed sets (stored before the boundary schemas); not counted in `broken`. */
  malformed: number;
}

/**
 * Teams of one target that are valid under `from` and not under `to`, and how many stored rows were not a readable team.
 * Pure given the rulesets; no I/O. Only the synchronous core runs here (no learnset layer): this loop validates up to
 * `MAX_IMPACT_TEAMS` teams twice, and a learnset rule would cancel out of the comparison anyway.
 *
 * A malformed row (one stored before `teamPokemonSchema` guarded the team routes) is skipped and counted apart, so a
 * single bad row cannot fail the whole confirmation. The same shape check as the boundary decides, so a team the editor
 * would refuse to save is not silently judged "valid" or "invalid".
 */
export function summarizePinImpact(
  teams: ReadonlyArray<{ player_id: string; pokemon: unknown }>,
  from: Ruleset,
  to: Ruleset,
  coreOf: (playerId: string) => CoreTriple | null,
): PinImpactCount {
  let broken = 0;
  let malformed = 0;
  for (const team of teams) {
    const parsed = teamPokemonSchema.safeParse(team.pokemon);
    if (!parsed.success) {
      malformed += 1;
      continue;
    }
    const context = { playerCore: coreOf(team.player_id) };
    if (validateTeam(parsed.data, from, context).valid && !validateTeam(parsed.data, to, context).valid) broken += 1;
  }
  return { broken, malformed };
}

/** Teams of one target that are valid under `from` and not under `to` (see `summarizePinImpact`). */
export function countBecomingInvalid(
  teams: ReadonlyArray<{ player_id: string; pokemon: unknown }>,
  from: Ruleset,
  to: Ruleset,
  coreOf: (playerId: string) => CoreTriple | null,
): number {
  return summarizePinImpact(teams, from, to, coreOf).broken;
}

export async function computePinImpact(input: PinImpactInput): Promise<PinImpact> {
  const { actor, definition } = input;
  const versions = await listRulesetVersions(definition.id, 100);
  const to = versions.find((v) => v.version_no === input.toVersionNo);
  if (to === undefined) throw new RulesetStudioError('ruleset_not_found');
  const states = await loadMoveTargets(actor, input.targets, versions);

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

  const answers: Required<PinImpactTarget>[] = [];
  let budget = MAX_IMPACT_TEAMS;
  let truncated = false;
  for (const state of states) {
    const answer: Required<PinImpactTarget> = { kind: state.kind, id: state.id, name: state.name, checked: 0, would_break: 0, malformed: 0 };
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

    const { broken, malformed } = summarizePinImpact(teams, current, target, (playerId) => cores.get(playerId) ?? null);
    // A malformed row was not checked, so it is neither in `checked` nor in `would_break`; the dialog names it apart.
    answer.checked = teams.length - malformed;
    answer.would_break = broken;
    answer.malformed = malformed;
  }

  return {
    version_no: to.version_no,
    checked: answers.reduce((sum, a) => sum + a.checked, 0),
    would_break: answers.reduce((sum, a) => sum + a.would_break, 0),
    malformed: answers.reduce((sum, a) => sum + a.malformed, 0),
    truncated,
    targets: answers,
  };
}
