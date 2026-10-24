import type { TeamConstraints } from '@/types/ruleset';

// Client-safe helpers for the optional team-constraints block of a ruleset.
// No dex import, so 'use client' modules (the ruleset builder) can use it.

/**
 * True when the block carries no rule: `null` / `undefined`, or an object whose
 * every own value is `undefined` or `null` (so `{}` and `{ tera_match: undefined }`).
 */
export function isEmptyTeamConstraints(value: TeamConstraints | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  return Object.values(value).every((v) => v === undefined || v === null);
}

/**
 * The value to store: `null` for an empty block, otherwise a copy without the
 * `undefined` / `null` keys (the input is never mutated).
 */
export function normalizeTeamConstraints(value: TeamConstraints | null | undefined): TeamConstraints | null {
  if (value === null || value === undefined || isEmptyTeamConstraints(value)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v !== undefined && v !== null) out[key] = v;
  }
  return out as TeamConstraints;
}
