/**
 * Pool completability (no forfeit, a legal pick always exists). Pure: no DB.
 *
 * - The exact search agrees with a brute-force oracle on random small pools (restrictions, negative budgets, done
 *   participants), and every witness it returns is a real completion.
 * - The shared parity vectors (also replayed against the SQL twin) reproduce status and step count exactly.
 * - The step cap yields `undecided`, never a guess.
 * - A draft gated by the pool check never strands the player on the clock (property over seeded random drafts).
 * - The public example pack's own numbers (budget, picks, list) are completable for the league sizes it serves.
 */
import { describe, expect, it } from 'vitest';
import { epbPack } from '@/lib/format-pack';
import exampleLines from '@/app/(public)/draft-preview/fixture-lines.example.json';
import {
  DEFAULT_COMPLETABILITY_NODE_LIMIT,
  poolCompletability,
  poolTotals,
  type PoolLine,
  type PoolParticipant,
} from '../completability';
import vectorsFile from './fixtures/completability-vectors.json';

/** Deterministic LCG (the same in every run). */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Every assignment line → (unused | participant): is there one that fills every open slot within budget? */
function bruteForce(lines: readonly PoolLine[], participants: readonly PoolParticipant[]): boolean {
  const P = participants.length;
  const total = (P + 1) ** lines.length;
  for (let m = 0; m < total; m++) {
    let x = m;
    const count = new Array<number>(P).fill(0);
    const sum = new Array<number>(P).fill(0);
    let ok = true;
    for (const line of lines) {
      const a = x % (P + 1);
      x = Math.floor(x / (P + 1));
      if (a === P) continue;
      if (participants[a].excludedLineIds?.has(line.lineId)) {
        ok = false;
        break;
      }
      count[a]++;
      sum[a] += line.price;
    }
    if (!ok) continue;
    if (participants.every((p, a) => (p.openSlots <= 0 ? count[a] === 0 : count[a] === p.openSlots && sum[a] <= p.budget))) {
      return true;
    }
  }
  return false;
}

function expectValidWitness(
  witness: Record<string, string[]>,
  lines: readonly PoolLine[],
  participants: readonly PoolParticipant[],
): void {
  const price = new Map(lines.map((l) => [l.lineId, l.price]));
  const used = Object.values(witness).flat();
  expect(new Set(used).size, 'each line once').toBe(used.length);
  for (const p of participants) {
    const mine = witness[p.playerId];
    expect(mine.length, p.playerId).toBe(Math.max(0, p.openSlots));
    for (const id of mine) {
      expect(price.has(id), `${id} is free`).toBe(true);
      expect(p.excludedLineIds?.has(id) ?? false, `${p.playerId} may take ${id}`).toBe(false);
    }
    if (p.openSlots > 0) expect(mine.reduce((s, id) => s + (price.get(id) ?? 0), 0)).toBeLessThanOrEqual(p.budget);
  }
}

describe('poolCompletability — exact', () => {
  it('agrees with brute force on 4000 random small pools and returns real witnesses', () => {
    const r = rng(42);
    const ri = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
    let completable = 0;
    for (let t = 0; t < 4000; t++) {
      const n = ri(0, 7);
      const lines = Array.from({ length: n }, (_, i) => ({ lineId: `l${i}--x`, price: ri(1, 9) }));
      const participants = Array.from({ length: ri(1, 3) }, (_, i) => ({
        playerId: `p${i}`,
        openSlots: ri(0, 3),
        budget: ri(-2, 20),
        excludedLineIds: new Set(lines.filter(() => r() < 0.2).map((l) => l.lineId)),
      }));
      const result = poolCompletability({ lines, participants });
      expect(result.status, `case ${t}`).not.toBe('undecided');
      expect(result.status === 'completable', `case ${t}`).toBe(bruteForce(lines, participants));
      if (result.status === 'completable') {
        completable++;
        expectValidWitness(result.witness, lines, participants);
      }
    }
    expect(completable).toBeGreaterThan(500); // both outcomes are exercised
  });

  it('sees what a per-player check cannot: two players who both need the one cheap line', () => {
    const lines = [
      { lineId: 'a--a', price: 10 },
      { lineId: 'b--b', price: 20 },
    ];
    const one = { openSlots: 1, budget: 15 };
    const r = poolCompletability({ lines, participants: [{ playerId: 'p', ...one }, { playerId: 'q', ...one }] });
    expect(r.status).toBe('not_completable');
    if (r.status === 'not_completable') {
      expect(r.totals).toEqual({ participants: 2, slots: 2, lines: 2, min_total: 30, budget_total: 30 });
    }
  });

  it('honours restrictions (own redraft drops): the cheap line only helps the player allowed to take it', () => {
    const lines = [
      { lineId: 'a--a', price: 5 },
      { lineId: 'b--b', price: 9 },
    ];
    const ok = poolCompletability({
      lines,
      participants: [
        { playerId: 'p', openSlots: 1, budget: 9 },
        { playerId: 'q', openSlots: 1, budget: 5 },
      ],
    });
    expect(ok.status).toBe('completable');
    if (ok.status === 'completable') expect(ok.witness).toEqual({ p: ['b--b'], q: ['a--a'] });
    const refused = poolCompletability({
      lines,
      participants: [
        { playerId: 'p', openSlots: 1, budget: 9 },
        { playerId: 'q', openSlots: 1, budget: 5, excludedLineIds: new Set(['a--a']) },
      ],
    });
    expect(refused.status).toBe('not_completable');
  });

  it('treats done participants as absent and a negative budget with open slots as not completable', () => {
    const lines = [{ lineId: 'a--a', price: 1 }];
    expect(poolCompletability({ lines, participants: [{ playerId: 'p', openSlots: 0, budget: -5 }] })).toMatchObject({
      status: 'completable',
      witness: { p: [] },
    });
    expect(poolCompletability({ lines, participants: [{ playerId: 'p', openSlots: 1, budget: -1 }] }).status).toBe(
      'not_completable',
    );
  });

  it('reports min_total null when fewer lines than slots are free', () => {
    expect(poolTotals([{ lineId: 'a--a', price: 3 }], [{ playerId: 'p', openSlots: 2, budget: 9 }])).toEqual({
      participants: 1,
      slots: 2,
      lines: 1,
      min_total: null,
      budget_total: 9,
    });
  });
});

describe('poolCompletability — step cap', () => {
  it('returns undecided at the cap, never a guess; the default cap is the SQL twin cap', () => {
    expect(DEFAULT_COMPLETABILITY_NODE_LIMIT).toBe(10_000);
    const lines = Array.from({ length: 30 }, (_, i) => ({ lineId: `l${i}--x`, price: 5 + (i % 17) }));
    const participants = Array.from({ length: 5 }, (_, i) => ({ playerId: `p${i}`, openSlots: 5, budget: 60 }));
    const capped = poolCompletability({ lines, participants, nodeLimit: 3 });
    expect(capped).toMatchObject({ status: 'undecided', nodes: 3 });
    expect(poolCompletability({ lines, participants }).status).not.toBe('undecided');
  });
});

interface Vector {
  id: string;
  lines: [string, number][];
  participants: { slots: number; budget: number; excluded: string[] }[];
  node_limit?: number;
  status: 'completable' | 'not_completable' | 'undecided';
  nodes: number;
}

describe('parity vectors (TS = SQL twin, step for step)', () => {
  const vectors = (vectorsFile as unknown as { vectors: Vector[] }).vectors;

  it('covers every outcome', () => {
    expect(new Set(vectors.map((v) => v.status))).toEqual(new Set(['completable', 'not_completable', 'undecided']));
    expect(new Set(vectors.map((v) => v.id)).size).toBe(vectors.length);
  });

  it.each(vectors.map((v) => [v.id, v] as const))('%s', (_id, v) => {
    const lines = v.lines.map(([lineId, price]) => ({ lineId, price }));
    const participants = v.participants.map((p, i) => ({
      playerId: `p${i + 1}`,
      openSlots: p.slots,
      budget: p.budget,
      excludedLineIds: new Set(p.excluded),
    }));
    const r = poolCompletability({ lines, participants, nodeLimit: v.node_limit });
    expect({ status: r.status, nodes: r.nodes }).toEqual({ status: v.status, nodes: v.nodes });
    if (r.status === 'completable') expectValidWitness(r.witness, lines, participants);
  });
});

describe('a gated draft never strands the player on the clock', () => {
  /** Snake draft where a pick is allowed only if the pool stays completable; random legal picks. */
  function simulate(seed: number, lines: readonly PoolLine[], players: number, roster: number, budget: number) {
    const r = rng(seed);
    const free = new Map(lines.map((l) => [l.lineId, l.price]));
    const state = Array.from({ length: players }, (_, i) => ({ playerId: `p${i}`, openSlots: roster, budget }));
    const start = poolCompletability({ lines, participants: state });
    if (start.status !== 'completable') return { started: false, picks: 0 };
    let picks = 0;
    for (let round = 0; round < roster; round++) {
      const order = round % 2 === 0 ? state : [...state].reverse();
      for (const me of order) {
        const legal = [...free].filter(([lineId, price]) => {
          if (price > me.budget) return false;
          const after = poolCompletability({
            lines: [...free].filter(([id]) => id !== lineId).map(([id, p]) => ({ lineId: id, price: p })),
            participants: state.map((p) => (p === me ? { ...p, openSlots: p.openSlots - 1, budget: p.budget - price } : p)),
          });
          return after.status === 'completable';
        });
        expect(legal.length, `seed ${seed}: ${me.playerId} has a legal pick at pick ${picks + 1}`).toBeGreaterThan(0);
        const [lineId, price] = legal[Math.floor(r() * legal.length)];
        free.delete(lineId);
        me.budget -= price;
        me.openSlots -= 1;
        picks++;
      }
    }
    return { started: true, picks };
  }

  it('random legal picks always finish every roster (synthetic tight leagues)', () => {
    const r = rng(7);
    for (let seed = 1; seed <= 12; seed++) {
      const lines = Array.from({ length: 22 }, (_, i) => ({ lineId: `l${seed}x${i}--y`, price: 3 + Math.floor(r() * 12) }));
      const sorted = lines.map((l) => l.price).sort((a, b) => a - b);
      const budget = Math.ceil(sorted.slice(0, 12).reduce((a, b) => a + b, 0) / 4) + 2;
      const result = simulate(seed, lines, 4, 3, budget);
      if (result.started) expect(result.picks).toBe(12);
    }
  });
});

describe('the example pack is completable for the leagues it serves', () => {
  const lines = (exampleLines as { line_id: string | null; price: number }[]).map((l) => ({
    lineId: l.line_id ?? '',
    price: l.price,
  }));
  const { draftBudget, draftPicks } = epbPack.defaults;

  it.each([2, 3, 4, 5, 6, 7, 8])('%i players', (players) => {
    const participants = Array.from({ length: players }, (_, i) => ({
      playerId: `p${i}`,
      openSlots: draftPicks,
      budget: draftBudget,
    }));
    const r = poolCompletability({ lines, participants });
    expect(r.status).toBe('completable');
  });

  it('a league larger than the list can fill is refused without a search step', () => {
    const players = Math.floor(lines.length / draftPicks) + 1;
    const participants = Array.from({ length: players }, (_, i) => ({ playerId: `p${i}`, openSlots: draftPicks, budget: draftBudget }));
    expect(poolCompletability({ lines, participants })).toMatchObject({ status: 'not_completable', nodes: 0 });
  });
});
