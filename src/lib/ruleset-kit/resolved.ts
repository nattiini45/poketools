/**
 * Reads the stored `resolved` column of a version back into `ResolvedRules`. The column is written by `ruleset_publish_version`
 * (from the compile) or by the SQL conversion of a legacy row, so a malformed value means a corrupt database, not bad
 * input: the reader is strict about the members the validator reads (the lists and the numbers) and throws a descriptive
 * `Error` instead of guessing. Pure and client-safe.
 */
import type { TeamConstraints } from '@/types/ruleset';
import type { ResolvedList, ResolvedRules, RulesetUniverse } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`resolved rules: ${what} must be a list of strings`);
  }
  return value as string[];
}

function list(value: unknown, what: string): ResolvedList {
  if (!isRecord(value) || (value.mode !== 'block' && value.mode !== 'allow')) {
    throw new Error(`resolved rules: ${what} must be { mode: 'block' | 'allow', ids }`);
  }
  return { mode: value.mode, ids: stringArray(value.ids, `${what}.ids`) };
}

/** The stored resolved rules of a version, or a thrown `Error` for a corrupt value. */
export function readResolvedRules(value: unknown): ResolvedRules {
  if (!isRecord(value) || value.v !== 1) throw new Error('resolved rules: unsupported or missing version');
  const gen = value.gen;
  if (typeof gen !== 'number' || !Number.isInteger(gen) || gen < 1 || gen > 9) throw new Error('resolved rules: gen must be 1 to 9');
  if (typeof value.format_key !== 'string') throw new Error('resolved rules: format_key must be a string');
  if (value.universe !== 'standard' && value.universe !== 'national') throw new Error('resolved rules: bad universe');
  if (typeof value.doubles !== 'boolean') throw new Error('resolved rules: doubles must be a boolean');
  const pct = value.min_shared_type_pct;
  if (typeof pct !== 'number' || !Number.isFinite(pct)) throw new Error('resolved rules: min_shared_type_pct must be a number');
  const constraints = value.team_constraints;
  if (constraints !== null && constraints !== undefined && !isRecord(constraints)) {
    throw new Error('resolved rules: team_constraints must be an object or null');
  }
  return {
    v: 1,
    gen,
    format_key: value.format_key,
    universe: value.universe as RulesetUniverse,
    doubles: value.doubles,
    clauses: stringArray(value.clauses, 'clauses'),
    pokemon: list(value.pokemon, 'pokemon'),
    moves: list(value.moves, 'moves'),
    items: list(value.items, 'items'),
    abilities: list(value.abilities, 'abilities'),
    added_pokemon: value.added_pokemon === undefined ? [] : stringArray(value.added_pokemon, 'added_pokemon'),
    min_shared_type_pct: pct,
    team_constraints: (constraints ?? null) as TeamConstraints | null,
    custom_rules: typeof value.custom_rules === 'string' ? value.custom_rules : '',
  };
}
