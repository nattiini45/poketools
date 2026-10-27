/**
 * The random opening order of a queue draft (server only: it draws with Node's CSPRNG).
 *
 * `drawSeatOrder` is a Fisher-Yates shuffle over a copy of the ids, so the caller's array is untouched. The draw
 * is what the seats become (seat 1 first); the snake then runs from them, so this is the only random step of a
 * queue draft's order. `legacySeatOrder` (`engine.ts`) is not a substitute: it is a deterministic hash of the pool
 * id and would give the same "roll" on every request.
 */
import { randomInt as cryptoRandomInt } from 'node:crypto';

/** `randomInt(maxExclusive)` = an integer in `[0, maxExclusive)`; the injection point for tests. */
export type RandomInt = (maxExclusive: number) => number;

const secureRandomInt: RandomInt = (maxExclusive) => cryptoRandomInt(maxExclusive);

/** A uniformly random permutation of `ids` (seat 1 first). */
export function drawSeatOrder(ids: readonly string[], randomInt: RandomInt = secureRandomInt): string[] {
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
