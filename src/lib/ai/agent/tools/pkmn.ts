/**
 * Deterministic @pkmn-backed agent tools (PRD §5, Layer 1):
 *   - lookupPokemon  — types, base stats, abilities, weight, tier, movepool size
 *   - getTypeChart   — effectiveness matrix vs a defending type combo
 *   - getLearnset    — learnable moves grouped by learn method
 *
 * All three reuse the singleton `Generations(Dex)` wrappers in
 * `src/lib/pkmn/dex.ts` (never re-instantiate `Generations`). Results are pure
 * JSON-serializable objects and memoized in a 24h in-memory LRU cache, since
 * the underlying dex data is deterministic per generation.
 */
import { getGeneration, getSpecies, getLegalAbilities } from '@/lib/pkmn/dex';
import { LruCache } from '@/lib/utils/lru-cache';
import {
  type LookupPokemonInput,
  type GetTypeChartInput,
  type GetLearnsetInput,
} from './schemas';

// ─── 24h in-memory LRU cache ─────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CACHE_MAX_ENTRIES = 500;

const cache = new LruCache({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX_ENTRIES });

// ─── Result shapes ───────────────────────────────────────────────────

export interface LookupPokemonResult {
  species: string;
  gen: number;
  types: string[];
  baseStats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  abilities: string[];
  weight_kg: number;
  tier: string | null;
  /** Count of moves the species can learn in this generation (movepool size). */
  notable_moves_count: number;
}

export interface GetTypeChartResult {
  types: string[];
  gen: number;
  /** Attacking type name → combined effectiveness multiplier (0, 0.25, 0.5, 1, 2, 4). */
  effectiveness: Record<string, number>;
}

export interface GetLearnsetResult {
  species: string;
  gen: number;
  /** Learn method → sorted move names. */
  moves: Record<string, string[]>;
}

// ─── Learn-method letter map (MoveSource format: "<gen><method><...>") ──

const METHOD_NAMES: Record<string, string> = {
  L: 'level-up',
  M: 'machine',
  T: 'tutor',
  E: 'egg',
  S: 'event',
  D: 'dream-world',
  V: 'virtual-console',
};

// ─── lookupPokemon ───────────────────────────────────────────────────

export async function lookupPokemon(input: LookupPokemonInput): Promise<LookupPokemonResult | null> {
  const gen = input.gen ?? 9;
  const key = `lookup:${gen}:${input.species.toLowerCase()}`;
  const cached = cache.get<LookupPokemonResult | null>(key);
  if (cached !== undefined) return cached;

  const species = getSpecies(input.species, gen);
  if (!species || !species.exists) {
    cache.set(key, null);
    return null;
  }

  const abilities = getLegalAbilities(species.name, gen).map((a) => a.name);
  const learnable = await getGeneration(gen).learnsets.learnable(species.name);
  const tier = typeof species.tier === 'string' && species.tier.length > 0 ? species.tier : null;

  const result: LookupPokemonResult = {
    species: species.name,
    gen,
    types: species.types.slice(),
    baseStats: { ...species.baseStats },
    abilities,
    weight_kg: species.weightkg,
    tier,
    notable_moves_count: learnable ? Object.keys(learnable).length : 0,
  };

  cache.set(key, result);
  return result;
}

// ─── getTypeChart ────────────────────────────────────────────────────

/**
 * Combined effectiveness of every attacking type against the defending combo,
 * computed from @pkmn/data `damageTaken` (0 = neutral, 1 = weak, 2 = resist,
 * 3 = immune) so the chart is never hardcoded.
 */
export function getTypeChart(input: GetTypeChartInput): GetTypeChartResult {
  const gen = input.gen ?? 9;
  const key = `typechart:${gen}:${input.types.join('/').toLowerCase()}`;
  const cached = cache.get<GetTypeChartResult>(key);
  if (cached !== undefined) return cached;

  const generation = getGeneration(gen);
  const effectiveness: Record<string, number> = {};

  for (const attackType of Array.from(generation.types)) {
    let multiplier = 1;
    for (const defType of input.types) {
      const defTypeData = generation.types.get(defType);
      if (!defTypeData) continue;
      const damageTaken = (defTypeData as unknown as { damageTaken: Record<string, number> }).damageTaken;
      const code = damageTaken[attackType.name] ?? 0;
      if (code === 1) multiplier *= 2; // weak
      else if (code === 2) multiplier *= 0.5; // resist
      else if (code === 3) multiplier *= 0; // immune
    }
    effectiveness[attackType.name] = multiplier;
  }

  const result: GetTypeChartResult = { types: input.types.slice(), gen, effectiveness };
  cache.set(key, result);
  return result;
}

// ─── getLearnset ─────────────────────────────────────────────────────

export async function getLearnset(input: GetLearnsetInput): Promise<GetLearnsetResult | null> {
  const gen = input.gen ?? 9;
  const key = `learnset:${gen}:${input.species.toLowerCase()}`;
  const cached = cache.get<GetLearnsetResult | null>(key);
  if (cached !== undefined) return cached;

  const generation = getGeneration(gen);
  const species = generation.species.get(input.species);
  if (!species) {
    cache.set(key, null);
    return null;
  }

  // `learnable()` already folds in pre-evolution moves and returns each move's
  // source strings (e.g. "9M", "9L1"), which we group by learn method.
  const learnable = await generation.learnsets.learnable(species.name);
  const groups: Record<string, Set<string>> = {};

  if (learnable) {
    for (const [moveId, sources] of Object.entries(learnable)) {
      const move = generation.moves.get(moveId);
      if (!move) continue;
      const methods = new Set<string>();
      for (const source of sources) {
        const letter = source.charAt(1);
        methods.add(METHOD_NAMES[letter] ?? 'other');
      }
      for (const method of methods) {
        (groups[method] ??= new Set<string>()).add(move.name);
      }
    }
  }

  const moves: Record<string, string[]> = {};
  for (const [method, names] of Object.entries(groups)) {
    moves[method] = Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  const result: GetLearnsetResult = { species: species.name, gen, moves };
  cache.set(key, result);
  return result;
}

// ─── Test-only cache reset ───────────────────────────────────────────

/** Clear the in-memory cache. Intended for unit tests only. */
export function __clearPkmnToolCache(): void {
  cache.clear();
}
