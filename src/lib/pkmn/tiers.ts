import { getGeneration, getSpecies } from './dex';
import type { TierKey } from '@/types/ruleset';
import { formatPack } from '@/lib/format-pack';
import { SINGLES_TIER_ORDER, DOUBLES_TIER_ORDER } from './tier-constants';

// ── Tier hierarchies ────────────────────────────────────────────────
// Ordered lowest → highest. For a given tier, all tiers ABOVE it are banned.
// The order arrays live in the dependency-free `./tier-constants` module so
// they can also be used client-side; re-exported here to keep this module's
// existing public API stable.
//
// 'ZU' is the lowest standard singles tier (newer PS data exposes it directly;
// older data uses '(PU)' as the equivalent "unused in PU" parenthesised tier).

export { SINGLES_TIER_ORDER };

// Tiers that represent cosmetic/alternate forms — skip these
const SKIP_TIERS = new Set(['(PU)', '(NU)', '(RU)', '(UU)', '(OU)', '(Uber)', 'Illegal', 'Unreleased']);

// ── Query functions ─────────────────────────────────────────────────

/**
 * Get all species names in tiers ABOVE the given tier in the hierarchy.
 * For 'OU', returns all Pokemon in Uber + AG tiers.
 * For 'UU', returns all Pokemon in UUBL + OU + Uber + AG tiers.
 */
export function getBannedPokemonForTier(
  tierKey: string,
  gen: number = 9,
  tierField: 'tier' | 'doublesTier' | 'natDexTier' = 'tier',
): string[] {
  const hierarchy = tierField === 'doublesTier'
    ? DOUBLES_TIER_ORDER
    : SINGLES_TIER_ORDER;

  const tierIndex = hierarchy.indexOf(tierKey);
  if (tierIndex === -1) return [];

  // Collect all tiers above this one
  const bannedTiers = new Set<string>();
  for (let i = tierIndex + 1; i < hierarchy.length; i++) {
    bannedTiers.add(hierarchy[i]);
  }

  const generation = getGeneration(gen);
  const banned: string[] = [];

  for (const species of Array.from(generation.species)) {
    const t = species[tierField];
    if (typeof t === 'string' && bannedTiers.has(t) && !SKIP_TIERS.has(t)) {
      banned.push(species.name);
    }
  }

  return banned.sort();
}

// ── Constraint engine helpers ───────────────────────────────────────

/**
 * Normalise a raw `species.tier` string to a TierKey or null.
 *
 * Parenthesised tiers (e.g. `(PU)`) historically meant "unused in this tier"
 * and are treated as ZU for the constraint engine. `NFE` / `LC` and similar
 * non-hierarchy markers normalise to null (no comparable rank).
 */
export function normalizeTier(raw: string | undefined | null): TierKey | null {
  if (!raw) return null;
  if (SINGLES_TIER_ORDER.includes(raw)) return raw as TierKey;
  // (PU), (NU), (OU)… → ZU for ranking purposes
  if (raw.startsWith('(') && raw.endsWith(')')) return 'ZU';
  return null;
}

/** Compare two TierKeys using the singles hierarchy. Returns -1, 0, 1. */
export function compareTier(a: TierKey, b: TierKey): number {
  const ai = SINGLES_TIER_ORDER.indexOf(a);
  const bi = SINGLES_TIER_ORDER.indexOf(b);
  if (ai === -1 || bi === -1) return 0;
  return Math.sign(ai - bi);
}

/**
 * Walk a species' entire forward evolution chain and return the highest tier
 * encountered (in the singles hierarchy). Returns null when nothing rank-able
 * is found (e.g. the chain only contains LC / NFE / illegal forms).
 *
 * Stops at the first branch with > 1 evos? No — branches are explored fully
 * because the Eviolite ban must consider every reachable evolution.
 */
function getHighestEvoTier(name: string, gen: number = 9): TierKey | null {
  const start = getSpecies(name, gen);
  if (!start) return null;

  let best: TierKey | null = null;
  const visited = new Set<string>();
  const queue: string[] = [...(start.evos ?? [])];

  while (queue.length > 0) {
    const next = queue.shift()!;
    if (visited.has(next)) continue;
    visited.add(next);

    const evo = getSpecies(next, gen);
    if (!evo) continue;

    const tier = normalizeTier(evo.tier as string | undefined);
    if (tier && (best === null || compareTier(tier, best) > 0)) {
      best = tier;
    }
    if (evo.evos) queue.push(...evo.evos);
  }

  return best;
}

/**
 * Build the set of NFE species (by canonical name, lowercased) whose forward
 * evolution chain contains at least one tier strictly above `capTier`.
 *
 * Used to enforce the Core Liga "no Eviolite on NFEs whose evolution is above
 * the cap" rule. The species themselves remain legal; only their Eviolite item is
 * blocked. Callers pass the ruleset's stored cap; the default cap comes from the
 * format pack (`coreLiga.evioliteCapTierDefault`).
 */
export function computeEvioliteBannedSpecies(
  gen: number = 9,
  capTier: TierKey = formatPack.coreLiga.evioliteCapTierDefault,
): Set<string> {
  const out = new Set<string>();
  const generation = getGeneration(gen);

  for (const species of Array.from(generation.species)) {
    if (!species.evos || species.evos.length === 0) continue;
    if (species.isNonstandard) continue;

    const highest = getHighestEvoTier(species.name, gen);
    if (highest && compareTier(highest, capTier) > 0) {
      out.add(species.name.toLowerCase());
    }
  }

  return out;
}
