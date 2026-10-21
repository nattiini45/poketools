/**
 * Pool completability (the pool gate). Client-safe and pure: no `@pkmn/*`, no Supabase, no `next/*`.
 *
 * A draft pool is completable when every participant can still fill every open roster slot at the same time: distinct
 * free lines, each line only for a participant allowed to take it, and each participant's lines summing to at most
 * their remaining budget. The queue engine keeps every pool completable at all times, so the player on the clock always
 * has a legal pick and no slot is ever stranded or forfeited:
 *   - `draft_start` refuses a pool that cannot complete (LEAGUE_NOT_COMPLETABLE);
 *   - every pick (player, admin assign, admin correction) is refused when the pool would stop being completable after
 *     it (POOL_NOT_COMPLETABLE; the picker's own shortfall keeps its picker-level codes);
 *   - a redraft publish is refused when the published pool could not complete (REDRAFT_NOT_COMPLETABLE).
 *
 * SQL twin: `public.draft__completable_search` (+ `public.draft__pool_completable`, which reads a pool's state) in
 * supabase/migrations/20261018140200_draft_pool_completability.sql. Both run this search step for step (same node
 * counts; the parity cases are in src/lib/draft/__tests__/fixtures/completability-vectors.json):
 *
 *   Lines are taken most expensive first (price desc, then line id). Each line is either left unused or given to one
 *   participant with an open slot who may take it. Options per line, in this order:
 *     1. unused, when enough lines are left for every open slot and no participant who may take this line already
 *        holds a strictly more expensive line (a cheapest feasible assignment never leaves such a line unused: swapping
 *        it in lowers that participant's sum; with no restrictions the search therefore uses exactly the cheapest
 *        lines). A line interchangeable with the previous one (same price, same participants may take it) stays
 *        unused when that one did;
 *     2. each participant that may take it and can still fill its other slots within its budget, ordered by the room
 *        left over its cheapest completion (see the portfolio below); participants in an identical state once.
 *   A state is pruned when a necessary condition fails (lines left = L, open slots = R):
 *     - each participant's cheapest completion from the lines left it may take fits its budget;
 *     - for prefixes of participants ordered by budget per slot, and by room over their cheapest completion, the
 *       cheapest lines left for all their slots together fit their budgets together;
 *     - fill: with slack = budgets − the R cheapest lines left, each participant must reach budget − slack using lines
 *       no dearer than the R-th cheapest + slack;
 *     - at each price step, every participant needs a least number of lines below it (its cheapest such lines plus its
 *       cheapest dearer lines must fit its budget), and together they need at most the lines below it there are.
 *   A state (line index, multiset of participant states) that failed once is never searched again.
 *   Portfolio: the search runs with the most room first, then (from scratch, keeping the memo of failed states, which
 *   holds under every order) the least room first, then the most room per open slot; the first two runs get
 *   PORTFOLIO_STEPS steps each, the last one the rest of the cap.
 *
 * The cap (DEFAULT_COMPLETABILITY_NODE_LIMIT steps, = the SQL cap) bounds the work under the season lock. A search
 * that reaches it is `undecided`, never a guess: the SQL twin refuses the action with POOL_CHECK_LIMIT (an explicit
 * refusal; the gate accepts only a proven completion) and the finder shows the same reason. A pack may carry its own
 * completability benchmark against its list (in its companion tests).
 */

export interface PoolLine {
  readonly lineId: string;
  readonly price: number;
}

export interface PoolParticipant {
  readonly playerId: string;
  /** Roster slots still to fill (0 = done; ignored by the search). */
  readonly openSlots: number;
  /** Budget left in this pool. */
  readonly budget: number;
  /** Free lines this participant may not take (pool restrictions of this player). */
  readonly excludedLineIds?: ReadonlySet<string>;
}

export interface PoolCompletabilityInput {
  /** Every free line of the pool: in the list, owned by nobody, not locked for the whole pool. */
  readonly lines: readonly PoolLine[];
  readonly participants: readonly PoolParticipant[];
  /** Search step cap; default DEFAULT_COMPLETABILITY_NODE_LIMIT (= the SQL twin's cap). */
  readonly nodeLimit?: number;
}

/** Aggregates an error message can quote. `min_total` is null when there are fewer free lines than open slots. */
export interface PoolTotals {
  participants: number;
  slots: number;
  lines: number;
  min_total: number | null;
  budget_total: number;
}

export type PoolCompletability =
  | { status: 'completable'; witness: Record<string, string[]>; nodes: number }
  | { status: 'not_completable'; totals: PoolTotals; nodes: number }
  | { status: 'undecided'; totals: PoolTotals; nodes: number };

/** = the cap of the SQL twin (draft__completable_search, p_node_limit default). */
export const DEFAULT_COMPLETABILITY_NODE_LIMIT = 10_000;

export function poolTotals(lines: readonly PoolLine[], participants: readonly PoolParticipant[]): PoolTotals {
  const active = participants.filter((p) => p.openSlots > 0);
  const slots = active.reduce((sum, p) => sum + p.openSlots, 0);
  const sorted = lines.map((l) => l.price).sort((a, b) => a - b);
  let minTotal: number | null = null;
  if (sorted.length >= slots) {
    minTotal = 0;
    for (let i = 0; i < slots; i++) minTotal += sorted[i];
  }
  return {
    participants: active.length,
    slots,
    lines: lines.length,
    min_total: minTotal,
    budget_total: active.reduce((sum, p) => sum + p.budget, 0),
  };
}

interface Frame {
  i: number;
  key: string;
  /** -1 = leave the line unused, else a participant index. */
  opts: number[];
  pos: number;
  applied: boolean;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Step budget of each of the first two orderings of the portfolio (the third runs to the cap). */
export const PORTFOLIO_STEPS = 1500;
const ORDERINGS = 3;

/** Exact pool completability with a witness (one completion per participant, as line ids). */
export function poolCompletability(input: PoolCompletabilityInput): PoolCompletability {
  const limit = input.nodeLimit ?? DEFAULT_COMPLETABILITY_NODE_LIMIT;
  const totals = poolTotals(input.lines, input.participants);
  const witness: Record<string, string[]> = {};
  for (const p of input.participants) witness[p.playerId] = [];
  const active = input.participants.filter((p) => p.openSlots > 0);
  if (active.length === 0) return { status: 'completable', witness, nodes: 0 };
  if (active.some((p) => p.budget < 0)) return { status: 'not_completable', totals, nodes: 0 };

  const lines = [...input.lines].sort((a, b) => b.price - a.price || byText(a.lineId, b.lineId));
  const n = lines.length;
  const P = active.length;
  const price = lines.map((l) => l.price);
  const elig: boolean[][] = active.map((p) => lines.map((l) => !(p.excludedLineIds?.has(l.lineId) ?? false)));
  // Participants with the same eligibility share a signature (memo key and "identical state").
  const sigText = elig.map((row) => row.map((e) => (e ? '1' : '0')).join(''));
  const sigIds = new Map<string, number>();
  const sig = sigText.map((t) => {
    if (!sigIds.has(t)) sigIds.set(t, sigIds.size);
    return sigIds.get(t) as number;
  });
  // cntFrom[b][i] = lines in [i, n) participant b may take; cheapB[b][m] = sum of the m cheapest lines b may take.
  // The lines are sorted most expensive first, so the cheapest lines b may take lie in [i, n) iff cntFrom[b][i] ≥ m.
  const cntFrom = elig.map((row) => {
    const out = new Array<number>(n + 1).fill(0);
    for (let i = n - 1; i >= 0; i--) out[i] = out[i + 1] + (row[i] ? 1 : 0);
    return out;
  });
  const cheapB = elig.map((row) => {
    const out = [0];
    for (let i = n - 1; i >= 0; i--) if (row[i]) out.push(out[out.length - 1] + price[i]);
    return out;
  });
  // cntBefore[b][i] = lines before i that b may take; prefB[b][m] = sum of b's m most expensive lines (desc order).
  const cntBefore = cntFrom.map((row) => row.map((c) => row[0] - c));
  const prefB = elig.map((row) => {
    const out = [0];
    for (let i = 0; i < n; i++) if (row[i]) out.push(out[out.length - 1] + price[i]);
    return out;
  });
  const cheapAll = [0];
  for (let i = n - 1; i >= 0; i--) cheapAll.push(cheapAll[cheapAll.length - 1] + price[i]);
  /** nextLower[i] = first index after i with a strictly lower price (n if none). */
  const nextLower = new Array<number>(n).fill(n);
  for (let i = n - 2; i >= 0; i--) nextLower[i] = price[i + 1] < price[i] ? i + 1 : nextLower[i + 1];
  /** twin[i]: line i is interchangeable with line i-1 (same price, same participants may take it). */
  const twin = lines.map((_, i) => i > 0 && price[i] === price[i - 1] && elig.every((row) => row[i] === row[i - 1]));

  const slots = active.map((p) => p.openSlots);
  const budget = active.map((p) => p.budget);
  const maxHeld = active.map(() => 0);
  let open = slots.reduce((a, b) => a + b, 0);
  const assigned: number[] = new Array<number>(n).fill(-1);

  const bound = (i: number): boolean => {
    const left = n - i;
    if (left < open) return false;
    const act: number[] = [];
    for (let b = 0; b < P; b++) {
      if (slots[b] === 0) continue;
      if (cntFrom[b][i] < slots[b] || cheapB[b][slots[b]] > budget[b]) return false;
      act.push(b);
    }
    // subset prefixes: by budget per slot, then by room over the cheapest completion
    const keys: ((b: number) => number)[] = [(b) => budget[b] / slots[b], (b) => budget[b] - cheapAll[slots[b]]];
    for (const key of keys) {
      act.sort((x, y) => key(x) - key(y) || x - y);
      let s = 0;
      let sum = 0;
      for (const b of act) {
        s += slots[b];
        sum += budget[b];
        if (cheapAll[s] > sum) return false;
      }
    }
    // Fill: every assignment uses lines worth at least the cheapest `open` lines left, so with `slack` = budgets − that
    // sum, each participant must reach budget − slack, and no line dearer than the open-th cheapest + slack is usable.
    let money = 0;
    for (const b of act) money += budget[b];
    const slack = money - cheapAll[open];
    const usable = price[n - open] + slack;
    for (const b of act) {
      const s = slots[b];
      const top = Math.min(usable, budget[b] - cheapB[b][s - 1]);
      let from = i; // first line left priced ≤ top (the lines left are sorted most expensive first)
      while (from < n && price[from] > top) from = nextLower[from];
      const c0 = cntBefore[b][from];
      if (cntFrom[b][from] < s || prefB[b][c0 + s] - prefB[b][c0] < budget[b] - slack) return false;
    }
    // Split the lines left at each price step into an expensive part [i, k) and a cheap part [k, n). Each participant
    // needs at least `a` cheap lines it may take, the smallest a whose cheapest a cheap lines plus cheapest s − a
    // expensive lines (both from the lines it may take) fit its budget; together they need at most the cheap lines
    // there are. (With `spare` lines that may stay unused this is also the capacity check for the expensive part.)
    for (let j = i; j < n; j = nextLower[j]) {
      const k = nextLower[j];
      let demand = 0;
      for (const b of act) {
        const s = slots[b];
        const cheapCount = cntFrom[b][k];
        const expFrom = cntBefore[b][i];
        const expTo = cntBefore[b][k]; // eligible expensive lines are its own lines expFrom..expTo-1 (desc)
        let a = Math.max(0, s - (expTo - expFrom));
        while (a <= Math.min(s, cheapCount) && cheapB[b][a] + (prefB[b][expTo] - prefB[b][expTo - (s - a)]) > budget[b]) a++;
        if (a > Math.min(s, cheapCount)) return false;
        demand += a;
      }
      if (demand > n - k) return false;
    }
    return true;
  };

  const flag = (b: number, i: number): number => (maxHeld[b] === 0 ? 0 : maxHeld[b] > price[i] ? 2 : 1);
  // A full participant only matters through its eligibility and whether it holds a line (unused-line rule).
  const binState = (b: number, i: number): string =>
    `${slots[b]}/${slots[b] === 0 ? '-' : budget[b]}/${sig[b]}/${flag(b, i)}`;
  /** Twins are used before they are left unused: after an unused twin, this line may only stay unused too. */
  const twinLocked = (i: number): boolean => twin[i] && assigned[i - 1] === -1;
  const stateKey = (i: number): string => {
    const parts: string[] = [];
    for (let b = 0; b < P; b++) if (slots[b] > 0 || maxHeld[b] > 0) parts.push(binState(b, i));
    return `${i}${twinLocked(i) ? '!' : ':'}${parts.sort().join(';')}`;
  };

  let mode = 0;
  /** Ordering key of a participant for line i (smaller first): mode 0 most room, 1 least room, 2 most room per slot. */
  const rank = (room: number, rest: number): number => (mode === 0 ? -room : mode === 1 ? room : -room / (rest + 2));
  const options = (i: number): number[] => {
    const out: number[] = [];
    let unused = n - i - 1 >= open;
    for (let b = 0; b < P && unused; b++) if (elig[b][i] && maxHeld[b] > price[i]) unused = false;
    if (unused) out.push(-1);
    if (twinLocked(i)) return out;
    const room = new Map<number, number>();
    const seen = new Set<string>();
    for (let b = 0; b < P; b++) {
      if (slots[b] === 0 || !elig[b][i]) continue;
      const rest = slots[b] - 1;
      const after = budget[b] - price[i];
      if (after < 0 || cntFrom[b][i + 1] < rest || cheapB[b][rest] > after) continue;
      const st = binState(b, i);
      if (seen.has(st)) continue;
      seen.add(st);
      room.set(b, rank(after - cheapB[b][rest], rest));
    }
    const bins = [...room.keys()].sort((x, y) => (room.get(x) as number) - (room.get(y) as number) || x - y);
    return out.concat(bins);
  };

  const failed = new Set<string>();
  const stack: Frame[] = [];
  let nodes = 0;
  /** Push the frame of line i, or false when the state is pruned or known to fail. */
  const enter = (i: number): boolean => {
    const key = stateKey(i);
    if (failed.has(key)) return false;
    if (!bound(i)) {
      failed.add(key);
      return false;
    }
    stack.push({ i, key, opts: options(i), pos: -1, applied: false });
    return true;
  };
  const apply = (f: Frame, sign: 1 | -1): void => {
    const b = f.opts[f.pos];
    if (b < 0) return;
    if (sign === 1) {
      slots[b]--;
      budget[b] -= price[f.i];
      if (maxHeld[b] === 0) maxHeld[b] = price[f.i];
      open--;
      assigned[f.i] = b;
    } else {
      slots[b]++;
      budget[b] += price[f.i];
      if (slots[b] === active[b].openSlots) maxHeld[b] = 0; // its first (= most expensive) line went back
      open++;
      assigned[f.i] = -1;
    }
  };

  if (open === 0) return { status: 'completable', witness, nodes };
  // Portfolio (see the header): three orderings, one shared memo of failed states.
  for (mode = 0; mode < ORDERINGS; mode++) {
    const stop = mode === ORDERINGS - 1 ? limit : Math.min(limit, nodes + PORTFOLIO_STEPS);
    if (!enter(0)) return { status: 'not_completable', totals, nodes };
    while (stack.length > 0) {
      const f = stack[stack.length - 1];
      if (f.applied) {
        apply(f, -1);
        f.applied = false;
      }
      f.pos++;
      if (f.pos >= f.opts.length) {
        failed.add(f.key);
        stack.pop();
        continue;
      }
      if (nodes >= stop) break;
      nodes++;
      apply(f, 1);
      f.applied = true;
      if (open === 0) {
        for (let i = 0; i < n; i++) if (assigned[i] >= 0) witness[active[assigned[i]].playerId].push(lines[i].lineId);
        return { status: 'completable', witness, nodes };
      }
      enter(f.i + 1);
    }
    if (stack.length === 0) return { status: 'not_completable', totals, nodes };
    // step budget spent: unwind to the start state for the next ordering
    while (stack.length > 0) {
      const f = stack.pop() as Frame;
      if (f.applied) apply(f, -1);
    }
  }
  return { status: 'undecided', totals, nodes };
}
