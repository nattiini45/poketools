/**
 * The clause catalog: every battle clause a preset or a ruleset can carry, by id. Pure and client-safe (the only
 * import is the dependency-free id fold).
 *
 * A clause id is `toID` of the Pokémon Showdown rule name (`Sleep Clause Mod` is `sleepclausemod`), so ids and
 * names convert both ways without a table. Names are Showdown's own spelling and stay English in every language.
 * The legacy ruleset builder wrote `Batonpass Clause`; it folds to the same id as `Baton Pass Clause`, so stored
 * names of either spelling find the same entry.
 *
 * Enforcement is stated per clause and is the truth, not a wish: `validateTeam` (`./validation.ts`) checks the
 * Species Clause (no base species twice) and the Item Clause (no item twice) and nothing else. Every other clause
 * is `informational`: it is shown on the rules page and carried into the battle by the players, but the app does
 * not enforce it (the ban-style clauses, such as OHKO or Evasion, are NOT expanded into move bans; see
 * `docs/ruleset-presets.md`). A UI that lists clauses marks the informational ones as such.
 */
import { toID } from './i18n/id';

export type ClauseEnforcement = 'validator' | 'informational';

export interface ClauseInfo {
  /** `toID(name)`. */
  id: string;
  /** Showdown's name of the rule. */
  name: string;
  enforcement: ClauseEnforcement;
  /** The only generation the clause exists in; absent for a clause that is not tied to one. */
  gen?: number;
}

function clause(name: string, enforcement: ClauseEnforcement = 'informational', gen?: number): ClauseInfo {
  return gen === undefined ? { id: toID(name), name, enforcement } : { id: toID(name), name, enforcement, gen };
}

/** Every clause the catalog knows, in the order a clause list shows them. */
export const CLAUSES: readonly ClauseInfo[] = [
  clause('Species Clause', 'validator'),
  clause('Item Clause', 'validator'),
  clause('Sleep Clause Mod'),
  clause('OHKO Clause'),
  clause('Evasion Clause'),
  clause('Evasion Abilities Clause'),
  clause('Evasion Items Clause'),
  clause('Evasion Moves Clause'),
  clause('Endless Battle Clause'),
  clause('Moody Clause'),
  clause('Dynamax Clause', 'informational', 8),
  clause('Terastal Clause', 'informational', 9),
  clause('Tera Type Preview', 'informational', 9),
  clause('Baton Pass Clause'),
  clause('Nickname Clause'),
  clause('Gravity Sleep Clause'),
  clause('Accuracy Moves Clause'),
  clause('Sleep Moves Clause'),
  clause('DryPass Clause'),
  clause('Gems Clause'),
  clause('Same Type Clause'),
  clause('Freeze Clause Mod'),
  clause('One Boost Passer Clause'),
  clause('Baton Pass Trap Clause'),
  clause('Mega Rayquaza Clause'),
];

const BY_ID: ReadonlyMap<string, ClauseInfo> = new Map(CLAUSES.map((c) => [c.id, c]));

/** The id of a clause name (`Sleep Clause Mod` to `sleepclausemod`); an id folds to itself. */
export function clauseId(name: string): string {
  return toID(name);
}

/** The clause an id or a name stands for, or `undefined` for a clause the catalog does not know. */
export function getClause(idOrName: string): ClauseInfo | undefined {
  return BY_ID.get(toID(idOrName));
}

/** Showdown's name of a clause id; an id the catalog does not know comes back unchanged. */
export function clauseName(idOrName: string): string {
  return getClause(idOrName)?.name ?? idOrName;
}

/** Whether the validator enforces the clause (Species Clause and Item Clause only). */
export function isEnforcedClause(idOrName: string): boolean {
  return getClause(idOrName)?.enforcement === 'validator';
}
