import type {
  PokemonSet,
  SetIssue,
  TeamIssue,
  TeamValidationResult,
  ValidationIssueCode,
  ValidationIssueParams,
} from '@/types/team';
import type { Ruleset, TeamConstraints, TierKey } from '@/types/ruleset';
import type { CoreTriple } from '@/types/season';
import {
  getSpecies,
  getMove,
  getItem,
  getAbility,
  getNationalSpecies,
  getNationalMove,
  getNationalItem,
  getNationalAbility,
  getRawEntity,
  type RawEntityKind,
  isFullyEvolved,
  isLegendary,
} from './dex';
import { toID } from './i18n/id';
import { compareTier, computeEvioliteBannedSpecies, normalizeTier } from './tiers';
import type { ResolvedList } from '@/lib/ruleset-kit/types';

/** The ids of the two clauses the validator enforces (`./clauses.ts`). */
const SPECIES_CLAUSE = 'speciesclause';
const ITEM_CLAUSE = 'itemclause';

/**
 * Issues carry an English `issue` (kept for the AI agent tools and logs) plus a
 * `code` and `params` (`ValidationIssueCode`, `@/types/team`) that the
 * teambuilder renders through `teambuilder.validation.issue.*`. Params hold
 * English @pkmn names; the UI localizes them through the pkmn layer.
 */

/**
 * The `code` (+ `params`) half of an issue. A helper rather than a `code:`
 * literal: these are teambuilder message keys, not API error codes, so the
 * `errors/*` catalog scan (`error-codes.test.ts`) must not read them as such.
 */
export function codedIssue(
  code: ValidationIssueCode,
  params?: ValidationIssueParams,
): { code: ValidationIssueCode; params?: ValidationIssueParams } {
  return params ? { code, params } : { code };
}

/**
 * Validate draft ownership: every Pokémon on the team must be in the player's draft roster.
 * Returns team-level issues for any Pokémon not owned.
 */
export function validateDraftOwnership(
  pokemon: PokemonSet[],
  draftedPokemon: string[]
): string[] {
  return draftOwnershipIssues(pokemon, draftedPokemon).map((i) => i.issue);
}

/**
 * `validateDraftOwnership` with codes (`not_in_roster`). Names compare by dex id (`toID`), so `Rotom-Wash`,
 * `rotom wash` and `Rotomwash` are one Pokémon.
 */
function draftOwnershipIssues(pokemon: PokemonSet[], draftedPokemon: string[]): TeamIssue[] {
  const ownedSet = new Set(draftedPokemon.map((n) => toID(n)));
  const issues: TeamIssue[] = [];

  for (const raw of pokemon) {
    const species = (raw as { species?: unknown } | null)?.species;
    if (typeof species !== 'string' || species === '') continue; // a malformed set is reported as such
    if (!ownedSet.has(toID(species))) {
      issues.push({
        issue: `${species} is not in your draft roster`,
        ...codedIssue('not_in_roster', { species }),
      });
    }
  }

  return issues;
}

// ── Reading a set defensively ───────────────────────────────────────

const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
const MAX_EV_PER_STAT = 252;
const MAX_EV_TOTAL = 510;
const MAX_IV = 31;
const MAX_MOVES = 4;

type Spread = Partial<Record<(typeof STAT_KEYS)[number], unknown>>;

/** A set whose members the validator may read without further guards. */
export interface ReadSet {
  species: string;
  item: string;
  ability: string;
  moves: string[];
  evs: Spread;
  ivs: Spread;
  /** Absent level = the default (100). */
  level: unknown;
  tera_type?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Reads one stored or posted set without ever throwing: a missing `evs`, `ivs`, `moves`, `item` or `ability` takes
 * its default (a set under construction has none of them); a member of the wrong type, or no species, makes the set
 * malformed (`null`), which the validator reports as `malformed_set`. The boundary schemas (`pokemonSetSchema`)
 * refuse such a set before it is stored; this is the guard for rows stored before they did.
 */
export function readSet(raw: unknown): ReadSet | null {
  if (!isRecord(raw)) return null;
  const { species, item, ability, moves, evs, ivs, level, tera_type } = raw;
  if (typeof species !== 'string' || species.trim() === '') return null;
  if (item !== undefined && item !== null && typeof item !== 'string') return null;
  if (ability !== undefined && ability !== null && typeof ability !== 'string') return null;
  if (moves !== undefined && moves !== null && (!Array.isArray(moves) || moves.some((m) => typeof m !== 'string'))) return null;
  if (evs !== undefined && evs !== null && !isRecord(evs)) return null;
  if (ivs !== undefined && ivs !== null && !isRecord(ivs)) return null;
  return {
    species,
    item: typeof item === 'string' ? item : '',
    ability: typeof ability === 'string' ? ability : '',
    moves: (moves as string[] | undefined | null) ?? [],
    evs: isRecord(evs) ? evs : {},
    ivs: isRecord(ivs) ? ivs : {},
    level,
    tera_type: typeof tera_type === 'string' ? tera_type : undefined,
  };
}

/** A malformed set's label in an issue: its species when it has a readable one. */
function labelOfMalformed(raw: unknown): string {
  const species = isRecord(raw) ? raw.species : undefined;
  return typeof species === 'string' ? species : '';
}

/** Splits coded team issues into the legacy English list plus the aligned details. */
function teamIssueFields(
  details: TeamIssue[],
): Pick<TeamValidationResult, 'team_issues' | 'team_issue_details'> {
  return { team_issues: details.map((d) => d.issue), team_issue_details: details };
}

/**
 * Optional context for team validation. When omitted, the new constraint
 * engine still runs but skips player-core dependent checks.
 */
export interface TeamValidationContext {
  /** Player's assigned Core Liga triple (from `season_participants.core_types`). */
  playerCore?: CoreTriple | null;
  /** Drafted roster — same semantics as the legacy 3rd argument. */
  draftedPokemon?: string[];
}

function asContext(
  arg: TeamValidationContext | string[] | undefined,
): TeamValidationContext {
  if (!arg) return {};
  if (Array.isArray(arg)) return { draftedPokemon: arg };
  return arg;
}

/** What the validator reads of a resolved move, item or ability: its display name (the id is `toID` of it). */
interface Resolved {
  name: string;
}

/** A membership test for a resolved list: not banned in block mode, listed in allow mode. */
function allowedBy(list: ResolvedList): (id: string) => boolean {
  const ids = new Set(list.ids);
  return list.mode === 'block' ? (id) => !ids.has(id) : (id) => ids.has(id);
}

type ListKind = 'species' | 'moves' | 'items' | 'abilities';

/** The issue codes of a category: what a block list reports and what an allowlist reports. */
const LIST_ISSUE: Record<
  ListKind,
  { banned: 'species_banned' | 'move_banned' | 'item_banned' | 'ability_banned'; notAllowed: 'species_not_allowed' | 'move_not_allowed' | 'item_not_allowed' | 'ability_not_allowed'; plural: string; param: 'species' | 'move' | 'item' | 'ability' }
> = {
  species: { banned: 'species_banned', notAllowed: 'species_not_allowed', plural: 'Pokémon', param: 'species' },
  moves: { banned: 'move_banned', notAllowed: 'move_not_allowed', plural: 'moves', param: 'move' },
  items: { banned: 'item_banned', notAllowed: 'item_not_allowed', plural: 'items', param: 'item' },
  abilities: { banned: 'ability_banned', notAllowed: 'ability_not_allowed', plural: 'abilities', param: 'ability' },
};

/**
 * The issue for an entity the ruleset rules out: a block list reports it as banned, an allowlist as not on the list of
 * allowed entries.
 */
function listIssue(kind: ListKind, mode: ResolvedList['mode'], index: number, speciesName: string, entityName: string): SetIssue {
  const { banned, notAllowed, plural, param } = LIST_ISSUE[kind];
  return mode === 'block'
    ? { pokemon_index: index, species: speciesName, issue: `${entityName} is banned`, severity: 'error', ...codedIssue(banned, { [param]: entityName }) }
    : {
        pokemon_index: index,
        species: speciesName,
        issue: `${entityName} is not on this ruleset's list of allowed ${plural}`,
        severity: 'error',
        ...codedIssue(notAllowed, { [param]: entityName }),
      };
}

/**
 * Validate a team (array of PokemonSet) against a Ruleset.
 * Returns a granular result with per-set and team-wide issues.
 *
 * What is enforced comes from `ruleset.rules`, the frozen effective rules of the pinned version (dex ids, not names):
 * the ban lists of the four categories, or an allowlist in place of a ban list (only the listed entries are legal), the
 * Species Clause and the Item Clause (the only clauses the app enforces; every other clause is informational), the
 * shared-type rule and the team constraints. A ruleset whose universe is `national` resolves species, moves, items and
 * abilities in the National Dex of its generation, so a Mega Evolution or a past move is a legal entry there.
 *
 * The 3rd argument may be either a `TeamValidationContext` or a legacy
 * `string[]` of drafted Pokémon (kept for backwards compat).
 */
export function validateTeam(
  pokemon: PokemonSet[],
  ruleset: Ruleset,
  contextOrDrafted?: TeamValidationContext | string[],
): TeamValidationResult {
  const ctx = asContext(contextOrDrafted);
  const issues: SetIssue[] = [];
  const teamIssues: TeamIssue[] = [];

  // ── Structural checks ─────────────────────────────────────────────
  if (!Array.isArray(pokemon) || pokemon.length === 0) {
    teamIssues.push({ issue: 'Team must have at least 1 Pokémon', ...codedIssue('team_empty') });
    return { valid: false, issues, ...teamIssueFields(teamIssues) };
  }
  if (pokemon.length > 6) {
    teamIssues.push({ issue: 'Team cannot have more than 6 Pokémon', ...codedIssue('team_too_large') });
  }

  // ── Per-set validation ─────────────────────────────────────────────
  const gen = ruleset.gen;
  const rules = ruleset.rules;
  const national = rules.universe === 'national';
  const speciesAllowed = allowedBy(rules.pokemon);
  const movesAllowed = allowedBy(rules.moves);
  const itemsAllowed = allowedBy(rules.items);
  const abilitiesAllowed = allowedBy(rules.abilities);
  // An entry the ruleset's allowlist names is legal whatever the dex calls it: a roster lists the unreleased Mega Stones
  // and Mega Evolutions that the dex files under `Future`, which neither universe resolves (the Studio's known ids
  // widen the same way). Without this such an entry would be an unknown one and would skip the allowlist check.
  const resolver = <T extends Resolved>(kind: RawEntityKind, list: ResolvedList, inUniverse: (name: string) => T | undefined) => {
    const listed = list.mode === 'allow' ? new Set(list.ids) : null;
    return (name: string): T | undefined =>
      inUniverse(name) ?? (listed?.has(toID(name)) ? (getRawEntity(kind, name, gen) as T | undefined) : undefined);
  };
  const resolveSpecies = resolver('species', rules.pokemon, (name) => (national ? getNationalSpecies(name, gen) : getSpecies(name, gen)));
  const resolveMove = resolver<Resolved>('moves', rules.moves, (name) => (national ? getNationalMove(name, gen) : getMove(name, gen)));
  const resolveItem = resolver<Resolved>('items', rules.items, (name) => (national ? getNationalItem(name, gen) : getItem(name, gen)));
  const resolveAbility = resolver<Resolved>('abilities', rules.abilities, (name) =>
    national ? getNationalAbility(name, gen) : getAbility(name, gen),
  );

  // Every set read once, defensively; a set that cannot be read is reported and skipped by every later check.
  const sets: (ReadSet | null)[] = pokemon.map(readSet);

  for (let i = 0; i < pokemon.length; i++) {
    const set = sets[i];
    if (set === null) {
      const label = labelOfMalformed(pokemon[i]);
      issues.push({
        pokemon_index: i,
        species: label,
        issue: 'This set is incomplete or malformed',
        severity: 'error',
        ...codedIssue('malformed_set'),
      });
      continue;
    }

    // Species existence
    const species = resolveSpecies(set.species);
    if (!species) {
      issues.push({
        pokemon_index: i,
        species: set.species,
        issue: `Unknown species: ${set.species}`,
        severity: 'error',
        ...codedIssue('unknown_species', { species: set.species }),
      });
      continue; // skip further checks for invalid species
    }

    // Banned Pokémon
    if (!speciesAllowed(toID(species.name))) {
      issues.push(listIssue('species', rules.pokemon.mode, i, species.name, species.name));
    }

    // Move validation
    if (set.moves.length === 0) {
      issues.push({ pokemon_index: i, species: species.name, issue: 'Must have at least 1 move', severity: 'error', ...codedIssue('min_moves') });
    }
    if (set.moves.length > MAX_MOVES) {
      issues.push({ pokemon_index: i, species: species.name, issue: 'Cannot have more than 4 moves', severity: 'error', ...codedIssue('max_moves') });
    }
    const seenMoves = new Set<string>();
    for (const moveName of set.moves) {
      const move = resolveMove(moveName);
      if (!move) {
        issues.push({
          pokemon_index: i,
          species: species.name,
          issue: `Unknown move: ${moveName}`,
          severity: 'error',
          ...codedIssue('unknown_move', { move: moveName }),
        });
      } else if (!movesAllowed(toID(move.name))) {
        issues.push(listIssue('moves', rules.moves.mode, i, species.name, move.name));
      }
      // Showdown refuses a set that names a move twice. The canonical id decides, so an alias or a differently cased
      // spelling of one move counts; an unknown move is compared by its own id.
      const moveId = toID(move?.name ?? moveName);
      if (moveId !== '') {
        if (seenMoves.has(moveId)) {
          const shown = move?.name ?? moveName;
          issues.push({
            pokemon_index: i,
            species: species.name,
            issue: `${shown} is listed more than once`,
            severity: 'error',
            ...codedIssue('duplicate_move', { move: shown }),
          });
        }
        seenMoves.add(moveId);
      }
    }

    // Item validation
    if (set.item) {
      const item = resolveItem(set.item);
      if (!item) {
        issues.push({
          pokemon_index: i,
          species: species.name,
          issue: `Unknown item: ${set.item}`,
          severity: 'warning',
          ...codedIssue('unknown_item', { item: set.item }),
        });
      } else if (!itemsAllowed(toID(item.name))) {
        issues.push(listIssue('items', rules.items.mode, i, species.name, item.name));
      }
    }

    // Ability validation
    if (set.ability) {
      const ability = resolveAbility(set.ability);
      if (!ability) {
        issues.push({
          pokemon_index: i,
          species: species.name,
          issue: `Unknown ability: ${set.ability}`,
          severity: 'warning',
          ...codedIssue('unknown_ability', { ability: set.ability }),
        });
      } else if (!abilitiesAllowed(toID(ability.name))) {
        issues.push(listIssue('abilities', rules.abilities.mode, i, species.name, ability.name));
      }
    }

    // Individual EVs: a whole number from 0 to 252. Both bounds matter: a negative EV would let the other five stats
    // pass the total below (-760 with five 252s totals 500). A stat that is absent is 0.
    let evTotal = 0;
    for (const stat of STAT_KEYS) {
      const val = set.evs[stat];
      if (val === undefined || val === null) continue;
      if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
        issues.push({
          pokemon_index: i,
          species: species.name,
          issue: `${stat} EVs (${String(val)}) must be a whole number from 0 to ${MAX_EV_PER_STAT}`,
          severity: 'error',
          ...codedIssue('ev_stat_invalid', { stat, value: typeof val === 'number' ? val : String(val) }),
        });
        continue;
      }
      evTotal += val;
      if (val > MAX_EV_PER_STAT) {
        issues.push({
          pokemon_index: i,
          species: species.name,
          issue: `${stat} EVs (${val}) exceed ${MAX_EV_PER_STAT}`,
          severity: 'error',
          ...codedIssue('ev_stat_cap', { stat, value: val }),
        });
      }
    }

    // EV total (max 510), over the stats that are valid on their own.
    if (evTotal > MAX_EV_TOTAL) {
      issues.push({
        pokemon_index: i,
        species: species.name,
        issue: `EV total (${evTotal}) exceeds ${MAX_EV_TOTAL}`,
        severity: 'error',
        ...codedIssue('ev_total', { total: evTotal }),
      });
    }

    // IVs: a whole number from 0 to 31; an absent stat is the default (31).
    for (const stat of STAT_KEYS) {
      const val = set.ivs[stat];
      if (val === undefined || val === null) continue;
      if (typeof val !== 'number' || !Number.isInteger(val) || val < 0 || val > MAX_IV) {
        issues.push({
          pokemon_index: i,
          species: species.name,
          issue: `${stat} IVs (${String(val)}) must be a whole number from 0 to ${MAX_IV}`,
          severity: 'error',
          ...codedIssue('iv_range', { stat, value: typeof val === 'number' ? val : String(val) }),
        });
      }
    }

    // Level: a whole number from 1 to 100; an absent level is the default (100).
    if (set.level !== undefined && set.level !== null) {
      const level = set.level;
      if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 100) {
        issues.push({
          pokemon_index: i,
          species: species.name,
          issue: `Level (${String(level)}) must be a whole number from 1 to 100`,
          severity: 'error',
          ...codedIssue('level_range', { value: typeof level === 'number' ? level : String(level) }),
        });
      }
    }
  }

  // ── Clause checks ──────────────────────────────────────────────────
  if (rules.clauses.includes(SPECIES_CLAUSE)) {
    const seen = new Map<string, number>();
    for (let i = 0; i < pokemon.length; i++) {
      const member = sets[i];
      const species = member ? resolveSpecies(member.species) : undefined;
      if (!species) continue;
      // Species Clause keys on base species (e.g. Rotom-Wash → Rotom)
      const baseSpecies = species.baseSpecies ?? species.name;
      const key = baseSpecies.toLowerCase();
      const firstIndex = seen.get(key);
      if (firstIndex !== undefined) {
        teamIssues.push({
          issue: `Species Clause: duplicate ${baseSpecies} (slots ${firstIndex + 1} and ${i + 1})`,
          ...codedIssue('species_clause', { species: baseSpecies, slotA: firstIndex + 1, slotB: i + 1 }),
        });
      } else {
        seen.set(key, i);
      }
    }
  }

  // Duplicate item check (Item Clause — not standard in most formats, but supported). The canonical item id decides,
  // so `Choice Scarf`, `choicescarf` and `choice-scarf` are one item; an item the dex does not know is compared by
  // its own id.
  if (rules.clauses.includes(ITEM_CLAUSE)) {
    const seenItems = new Map<string, number>();
    for (let i = 0; i < pokemon.length; i++) {
      const member = sets[i];
      if (!member || !member.item) continue;
      const shown = resolveItem(member.item)?.name ?? member.item;
      const key = toID(shown);
      if (key === '') continue;
      const firstIndex = seenItems.get(key);
      if (firstIndex !== undefined) {
        teamIssues.push({
          issue: `Item Clause: duplicate ${shown} (slots ${firstIndex + 1} and ${i + 1})`,
          ...codedIssue('item_clause', { item: shown, slotA: firstIndex + 1, slotB: i + 1 }),
        });
      } else {
        seenItems.set(key, i);
      }
    }
  }

  // ── Shared type check (relaxed monotype) ─────────────────────────
  if (rules.min_shared_type_pct > 0) {
    const required = Math.round(pokemon.length * rules.min_shared_type_pct / 100);
    const typeCounts = new Map<string, number>();
    for (const member of sets) {
      const species = member ? resolveSpecies(member.species) : undefined;
      if (!species) continue;
      for (const t of species.types) {
        typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
      }
    }
    const counts = Array.from(typeCounts.entries());
    const bestCount = counts.reduce((max, [, c]) => Math.max(max, c), 0);
    if (bestCount < required) {
      const bestType = counts.find(([, c]) => c === bestCount)?.[0] ?? 'any';
      teamIssues.push({
        issue:
          `Shared Type rule: at least ${required} of ${pokemon.length} Pokémon must share a type (${rules.min_shared_type_pct}%), ` +
          `but the most common type (${bestType}) only covers ${bestCount}`,
        ...codedIssue('shared_type', {
          required,
          total: pokemon.length,
          pct: rules.min_shared_type_pct,
          type: bestType,
          covered: bestCount,
        }),
      });
    }
  }

  // ── Team Constraints engine ───────────────────────────────────────
  if (rules.team_constraints) {
    enforceTeamConstraints(
      sets,
      rules.team_constraints,
      { gen, universe: national ? 'national' : 'standard', resolveSpecies },
      ctx.playerCore ?? null,
      issues,
      teamIssues,
    );
  }

  // ── Draft ownership check ─────────────────────────────────────────
  if (ctx.draftedPokemon) {
    teamIssues.push(...draftOwnershipIssues(pokemon, ctx.draftedPokemon));
  }

  const valid = issues.every(i => i.severity !== 'error') && teamIssues.length === 0;
  return { valid, issues, ...teamIssueFields(teamIssues) };
}

// ── Team Constraints implementation ─────────────────────────────────

/**
 * What the constraint engine needs of the ruleset's universe: the generation, the universe (the fully-evolved and
 * legendary reads follow it) and the universe-aware species resolver the rest of the validator uses. A National Dex
 * ruleset resolves a Mega Evolution or a past-generation species; the standard `getSpecies` would not, and the rules
 * below (fully-evolved cap, legendary ban, type quotas, Eviolite) would skip exactly those Pokémon.
 */
interface ConstraintScope {
  gen: number;
  universe: 'standard' | 'national';
  resolveSpecies: (name: string) => ResolvedSpecies | undefined;
}

/** The members of a species the engine reads. */
interface ResolvedSpecies {
  name: string;
  types: readonly string[];
  tier?: unknown;
  natDexTier?: unknown;
}

/** The tier a ruleset's universe ranks a species by: `tier` in the standard generation, `natDexTier` in the National Dex. */
function tierOf(species: ResolvedSpecies, universe: 'standard' | 'national'): string | undefined {
  const field = universe === 'national' ? (species.natDexTier ?? species.tier) : species.tier;
  return typeof field === 'string' ? field : undefined;
}

function enforceTeamConstraints(
  sets: (ReadSet | null)[],
  constraints: TeamConstraints,
  scope: ConstraintScope,
  playerCore: CoreTriple | null,
  issues: SetIssue[],
  teamIssues: TeamIssue[],
): void {
  const { gen, universe, resolveSpecies } = scope;
  // ── 1. Type quotas ────────────────────────────────────────────────
  if (constraints.type_quotas) {
    const quota = constraints.type_quotas;
    let coreTypes: string[] | null = null;
    if (quota.source === 'player_core') {
      if (!playerCore || playerCore.length !== 3) {
        teamIssues.push({
          issue: 'Type quota rule requires a player core to be assigned for this season',
          ...codedIssue('type_quota_no_core'),
        });
      } else {
        coreTypes = [...playerCore];
      }
    } else if (quota.source === 'fixed') {
      coreTypes = quota.fixed_types ?? [];
    }

    if (coreTypes && coreTypes.length > 0) {
      const counts = new Map<string, number>();
      for (const t of coreTypes) counts.set(t, 0);

      for (const set of sets) {
        const species = set ? resolveSpecies(set.species) : undefined;
        if (!species) continue;
        if (quota.allow_multi_count) {
          for (const t of species.types) {
            if (counts.has(t)) counts.set(t, (counts.get(t) ?? 0) + 1);
          }
        } else {
          const primary = species.types[0];
          if (primary && counts.has(primary)) {
            counts.set(primary, (counts.get(primary) ?? 0) + 1);
          }
        }
      }

      for (const [type, count] of counts) {
        if (count < quota.min_per_type) {
          teamIssues.push({
            issue: `Type quota: need at least ${quota.min_per_type} ${type}-type Pokémon, have ${count}`,
            ...codedIssue('type_quota', { min: quota.min_per_type, type, have: count }),
          });
        }
      }
    }
  }

  // ── 2. Tera match ────────────────────────────────────────────────
  if (constraints.tera_match && constraints.tera_match !== 'none') {
    for (let i = 0; i < sets.length; i++) {
      const set = sets[i];
      if (!set || !set.tera_type) continue; // no tera set = nothing to check
      const species = resolveSpecies(set.species);
      if (!species) continue;

      if (constraints.tera_match === 'player_core') {
        if (!playerCore) {
          // single team-level message; avoid duplicating per slot
          if (!teamIssues.some((m) => m.code === 'tera_match_no_core')) {
            teamIssues.push({
              issue: 'Tera match rule requires a player core to be assigned for this season',
              ...codedIssue('tera_match_no_core'),
            });
          }
          continue;
        }
        if (!playerCore.includes(set.tera_type)) {
          issues.push({
            pokemon_index: i,
            species: species.name,
            issue: `Tera type ${set.tera_type} must match one of your core types (${playerCore.join(' / ')})`,
            severity: 'error',
            ...codedIssue('tera_core_mismatch', { type: set.tera_type, types: playerCore.join('/') }),
          });
        }
      } else if (constraints.tera_match === 'team_types') {
        if (!(species.types as readonly string[]).includes(set.tera_type)) {
          issues.push({
            pokemon_index: i,
            species: species.name,
            issue: `Tera type ${set.tera_type} must match one of ${species.name}'s types (${species.types.join(' / ')})`,
            severity: 'error',
            ...codedIssue('tera_type_mismatch', { type: set.tera_type, species: species.name, types: species.types.join('/') }),
          });
        }
      }
    }
  }

  // ── 3. Evolution stage ────────────────────────────────────────────
  if (constraints.evolution_stage && constraints.evolution_stage.mode === 'nfe_only_plus_n_fe') {
    const stage = constraints.evolution_stage;
    const cap = stage.fully_evolved_cap ?? 0;
    const tierMax = stage.fully_evolved_tier_max ?? null;
    const legendariesAllowed = stage.legendaries_allowed ?? false;

    let feCount = 0;
    for (let i = 0; i < sets.length; i++) {
      const member = sets[i];
      const species = member ? resolveSpecies(member.species) : undefined;
      if (!species) continue;

      if (!legendariesAllowed && isLegendary(species.name, gen, universe)) {
        issues.push({
          pokemon_index: i,
          species: species.name,
          issue: `${species.name} is a legendary and is not allowed in this phase`,
          severity: 'error',
          ...codedIssue('legendary_phase', { species: species.name }),
        });
      }

      if (isFullyEvolved(species.name, gen, universe)) {
        feCount++;
        const rawTier = tierOf(species, universe);
        const tier = normalizeTier(rawTier);
        if (tierMax && tier && compareTier(tier, tierMax) > 0) {
          issues.push({
            pokemon_index: i,
            species: species.name,
            issue:
              `${species.name} is fully evolved and its tier (${rawTier}) is above the ` +
              `phase cap (${tierMax})`,
            severity: 'error',
            ...codedIssue('fe_tier_above_cap', { species: species.name, tier: String(rawTier), cap: tierMax }),
          });
        } else if (tierMax && !tier) {
          // Unrankable FE (e.g. CAP / Illegal) — block defensively
          issues.push({
            pokemon_index: i,
            species: species.name,
            issue: `${species.name} has no recognised competitive tier; not allowed in NFE phase`,
            severity: 'error',
            ...codedIssue('fe_no_tier', { species: species.name }),
          });
        }
      }
    }

    if (feCount > cap) {
      teamIssues.push({
        issue: `Evolution stage rule: at most ${cap} fully-evolved Pokémon allowed in this phase, found ${feCount}`,
        ...codedIssue('evolution_stage_cap', { cap, found: feCount }),
      });
    }
  } else if (constraints.evolution_stage && constraints.evolution_stage.mode === 'unrestricted') {
    // Even in unrestricted mode we may still block legendaries explicitly.
    if (constraints.evolution_stage.legendaries_allowed === false) {
      for (let i = 0; i < sets.length; i++) {
        const member = sets[i];
        const species = member ? resolveSpecies(member.species) : undefined;
        if (!species) continue;
        if (isLegendary(species.name, gen, universe)) {
          issues.push({
            pokemon_index: i,
            species: species.name,
            issue: `${species.name} is a legendary and is not allowed`,
            severity: 'error',
            ...codedIssue('legendary', { species: species.name }),
          });
        }
      }
    }
  }

  // ── 4. Eviolite tier cap ──────────────────────────────────────────
  if (constraints.eviolite_tier_cap) {
    const cap: TierKey = constraints.eviolite_tier_cap;
    // The banned set is a scan of the whole dex (memoised per generation and cap): it is read only when a set holds
    // Eviolite, so a team without one never pays for it.
    let banned: ReadonlySet<string> | null = null;

    for (let i = 0; i < sets.length; i++) {
      const set = sets[i];
      if (!set || toID(set.item) !== 'eviolite') continue;
      const species = resolveSpecies(set.species);
      if (!species) continue;
      banned ??= computeEvioliteBannedSpecies(gen, cap, universe);
      if (banned.has(species.name.toLowerCase())) {
        issues.push({
          pokemon_index: i,
          species: species.name,
          issue:
            `${species.name} cannot hold Eviolite: its evolution is above the ` +
            `${cap} tier cap`,
          severity: 'error',
          ...codedIssue('eviolite_tier_cap', { species: species.name, item: 'Eviolite', cap }),
        });
      }
    }
  }
}
