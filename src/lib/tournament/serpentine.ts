/**
 * Serpentine (snake) group assignment from seeds.
 * Seed 1 → group A, 2 → B, 3 → B, 4 → A for two groups, etc.
 */
export function assignSerpentine(
  seeds: Array<{ player_id: string; seed: number }>,
  groupCount: number
): Map<number, string[]> {
  if (groupCount < 1) {
    throw new Error('groupCount must be at least 1');
  }

  const sorted = [...seeds].sort((a, b) => a.seed - b.seed);
  const buckets = new Map<number, string[]>();
  for (let g = 0; g < groupCount; g++) {
    buckets.set(g, []);
  }

  for (let i = 0; i < sorted.length; i++) {
    const round = Math.floor(i / groupCount);
    const posInRound = i % groupCount;
    const groupIndex =
      round % 2 === 0 ? posInRound : groupCount - 1 - posInRound;
    buckets.get(groupIndex)!.push(sorted[i].player_id);
  }

  return buckets;
}

/** Group labels: A, B, … Z, AA, AB, … */
export function groupLabel(index: number): string {
  let n = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}
