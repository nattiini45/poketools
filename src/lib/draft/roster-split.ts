/**
 * Can a fixed-price pool list fill every roster? Every Pokémon goes to one trainer only, each trainer takes exactly
 * `rounds` of them, and a trainer's picks must cost at most `budget` together. The cheapest `players × rounds`
 * entries are the best candidates (swapping one for a cheaper one never breaks a split), so the question is whether
 * those prices split into `players` groups of `rounds` with every group at or under `budget`.
 *
 * That is a bin-packing question, so the search is bounded: `'yes'` is a found split, `'no'` is a proof (the search
 * ran dry), and `'unknown'` means the node limit ran out first. The pool-creation route creates only on `'yes'`.
 * The search deals the biggest price first, into the least loaded roster first, so a pool with room to spare is
 * solved on the first descent; `'unknown'` is left for a list that is close to the limit and large.
 */
export type RosterSplit = 'yes' | 'no' | 'unknown';

export const ROSTER_SPLIT_NODE_LIMIT = 300_000;

export function splitIntoRosters(
  ascendingPrices: readonly number[],
  players: number,
  rounds: number,
  budget: number,
  nodeLimit: number = ROSTER_SPLIT_NODE_LIMIT,
): RosterSplit {
  const needed = players * rounds;
  if (players < 1 || rounds < 1) return 'yes';
  if (ascendingPrices.length < needed) return 'no';

  const items = ascendingPrices.slice(0, needed).reverse();
  if (items[0] > budget) return 'no';
  const cheapest = items[needed - 1];

  const sums = new Array<number>(players).fill(0);
  const counts = new Array<number>(players).fill(0);
  let free = players * budget;
  let remaining = items.reduce((total, price) => total + price, 0);
  let nodes = 0;
  let exhausted = false;

  const place = (index: number): boolean => {
    if (index === needed) return true;
    if (++nodes > nodeLimit) {
      exhausted = true;
      return false;
    }
    // The points still to spend can never exceed the points the rosters have left.
    if (remaining > free) return false;
    // Every roster still has to take its open slots, and no Pokémon left costs less than the cheapest one.
    for (let g = 0; g < players; g++) {
      if (sums[g] + (rounds - counts[g]) * cheapest > budget) return false;
    }
    const price = items[index];
    const order = Array.from({ length: players }, (_, g) => g).sort((a, b) => sums[a] - sums[b]);
    const tried = new Set<string>();
    for (const g of order) {
      if (counts[g] >= rounds || sums[g] + price > budget) continue;
      // Rosters in the same state are interchangeable: one of them is enough.
      const state = `${sums[g]}:${counts[g]}`;
      if (tried.has(state)) continue;
      tried.add(state);
      sums[g] += price;
      counts[g] += 1;
      free -= price;
      remaining -= price;
      const done = place(index + 1);
      sums[g] -= price;
      counts[g] -= 1;
      free += price;
      remaining += price;
      if (done) return true;
      if (exhausted) return false;
    }
    return false;
  };

  if (place(0)) return 'yes';
  return exhausted ? 'unknown' : 'no';
}
