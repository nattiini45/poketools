/**
 * Shape of the queue vectors. No DB: the
 * queue algorithm lives only in SQL; these vectors are
 * replayed against a local stack by the maintainer-only draft RPC parity suite
 * (private companion overlay, `DRAFT_RPC_LIVE_DB=1`). This test keeps the
 * data file honest (zod shape, unique ids, Q1–Q12 present, labels that parse)
 * and checks Q11's generation order with a tiny pure helper that exists only
 * here.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import vectorsFile from './fixtures/queue-vectors.json';

const alias = z.string().regex(/^[A-Z]$/);
const label = z.string().regex(/^\d+(\.\d+)? [A-Z](\(m\))?$/);

const stepSchema = z.discriminatedUnion('do', [
  z.object({ at: z.number().nonnegative(), do: z.literal('pick'), player: alias, line_price: z.number().int().positive().optional() }).strict(),
  z.object({ at: z.number().nonnegative(), do: z.literal('tick') }).strict(),
  z.object({ at: z.number().nonnegative(), do: z.literal('pause') }).strict(),
  z.object({ at: z.number().nonnegative(), do: z.literal('resume') }).strict(),
  z.object({ at: z.number().nonnegative(), do: z.literal('extension'), player: alias, kind: z.enum(['plus120', 'plus60']) }).strict(),
]);

const vectorSchema = z
  .object({
    id: z.string().regex(/^Q\d+[a-z]?$/),
    spec: z.string().regex(/^SPEC:\d+(-\d+)?$/).optional(),
    title: z.string().min(10),
    setup: z
      .object({
        mode: z.enum(['live', 'slow']),
        kind: z.enum(['initial', 'redraft']),
        roster_size: z.number().int().min(1).max(20),
        seats: z
          .array(z.object({ player: alias, seat: z.number().int().min(1), drops: z.number().int().min(0).max(20).optional() }).strict())
          .min(2),
        budgets: z.record(alias, z.number().int().min(0)).optional(),
        legal_prices: z.record(alias, z.array(z.number().int().positive())).optional(),
        ladder: z.array(z.number().int().positive()).min(1).max(6).optional(),
      })
      .strict(),
    steps: z.array(stepSchema),
    expect: z
      .object({
        queue: z.array(label),
        active: z
          .object({
            key: z.string().regex(/^\d+(\.\d+)?$/),
            player: alias,
            kind: z.enum(['normal', 'makeup']),
            status: z.literal('active').optional(),
            deadline_at: z.number().nullable().optional(),
            remaining_ms_at_pause: z.number().nullable().optional(),
          })
          .strict()
          .optional(),
        penalty_stage: z.record(alias, z.number().int().min(0)).optional(),
        error: z.string().regex(/^[A-Z][A-Z0-9_]+$/).optional(),
        alerts: z.array(z.literal('inplace_timeout')).optional(),
        durations: z.record(label, z.number().int().positive()).optional(),
        done: z.array(alias).optional(),
        paused: z.literal('admin').nullable().optional(),
      })
      .strict(),
  })
  .strict();

const fileSchema = z.object({ $comment: z.string(), vectors: z.array(vectorSchema).min(12) }).strict();

/**
 * No blocked state and no forfeit (pool completability): the vectors carry no blocked slot, blocked pause,
 * blocked alert, admin assign or forfeit step (the schema above no longer admits them), and Q12 is the start refusal.
 */

type QueueVectorFile = z.infer<typeof fileSchema>;
type QueueVector = QueueVectorFile['vectors'][number];

const parsed: QueueVectorFile = fileSchema.parse(vectorsFile);

/** §5.2 redraft generation: rounds 1..max(drops), seat order ascending on odd rounds, descending on even rounds. */
function redraftOrder(seats: readonly { player: string; seat: number; drops?: number }[]): string[] {
  const maxDrops = Math.max(0, ...seats.map((s) => s.drops ?? 0));
  const order: string[] = [];
  for (let round = 1; round <= maxDrops; round++) {
    const inRound = seats.filter((s) => (s.drops ?? 0) >= round).sort((a, b) => a.seat - b.seat);
    if (round % 2 === 0) inRound.reverse();
    order.push(...inRound.map((s) => s.player));
  }
  return order;
}

function byId(id: string): QueueVector {
  const v = parsed.vectors.find((x) => x.id === id);
  if (!v) throw new Error(`vector ${id} missing`);
  return v;
}

describe('queue-vectors.json', () => {
  it('parses with the §5.7 schema (strict, additive fields only)', () => {
    expect(parsed.vectors.length).toBeGreaterThanOrEqual(12);
  });

  it('has unique ids and every §5.6 vector Q1–Q12', () => {
    const ids = parsed.vectors.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i <= 12; i++) expect(ids).toContain(`Q${i}`);
  });

  it('uses only seated players, contiguous seats and steps in time order', () => {
    for (const v of parsed.vectors) {
      const players = v.setup.seats.map((s) => s.player);
      const seats = v.setup.seats.map((s) => s.seat).sort((a, b) => a - b);
      expect(new Set(players).size, v.id).toBe(players.length);
      expect(seats, v.id).toEqual(seats.map((_, i) => i + 1));
      for (const step of v.steps) {
        if ('player' in step) expect(players, `${v.id} step player`).toContain(step.player);
      }
      for (let i = 1; i < v.steps.length; i++) expect(v.steps[i].at, v.id).toBeGreaterThanOrEqual(v.steps[i - 1].at);
      for (const l of v.expect.queue) expect(players, `${v.id} queue ${l}`).toContain(l.split(' ')[1].slice(0, 1));
      if (v.expect.active) expect(v.expect.queue[0], `${v.id} current slot first`).toBe(
        `${v.expect.active.key} ${v.expect.active.player}${v.expect.active.kind === 'makeup' ? '(m)' : ''}`,
      );
      const keys = v.expect.queue.map((l) => Number(l.split(' ')[0]));
      expect([...keys].sort((a, b) => a - b), `${v.id} queue sorted by key`).toEqual(keys);
    }
  });

  it('Q1 is Misty\'s double-pick timeout: his second normal pick stays, the make-up goes behind Dawn', () => {
    const q1 = byId('Q1');
    expect(q1.expect.queue.slice(0, 3)).toEqual(['5 N', '6 K', '6.5 N(m)']);
    expect(q1.expect.durations?.['6.5 N(m)']).toBe(150);
  });

  it('Q2 keeps the 2:30 make-up floor (a second make-up is not halved)', () => {
    expect(byId('Q2').expect.durations?.['7.5 N(m)']).toBe(150);
  });

  it('Q12 is the pool gate at draft start: refused, nothing queued', () => {
    const q12 = byId('Q12');
    expect(q12.steps).toEqual([]);
    expect(q12.expect).toEqual({ queue: [], error: 'LEAGUE_NOT_COMPLETABLE' });
    expect(parsed.vectors.map((v) => v.id)).not.toEqual(expect.arrayContaining(['Q12b']));
    expect(parsed.vectors.map((v) => v.id)).not.toEqual(expect.arrayContaining(['Q12c']));
  });

  it('Q11 queue equals the redraft generation rule', () => {
    const q11 = byId('Q11');
    expect(q11.setup.kind).toBe('redraft');
    const order = redraftOrder(q11.setup.seats);
    expect(order).toEqual(['K', 'N', 'S', 'S', 'K', 'K']);
    expect(q11.expect.queue.map((l) => l.split(' ')[1])).toEqual(order);
    expect(q11.expect.done).toEqual(['B']);
  });

  it('initial vectors start from the plain snake queue', () => {
    const snake = (n: number, rounds: number): number[] => {
      const out: number[] = [];
      for (let r = 1; r <= rounds; r++) {
        const seats = Array.from({ length: n }, (_, i) => i + 1);
        out.push(...(r % 2 === 1 ? seats : seats.reverse()));
      }
      return out;
    };
    const q8 = byId('Q8');
    const seatOf = new Map(q8.setup.seats.map((s) => [s.player, s.seat]));
    expect(q8.expect.queue.map((l) => seatOf.get(l.split(' ')[1]))).toEqual(snake(4, 3));
  });
});
