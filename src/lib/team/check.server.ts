import 'server-only';
/**
 * The ONE server-side team check. Every surface that answers "is this team legal?" calls `checkTeam`, so the
 * teambuilder's live check (`POST /api/validate-team`), the import preview (`POST /api/import-team`) and the AI
 * agent's `validateTeam` tool cannot disagree about the same team. The ruleset pin-impact check and the Evolution
 * Point Buy match-prep gate run the synchronous core (`validateTeam`, ./pkmn/validation.ts) directly: they judge
 * thousands of stored teams or one stored team without a player's session, where a learnset rule would cancel out of
 * the comparison anyway.
 *
 * What the check layers, in order:
 *  1. the ruleset: the stored version the caller read (a phase's pin, or a ruleset meant to be seen), or, when the
 *     caller names none, the FORMAT's catalog rules (its tier bans, move/item/ability bans and clauses), or, for a
 *     format the catalog does not know, only the generation and the Species Clause. `ruleset_source` on the result says
 *     which one ran, and a ruleset that was asked for and could not be read is a failed check (`ruleset_load_failed`),
 *     never a silent downgrade to weaker rules;
 *  2. the synchronous core (`validateTeam`): bans and allowlists, the two enforced clauses, shape and range of every
 *     set, duplicate moves, the shared-type rule, the team-constraint engine, the Core Liga assigned core and the
 *     drafted roster;
 *  3. the learnset layer (`checkTeamLegality`): can the species learn each move and can it have the ability;
 *  4. Evolution Point Buy seasons: the season's `format_rules` bans and stage-aware tera.
 *
 * The drafted roster is a HARD constraint in a league that has one (player-agent decision 9): a voided pick does not
 * count, and in an Evolution Point Buy league the trainer's trackers say what is owned (a pick stores the line's base
 * Pokémon, the tracker owns its evolved forms, and a Redraft changes the trackers). A player with no draft context at
 * all (not in the league, nothing drafted yet) has no roster rule, as before.
 *
 * NOT checked here, on purpose: the draft BUDGET. Points are enforced when a pick is made (`draft__commit_pick`, the
 * `INSUFFICIENT_BUDGET` family in `src/lib/draft/budget.ts`), and a team that is a subset of a legal roster cannot
 * cost more than the roster did. The editor's "points left" figure (`useDraftContext`) is a display of the same sum,
 * not a rule, so there is nothing for a team-level check to add without a product decision on what a team
 * "budget" means apart from the draft's.
 */
import type { Ruleset } from '@/types/ruleset';
import type { Season, CoreTriple } from '@/types/season';
import type {
  PokemonSet,
  RulesetSource,
  SetIssue,
  TeamIssue,
  TeamValidationResult,
} from '@/types/team';
import { codedIssue, validateTeam } from '@/lib/pkmn/validation';
import { checkTeamLegality } from '@/lib/pkmn/team-legality';
import { generationOrDefault } from '@/lib/pkmn/format-id';
import { resolvePresetRules } from '@/lib/pkmn/preset-rules.server';
import { RESOLVED_RULES_VERSION, rulesFromBans } from '@/lib/ruleset-kit/effective';
import type { ResolvedRules } from '@/lib/ruleset-kit/types';
import { getInitialPoolForPlayer } from '@/lib/draft/player-pool';
import {
  loadEpbSeasonState,
  ownedSpeciesFromBases,
  ownedSpeciesFromTrackers,
  validateEpbTeamForSeason,
  type EpbSeasonState,
} from '@/lib/draft/epb-team-validation';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { getPicksByPlayer } from '@/lib/supabase/queries/drafts';
import { getParticipantCore, getSeasonById } from '@/lib/supabase/queries/seasons';

/** Why a ruleset that was asked for could not be used. */
export type RulesetFailure = NonNullable<RulesetSource['fallback']>;

export interface TeamCheckInput {
  /** The team to check. */
  pokemon: PokemonSet[];
  /** The ruleset to enforce, already read by the caller; null when none could be read (see `rulesetFailure`). */
  ruleset: Ruleset | null;
  /**
   * Set when the caller ASKED for a ruleset and `ruleset` is null: it was not found, or reading it failed. The check
   * then runs on `format` and reports the failure; the result is never valid. Omit it for a bare format check.
   */
  rulesetFailure?: RulesetFailure;
  /** The format key (`gen9ou`) to enforce when there is no ruleset. */
  format?: string;
  /**
   * The player the league context belongs to: always the authenticated player, never a client-supplied id. Without a
   * player and a season there is no roster, core or Evolution Point Buy layer.
   */
  playerId?: string | null;
  /** The league whose roster, core and EPB rules apply. */
  seasonId?: string | null;
  /** The season row when the caller has read it (saves one read); `null` = known absent. */
  season?: Season | null;
  /** The player's assigned Core Liga triple when the caller knows it; otherwise read from `season_participants`. */
  playerCore?: CoreTriple | null;
}

/** The ruleset a bare format check enforces, and which kind it is. */
export function rulesetForFormat(format: string): { ruleset: Ruleset; source: RulesetSource } {
  // The format text can be model-supplied: read it once, case-folded, so the generation and the rules agree.
  const id = format.toLowerCase();
  const preset = resolvePresetRules(id);
  const base: Pick<
    Ruleset,
    'created_by' | 'created_at' | 'updated_at' | 'version' | 'additions' | 'custom_rules_string' | 'min_shared_type_pct' | 'team_constraints'
  > = {
    created_by: null,
    created_at: '',
    updated_at: '',
    version: null,
    additions: { pokemon: [] },
    custom_rules_string: '',
    min_shared_type_pct: 0,
    team_constraints: null,
  };

  if (preset) {
    const rules: ResolvedRules = {
      v: RESOLVED_RULES_VERSION,
      gen: preset.gen,
      format_key: preset.id,
      universe: preset.universe,
      doubles: preset.doubles,
      clauses: preset.clauses,
      pokemon: preset.pokemon,
      moves: preset.moves,
      items: preset.items,
      abilities: preset.abilities,
      added_pokemon: [],
      min_shared_type_pct: 0,
      team_constraints: null,
      custom_rules: '',
    };
    const blockIds = (list: ResolvedRules['pokemon']) => (list.mode === 'block' ? [...list.ids] : []);
    const allowIds = (list: ResolvedRules['pokemon']) => (list.mode === 'allow' ? [...list.ids] : null);
    const ruleset: Ruleset = {
      ...base,
      id: `format:${preset.id}`,
      name: preset.name,
      base_format: preset.id,
      is_doubles: preset.doubles,
      clauses: [...preset.clauses],
      bans: {
        pokemon: blockIds(preset.pokemon),
        moves: blockIds(preset.moves),
        items: blockIds(preset.items),
        abilities: blockIds(preset.abilities),
      },
      allow: {
        pokemon: allowIds(preset.pokemon),
        moves: allowIds(preset.moves),
        items: allowIds(preset.items),
        abilities: allowIds(preset.abilities),
      },
      gen: preset.gen,
      universe: preset.universe,
      rules,
    };
    return { ruleset, source: { kind: 'format_preset', format: preset.id } };
  }

  // No catalog entry: only the generation and the Species Clause. Reported as such, never as "the format's rules".
  const gen = generationOrDefault(id);
  const doubles = /vgc|doubles|bss/i.test(format);
  const ruleset: Ruleset = {
    ...base,
    id: 'format:basic',
    name: format,
    base_format: format,
    is_doubles: doubles,
    clauses: ['Species Clause'],
    bans: { pokemon: [], moves: [], items: [], abilities: [] },
    allow: { pokemon: null, moves: null, items: null, abilities: null },
    gen,
    universe: 'standard',
    rules: rulesFromBans({ gen, formatKey: id, doubles, clauses: ['Species Clause'] }),
  };
  return { ruleset, source: { kind: 'format_basic', format } };
}

// ── Merging ─────────────────────────────────────────────────────────

/**
 * Stable key for a `SetIssue`, used to dedup when unioning results. Only the semantic fields matter: `issue_id` is a
 * UX-only handle and is intentionally excluded.
 */
function setIssueKey(issue: SetIssue): string {
  return `${issue.pokemon_index}|${issue.species}|${issue.issue}|${issue.severity}`;
}

function dedupSetIssues(issues: SetIssue[]): SetIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = setIssueKey(issue);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Coded team issues of a result; plain strings when the details are missing or misaligned. */
function teamIssuesOf(result: TeamValidationResult): TeamIssue[] {
  const details = result.team_issue_details;
  if (details && details.length === result.team_issues.length) return details;
  return result.team_issues.map((issue) => ({ issue }));
}

/** Dedup identical team-wide issues by their English text, preserving first-seen order. */
function dedupTeamIssues(items: TeamIssue[]): TeamIssue[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.issue)) return false;
    seen.add(item.issue);
    return true;
  });
}

// ── The drafted roster ──────────────────────────────────────────────

/**
 * The species the player may field, or `undefined` when no roster rule applies (no draft context).
 *
 * Evolution Point Buy: the trainer's trackers (every form of every held line; a Redraft is already in them). A trainer
 * whose trackers do not exist yet but who has live picks owns the lines of those picks' base Pokémon.
 * Any other draft league: the player's live (not voided) picks in their initial pool.
 */
async function loadRoster(
  seasonId: string,
  playerId: string,
  epb: EpbSeasonState | null,
): Promise<string[] | undefined> {
  if (epb && epb.trackers.length > 0) return ownedSpeciesFromTrackers(epb.trackers, epb.lines);

  // The caller's own pool: the season's, or their group's in a league with groups.
  const pool = await getInitialPoolForPlayer(seasonId, playerId);
  if (!pool) return undefined;
  const picks = await getPicksByPlayer(pool.id, playerId);
  const names = picks.map((p) => p.pokemon_name);
  return epb ? ownedSpeciesFromBases(names, epb.lines) : names;
}

// ── checkTeam ───────────────────────────────────────────────────────

export async function checkTeam(input: TeamCheckInput): Promise<TeamValidationResult> {
  const { pokemon } = input;

  // 1. The ruleset (or the format's rules, reported).
  let ruleset: Ruleset;
  let source: RulesetSource;
  if (input.ruleset) {
    ruleset = input.ruleset;
    source = { kind: 'ruleset' };
  } else {
    if (!input.format) throw new Error('checkTeam needs a ruleset or a format');
    ({ ruleset, source } = rulesetForFormat(input.format));
    if (input.rulesetFailure) source = { ...source, fallback: input.rulesetFailure };
  }

  // 2. League context: the season, the assigned core, the EPB state and the roster.
  const { playerId, seasonId } = input;
  let playerCore: CoreTriple | null = input.playerCore ?? null;
  let draftedPokemon: string[] | undefined;
  let epb: EpbSeasonState | null = null;
  if (seasonId && playerId) {
    const season = input.season !== undefined ? input.season : await getSeasonById(seasonId);
    const isEpb = season !== null && isEvolutionPointBuy(season.format_type);

    const [core, epbState] = await Promise.all([
      // ALWAYS read server-side from `season_participants.core_types` unless the server itself supplied it (the
      // agent's context pack): the validator uses it for `type_quotas.source === 'player_core'` and `tera_match`.
      input.playerCore !== undefined ? Promise.resolve(input.playerCore) : readCore(seasonId, playerId),
      isEpb ? loadEpbSeasonState(seasonId, playerId) : Promise.resolve(null),
    ]);
    playerCore = core;
    epb = epbState;
    draftedPokemon = await loadRoster(seasonId, playerId, epb);
  }

  // 3. The three validators.
  const core = validateTeam(pokemon, ruleset, { playerCore, draftedPokemon });
  const learnsetIssues = await checkTeamLegality(pokemon, ruleset);
  const epbResult = epb && seasonId && playerId ? await validateEpbTeamForSeason(seasonId, playerId, pokemon, epb) : null;

  // 4. Union, deduped; every validator must be clean.
  const teamIssues = dedupTeamIssues([...teamIssuesOf(core), ...(epbResult ? teamIssuesOf(epbResult) : [])]);
  if (source.fallback) {
    // One code, one text; `params.reason` (and `ruleset_source.fallback`) keep "not found" and "read failed" apart.
    teamIssues.push({
      issue:
        'The ruleset for this check could not be used, so the team was checked against the format only and is not confirmed legal for your league',
      ...codedIssue('ruleset_load_failed', { reason: source.fallback }),
    });
  }
  const issues = dedupSetIssues([...core.issues, ...learnsetIssues, ...(epbResult?.issues ?? [])]);
  const valid = issues.every((i) => i.severity !== 'error') && teamIssues.length === 0;

  return {
    valid,
    issues,
    team_issues: teamIssues.map((i) => i.issue),
    team_issue_details: teamIssues,
    ruleset_source: source,
  };
}

/** The assigned core triple; a failed read is logged and reads as "none assigned" (the check then says so). */
async function readCore(seasonId: string, playerId: string): Promise<CoreTriple | null> {
  try {
    return await getParticipantCore(seasonId, playerId);
  } catch (err) {
    console.error('[team-check] could not read the assigned core:', err);
    return null;
  }
}
