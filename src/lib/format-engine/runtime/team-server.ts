/**
 * The team check of a kit league: the phase's pinned ruleset (`checkTeam`) merged with the stage's team constraints
 * (`evaluateConstraints`), the player's own resources and the unlocked domains. Server only: it reads the season's
 * runtime rows and resolves the team through the dex.
 *
 * It applies to a custom league on the `kit` engine whose phase stage has constraints, or whose format has domains or
 * resources (a stage without either has nothing to add). Any other league answers `applies: false` and the caller keeps
 * its own flow.
 */
import 'server-only';

import type { Ruleset } from '@/types/ruleset';
import type { PokemonSet, TeamValidationResult } from '@/types/team';
import { getNationalSpecies, getSpecies } from '@/lib/pkmn/dex';
import { toID } from '@/lib/pkmn/i18n/id';
import { readSet } from '@/lib/pkmn/validation';
import { checkTeam } from '@/lib/team/check.server';
import { getKitPhases, getSeasonKitHead } from '@/lib/supabase/queries/format-engine';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { stageOf } from '../load';
import { calendarRoundAt } from './calendar';
import { loadFreshKitContext, phaseById, type KitContext, type KitPhaseInfo } from './load';
import { evaluateConstraints, mergeConstraintIssues, type ConstraintIssue, type EvolutionClass, type TeamMember } from './team';

export interface EvaluateTeamInput {
  seasonId: string;
  /** The kit phase (a `tournaments` row) the team is for. */
  phaseId: string;
  playerId: string;
  roundNumber: number;
  pokemon: PokemonSet[];
  /** The phase's pinned ruleset when the caller has read it; omitted = read from the phase. */
  ruleset?: Ruleset | null;
}

export interface EvaluateTeamResult {
  applies: boolean;
  result: TeamValidationResult;
}

const NOT_APPLICABLE: TeamValidationResult = { valid: true, issues: [], team_issues: [] };

/** Whether the phase's stage or its format give the team check something to enforce beyond the ruleset. */
function hasKitRules(ctx: KitContext, phase: KitPhaseInfo): boolean {
  return (phase.stage.constraints?.length ?? 0) > 0 || (ctx.def.domains?.length ?? 0) > 0 || (ctx.def.resources?.length ?? 0) > 0;
}

function evolutionClass(nfe: boolean | undefined, tiers: readonly (string | undefined)[]): EvolutionClass {
  if (nfe !== true) return 'fe';
  return tiers.includes('LC') ? 'lc' : 'nfe';
}

/**
 * The team as the constraints read it, one member per slot (the issues index slots). A set that cannot be read is an
 * empty member: the ruleset check reports it, and it still counts toward the team size.
 */
export function resolveTeamMembers(pokemon: readonly PokemonSet[], gen: number, national: boolean): TeamMember[] {
  const members: TeamMember[] = [];
  for (const raw of pokemon) {
    const set = readSet(raw);
    if (set === null) {
      members.push({ name: '', species: '', baseName: '', baseSpecies: '', types: [], item: '', itemName: '', teraType: null, evolution: 'fe' });
      continue;
    }
    const species = national ? getNationalSpecies(set.species, gen) : getSpecies(set.species, gen);
    const id = toID(set.species);
    members.push({
      name: species?.name ?? set.species,
      species: species ? toID(species.name) : id,
      baseName: species?.baseSpecies ?? set.species,
      baseSpecies: species ? toID(species.baseSpecies ?? species.name) : id,
      types: species ? [...species.types] : [],
      item: toID(set.item),
      itemName: set.item,
      teraType: set.tera_type ? set.tera_type : null,
      evolution: species ? evolutionClass(species.nfe, [species.tier, species.natDexTier]) : 'fe',
    });
  }
  return members;
}

/**
 * The round a team is checked for outside a match: the phase's latest round, or 1 before it has one. When the stage has a
 * readable calendar and a later round than the calendar's has already been generated (an admin generated round 4 early),
 * the calendar's round wins, so the early round does not apply its rules to players who are still in week 3. A match-bound
 * check does not come here: it uses the round of its match.
 */
export async function currentPhaseRound(phaseId: string, now: Date = new Date()): Promise<number> {
  const rounds = await getRoundsByTournament(phaseId);
  const latest = rounds.reduce((highest, round) => Math.max(highest, round.round_number), 1);
  // The calendar can only lower a round beyond 1, so there is nothing to read before then.
  if (latest === 1) return latest;
  const calendarRound = await calendarRoundOfPhase(phaseId, now);
  return calendarRound === null ? latest : Math.min(latest, calendarRound);
}

/**
 * The round the calendar of the phase's stage is in, or null when the phase has no readable calendar. It reads the engine,
 * the phase rows and the season only (the stage is frozen into the phase row), not the whole kit context: the caller's
 * `evaluateTeam` loads that context itself right after, and loading it here would read every `format_*` table twice.
 */
async function calendarRoundOfPhase(phaseId: string, now: Date): Promise<number | null> {
  const phase = await getTournamentById(phaseId);
  if (!phase?.season_id) return null;
  const [head, phaseRows, season] = await Promise.all([getSeasonKitHead(phase.season_id), getKitPhases(phase.season_id), getSeasonById(phase.season_id)]);
  // Only a league that runs on the kit engine has a calendar to apply (as `loadFreshKitContext`).
  if (head?.engine !== 'kit') return null;
  const row = phaseRows.find((candidate) => candidate.id === phaseId);
  const calendar = row === undefined ? undefined : (await stageOf(row)).calendar;
  if (calendar === undefined) return null;
  return calendarRoundAt(calendar, { seasonStart: season?.start_date ?? null }, now);
}

export interface EvaluateKitConstraintsInput {
  ctx: KitContext;
  phase: KitPhaseInfo;
  playerId: string;
  roundNumber: number;
  pokemon: PokemonSet[];
  /** The phase's pinned ruleset, read for the generation and universe only; null reads the team as gen 9, regional. */
  ruleset: Ruleset | null;
}

/**
 * The stage's team constraints evaluated against a team, and nothing else: no ruleset or learnset check, no core,
 * roster or season read. Pure over its input. `evaluateTeam` adds the ruleset verdict on top; the post-match audit
 * (`team-audit-server.ts`) uses this alone.
 */
export function evaluateKitConstraints(input: EvaluateKitConstraintsInput): { issues: ConstraintIssue[]; members: TeamMember[] } {
  const { ctx, phase, ruleset } = input;
  const members = resolveTeamMembers(input.pokemon, ruleset?.gen ?? 9, ruleset?.rules.universe === 'national');
  const issues = evaluateConstraints({
    constraints: phase.stage.constraints ?? [],
    def: ctx.def,
    state: ctx.state,
    seed: ctx.seed,
    playerId: input.playerId,
    round: input.roundNumber,
    members,
  });
  return { issues, members };
}

export async function evaluateTeam(input: EvaluateTeamInput): Promise<EvaluateTeamResult> {
  const ctx = await loadFreshKitContext(input.seasonId);
  const phase = ctx === null ? undefined : phaseById(ctx, input.phaseId);
  if (ctx === null || phase === undefined || !hasKitRules(ctx, phase)) return { applies: false, result: NOT_APPLICABLE };

  const [ruleset, season] = await Promise.all([
    input.ruleset !== undefined ? Promise.resolve(input.ruleset) : readPhaseRuleset(input.phaseId),
    getSeasonById(input.seasonId),
  ]);
  const base = await checkTeam({
    pokemon: input.pokemon,
    ruleset,
    // A phase whose pin cannot be read is a failed check, reported by checkTeam, never a silent downgrade.
    ...(ruleset === null ? { rulesetFailure: 'ruleset_not_found' as const, format: 'gen9' } : {}),
    playerId: input.playerId,
    seasonId: input.seasonId,
    season,
  });

  const { issues, members } = evaluateKitConstraints({
    ctx,
    phase,
    playerId: input.playerId,
    roundNumber: input.roundNumber,
    pokemon: input.pokemon,
    ruleset,
  });
  return { applies: true, result: mergeConstraintIssues(base, issues, members) };
}

/** The ruleset a phase pins, or null when the phase or its ruleset does not exist. */
export async function readPhaseRuleset(phaseId: string): Promise<Ruleset | null> {
  const phase = await getTournamentById(phaseId);
  return phase ? getRulesetById(phase.ruleset_id) : null;
}
