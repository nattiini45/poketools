/**
 * Pure helpers of the seeding table: what the admin sees (the list order and
 * the typed numbers) and what Save writes are derived here, so they cannot
 * disagree.
 */
import type { BracketType } from '@/types/tournament';

export type StartingBracket = 'winners' | 'losers';

export interface SeedPayloadEntry {
  player_id: string;
  seed: number | null;
  starting_bracket?: StartingBracket;
}

/**
 * Moves the entry at `from` to `to`. Returns the same array reference when the
 * move is a no-op or out of range, so callers can skip a state update.
 */
export function reorderIds(ids: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) {
    return ids;
  }
  const next = [...ids];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Seeds 1..n by list position, as strings (the shape of the number inputs). */
export function seedsFromOrder(ids: readonly string[]): Record<string, string> {
  const edits: Record<string, string> = {};
  ids.forEach((id, index) => {
    edits[id] = String(index + 1);
  });
  return edits;
}

function validSeed(raw: string | undefined): number | null {
  const text = raw?.trim();
  if (!text) return null;
  // Same parse as the payload, so the list order matches what Save writes.
  const value = parseInt(text, 10);
  return Number.isNaN(value) || value < 1 ? null : value;
}

/**
 * Orders rows with a valid positive integer seed first (ascending). Ties and
 * unseeded rows (empty or invalid text) keep their current relative order.
 */
export function sortBySeedEdits(ids: readonly string[], seedEdits: Readonly<Record<string, string>>): string[] {
  const seeded: { id: string; seed: number; index: number }[] = [];
  const unseeded: string[] = [];
  ids.forEach((id, index) => {
    const seed = validSeed(seedEdits[id]);
    if (seed === null) unseeded.push(id);
    else seeded.push({ id, seed, index });
  });
  seeded.sort((a, b) => a.seed - b.seed || a.index - b.index);
  return [...seeded.map((row) => row.id), ...unseeded];
}

/**
 * The PATCH `seeds` array in list order. The seed is `parseInt` of the trimmed
 * text and null when empty; NaN and values below 1 pass through so the caller's
 * validation can report them. `starting_bracket` is sent for double elimination only.
 */
export function buildSeedPayload(
  orderedIds: readonly string[],
  seedEdits: Readonly<Record<string, string>>,
  startingBrackets: Readonly<Record<string, StartingBracket>>,
  bracketType: BracketType | null
): SeedPayloadEntry[] {
  return orderedIds.map((player_id) => {
    const raw = seedEdits[player_id]?.trim();
    const entry: SeedPayloadEntry = { player_id, seed: raw ? parseInt(raw, 10) : null };
    if (bracketType === 'double_elim') {
      entry.starting_bracket = startingBrackets[player_id] ?? 'winners';
    }
    return entry;
  });
}
