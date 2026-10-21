import { describe, expect, it } from 'vitest';
import { evaluateCompletion } from '../budget';
import { buildDraftabilityEvaluator, type DraftabilityInput } from '../draftability';
import type { LineId, ReasonDTO } from '@/types/draft-queue';

const ME = 'player-me';
const OTHER = 'player-other';

function input(overrides: Partial<DraftabilityInput> = {}): DraftabilityInput {
  return {
    kind: 'initial',
    phase: 'drafting',
    paused: false,
    pauseReason: null,
    lockNoRedraftLines: true,
    playerId: ME,
    isParticipant: true,
    current: { slot_id: 'slot-1', player_id: ME },
    me: { budget_remaining: 100, open_slots: 3, slots_total: 9, open_redraft_slots: 0 },
    prices: { 'a--a3': 10, 'b--b3': 20, 'c--c3': 30, 'd--d3': 5 },
    taken: {},
    restrictions: [],
    noRedraftLineIds: new Set<LineId>(),
    participants: [],
    ...overrides,
  };
}

describe('viewer-level pick block', () => {
  const block = (o: Partial<DraftabilityInput>) => buildDraftabilityEvaluator(input(o)).pickBlock;

  it('is null when it is my active turn', () => {
    expect(block({})).toBeNull();
  });

  it('follows the order SIGNED_OUT → NOT_PARTICIPANT → DRAFT_NOT_STARTED → SUBMISSION_PHASE → DRAFT_COMPLETE', () => {
    expect(block({ playerId: null, isParticipant: false, phase: 'setup' })).toEqual({ code: 'SIGNED_OUT' });
    expect(block({ isParticipant: false, phase: 'setup', me: null })).toEqual({ code: 'NOT_PARTICIPANT' });
    expect(block({ phase: 'setup', paused: true })).toEqual({ code: 'DRAFT_NOT_STARTED' });
    expect(block({ phase: 'submissions', kind: 'redraft', paused: true })).toEqual({ code: 'SUBMISSION_PHASE' });
    expect(block({ phase: 'complete', paused: true })).toEqual({ code: 'DRAFT_COMPLETE' });
    expect(block({ phase: 'cancelled' })).toEqual({ code: 'DRAFT_COMPLETE' });
  });

  it('DRAFT_PAUSED carries the pause reason and outranks the roster checks', () => {
    const full = { budget_remaining: 0, open_slots: 0, slots_total: 9, open_redraft_slots: 0 };
    expect(block({ paused: true, pauseReason: 'blocked_slot', me: full })).toEqual({
      code: 'DRAFT_PAUSED',
      params: { reason: 'blocked_slot' },
    });
    expect(block({ paused: true, pauseReason: null })).toEqual({ code: 'DRAFT_PAUSED', params: { reason: 'admin' } });
  });

  it('ROSTER_FULL {size} → NO_OPEN_REDRAFT_SLOT → NOT_YOUR_TURN (no slot is ever blocked)', () => {
    expect(
      block({ me: { budget_remaining: 4, open_slots: 0, slots_total: 9, open_redraft_slots: 0 }, current: null }),
    ).toEqual({ code: 'ROSTER_FULL', params: { size: 9 } });
    expect(
      block({ kind: 'redraft', me: { budget_remaining: 4, open_slots: 1, slots_total: 3, open_redraft_slots: 0 }, current: null }),
    ).toEqual({ code: 'NO_OPEN_REDRAFT_SLOT' });
    expect(block({ current: { slot_id: 's', player_id: ME } })).toBeNull();
    expect(block({ current: { slot_id: 's', player_id: OTHER } })).toEqual({ code: 'NOT_YOUR_TURN' });
    expect(block({ current: null })).toEqual({ code: 'NOT_YOUR_TURN' });
  });

  it('a redraft player with an open redraft slot on the clock may pick', () => {
    expect(block({ kind: 'redraft', me: { budget_remaining: 36, open_slots: 3, slots_total: 3, open_redraft_slots: 3 } })).toBeNull();
  });
});

describe('line-level reasons', () => {
  it('follows NOT_IN_LIST → LINE_TAKEN → OWN_REDRAFT_DROP → LINE_RESTRICTED → COSMOG_REDRAFT_LOCKED → budget', () => {
    const line = 'cosmog--lunala';
    const base = input({
      kind: 'redraft',
      prices: { [line]: 500, 'x--x3': 1 },
      me: { budget_remaining: 10, open_slots: 2, slots_total: 3, open_redraft_slots: 2 },
    });
    const status = (o: Partial<DraftabilityInput>, id: LineId = line) =>
      buildDraftabilityEvaluator({ ...base, ...o }).lineStatus(id);

    expect(status({}, 'unknown--line')).toEqual({ code: 'NOT_IN_LIST' });
    const everything: Partial<DraftabilityInput> = {
      taken: { [line]: OTHER },
      restrictions: [
        { player_id: ME, line_id: line, reason: 'admin' },
        { player_id: ME, line_id: line, reason: 'own_redraft_drop' },
      ],
      noRedraftLineIds: new Set([line]),
    };
    expect(status(everything)).toEqual({ code: 'LINE_TAKEN', params: { player_id: OTHER } });
    expect(status({ ...everything, taken: {} })).toEqual({ code: 'OWN_REDRAFT_DROP' });
    expect(status({ ...everything, taken: {}, restrictions: [{ player_id: ME, line_id: line, reason: 'admin' }] })).toEqual({
      code: 'LINE_RESTRICTED',
    });
    expect(status({ ...everything, taken: {}, restrictions: [] })).toEqual({ code: 'COSMOG_REDRAFT_LOCKED' });
    expect(status({ ...everything, taken: {}, restrictions: [], lockNoRedraftLines: false })).toEqual({
      code: 'INSUFFICIENT_BUDGET',
      params: { price: 500, remaining: 10 },
    });
  });

  it('ignores other players’ restrictions and the redraft lock in an initial draft', () => {
    const ev = buildDraftabilityEvaluator(
      input({
        restrictions: [{ player_id: OTHER, line_id: 'a--a3', reason: 'own_redraft_drop' }],
        noRedraftLineIds: new Set(['b--b3']),
      }),
    );
    expect(ev.lineStatus('a--a3')).toBeNull();
    expect(ev.lineStatus('b--b3')).toBeNull();
  });

  it('INSUFFICIENT_BUDGET → NOT_ENOUGH_LINES → BUDGET_INFEASIBLE {shortfall, slots}', () => {
    const ev = buildDraftabilityEvaluator(
      input({
        me: { budget_remaining: 30, open_slots: 2, slots_total: 9, open_redraft_slots: 0 },
        prices: { 'a--a3': 22, 'b--b3': 10, 'c--c3': 40, 'd--d3': 12 },
      }),
    );
    expect(ev.lineStatus('c--c3')).toEqual({ code: 'INSUFFICIENT_BUDGET', params: { price: 40, remaining: 30 } });
    expect(ev.lineStatus('a--a3')).toEqual({ code: 'BUDGET_INFEASIBLE', params: { shortfall: 2, slots: 1 } });
    expect(ev.lineStatus('d--d3')).toBeNull();
    expect(ev.remainingAfter('d--d3')).toBe(18);
    expect(ev.remainingAfter('nope--nope')).toBeNull();

    const few = buildDraftabilityEvaluator(
      input({
        me: { budget_remaining: 100, open_slots: 3, slots_total: 9, open_redraft_slots: 0 },
        prices: { 'a--a3': 1, 'b--b3': 1, 'c--c3': 1 },
        taken: { 'c--c3': OTHER },
      }),
    );
    expect(few.lineStatus('a--a3')).toEqual({ code: 'NOT_ENOUGH_LINES', params: { slots: 2, available: 1 } });
  });

  it('a taken line is not counted as a completion option', () => {
    const ev = buildDraftabilityEvaluator(
      input({
        me: { budget_remaining: 30, open_slots: 2, slots_total: 9, open_redraft_slots: 0 },
        prices: { 'a--a3': 20, 'b--b3': 10, 'c--c3': 15 },
        taken: { 'b--b3': OTHER },
      }),
    );
    expect(ev.lineStatus('a--a3')).toEqual({ code: 'BUDGET_INFEASIBLE', params: { shortfall: 5, slots: 1 } });
  });

  it('allLineStatus lists only the non-draftable lines; no budget checks without a participant', () => {
    const ev = buildDraftabilityEvaluator(
      input({ taken: { 'b--b3': OTHER }, me: { budget_remaining: 12, open_slots: 2, slots_total: 9, open_redraft_slots: 0 } }),
    );
    expect(ev.allLineStatus()).toEqual({
      'b--b3': { code: 'LINE_TAKEN', params: { player_id: OTHER } },
      'c--c3': { code: 'INSUFFICIENT_BUDGET', params: { price: 30, remaining: 12 } },
      'a--a3': { code: 'BUDGET_INFEASIBLE', params: { shortfall: 3, slots: 1 } },
      'd--d3': { code: 'BUDGET_INFEASIBLE', params: { shortfall: 3, slots: 1 } },
    });
    const visitor = buildDraftabilityEvaluator(input({ playerId: null, isParticipant: false, me: null, taken: { 'b--b3': OTHER } }));
    expect(visitor.allLineStatus()).toEqual({ 'b--b3': { code: 'LINE_TAKEN', params: { player_id: OTHER } } });
    expect(visitor.remainingAfter('a--a3')).toBeNull();
  });

  it('skips budget checks when the roster is full (ROSTER_FULL is viewer-level)', () => {
    const ev = buildDraftabilityEvaluator(input({ me: { budget_remaining: 0, open_slots: 0, slots_total: 9, open_redraft_slots: 0 } }));
    expect(ev.lineStatus('c--c3')).toBeNull();
    expect(ev.pickBlock).toEqual({ code: 'ROSTER_FULL', params: { size: 9 } });
  });

  it('does not treat Object.prototype keys as lines', () => {
    const ev = buildDraftabilityEvaluator(input());
    expect(ev.lineStatus('constructor')).toEqual({ code: 'NOT_IN_LIST' });
  });
});

describe('property: the fast evaluator equals the brute force (seeded)', () => {
  /** Reference: every check per line, completion via budget.ts on the other legal lines. */
  function bruteForce(i: DraftabilityInput, lineId: LineId): ReasonDTO | null {
    const mine = i.restrictions.filter((r) => r.player_id === i.playerId && r.line_id === lineId);
    const legal = (id: LineId) =>
      !(id in i.taken) &&
      !i.restrictions.some((r) => r.player_id === i.playerId && r.line_id === id) &&
      !(i.kind === 'redraft' && i.lockNoRedraftLines && i.noRedraftLineIds.has(id));
    if (!(lineId in i.prices)) return { code: 'NOT_IN_LIST' };
    if (lineId in i.taken) return { code: 'LINE_TAKEN', params: { player_id: i.taken[lineId] } };
    if (mine.some((r) => r.reason === 'own_redraft_drop')) return { code: 'OWN_REDRAFT_DROP' };
    if (mine.length > 0) return { code: 'LINE_RESTRICTED' };
    if (!legal(lineId)) return { code: 'COSMOG_REDRAFT_LOCKED' };
    if (!i.me || i.me.open_slots < 1) return null;
    const others = Object.keys(i.prices)
      .filter((id) => id !== lineId && legal(id))
      .map((id) => i.prices[id])
      .sort((a, b) => a - b);
    const r = evaluateCompletion({
      remaining: i.me.budget_remaining,
      openSlots: i.me.open_slots,
      price: i.prices[lineId],
      otherLegalPricesSorted: others,
    });
    if (r.ok) return null;
    if (r.code === 'BUDGET_INFEASIBLE') return { code: r.code, params: { shortfall: r.params.shortfall, slots: r.params.slots } };
    return { code: r.code, params: r.params };
  }

  it('agrees on 400 random pools', () => {
    let seed = 20_261_009;
    const rand = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    for (let run = 0; run < 400; run++) {
      const lineCount = 1 + rand(14);
      const ids = Array.from({ length: lineCount }, (_, k) => `l${k}--l${k}x`);
      const prices: Record<LineId, number> = {};
      // Few distinct prices so duplicates (ties) are common.
      for (const id of ids) prices[id] = 1 + rand(12);
      const taken: Record<LineId, string> = {};
      const restrictions: { player_id: string; line_id: LineId; reason: 'own_redraft_drop' | 'admin' }[] = [];
      const noRedraft = new Set<LineId>();
      for (const id of ids) {
        const roll = rand(10);
        if (roll === 0) taken[id] = OTHER;
        else if (roll === 1) restrictions.push({ player_id: ME, line_id: id, reason: rand(2) ? 'admin' : 'own_redraft_drop' });
        else if (roll === 2) restrictions.push({ player_id: OTHER, line_id: id, reason: 'own_redraft_drop' });
        else if (roll === 3) noRedraft.add(id);
      }
      const i = input({
        kind: rand(2) ? 'redraft' : 'initial',
        lockNoRedraftLines: rand(4) !== 0,
        me: { budget_remaining: rand(50), open_slots: rand(6), slots_total: 9, open_redraft_slots: rand(3) },
        prices,
        taken,
        restrictions,
        noRedraftLineIds: noRedraft,
      });
      const ev = buildDraftabilityEvaluator(i);
      for (const id of [...ids, 'missing--line']) {
        expect(ev.lineStatus(id), `run ${run}, line ${id}`).toEqual(bruteForce(i, id));
      }
    }
  });
});

describe('pool gate (every participant must still complete)', () => {
  // ME (budget 30, 2 slots) and OTHER (budget 10, 2 slots); lines 5, 5, 6, 20.
  const prices: Record<LineId, number> = { 'five--a': 5, 'five--b': 5, 'six--c': 6, 'twenty--d': 20 };
  const base = (o: Partial<DraftabilityInput> = {}) =>
    input({
      me: { budget_remaining: 30, open_slots: 2, slots_total: 2, open_redraft_slots: 0 },
      prices,
      participants: [
        { player_id: ME, open_slots: 2, budget_remaining: 30 },
        { player_id: OTHER, open_slots: 2, budget_remaining: 10 },
      ],
      ...o,
    });

  it('greys a line the picker can afford when another player could no longer fill their roster', () => {
    const ev = buildDraftabilityEvaluator(base());
    // Taking a 5 leaves OTHER with 5 + 6 = 11 > 10.
    expect(ev.lineStatus('five--a')).toEqual({ code: 'POOL_NOT_COMPLETABLE' });
    expect(ev.lineStatus('five--b')).toEqual({ code: 'POOL_NOT_COMPLETABLE' });
    expect(ev.lineStatus('six--c')).toBeNull();
    expect(ev.lineStatus('twenty--d')).toBeNull();
    expect(Object.keys(ev.allLineStatus()).sort()).toEqual(['five--a', 'five--b']);
  });

  it('picker-level reasons come first; without other participants the gate is the picker check', () => {
    const ev = buildDraftabilityEvaluator(base({ me: { budget_remaining: 10, open_slots: 2, slots_total: 2, open_redraft_slots: 0 } }));
    expect(ev.lineStatus('twenty--d')).toEqual({ code: 'INSUFFICIENT_BUDGET', params: { price: 20, remaining: 10 } });
    const alone = buildDraftabilityEvaluator(base({ participants: [] }));
    expect(alone.lineStatus('five--a')).toBeNull();
  });

  it('applies other players’ restrictions (a line only they may not take helps nobody else)', () => {
    // OTHER may not take six--c: after ME takes twenty--d, OTHER needs 5 + 5 and ME needs one more line.
    const ev = buildDraftabilityEvaluator(base({ restrictions: [{ player_id: OTHER, line_id: 'six--c', reason: 'own_redraft_drop' }] }));
    expect(ev.lineStatus('six--c')).toBeNull();
    expect(ev.lineStatus('five--a')).toEqual({ code: 'POOL_NOT_COMPLETABLE' });
  });

  it('a pool that is already not completable greys every affordable line without a search', () => {
    const ev = buildDraftabilityEvaluator(
      base({
        participants: [
          { player_id: ME, open_slots: 2, budget_remaining: 30 },
          { player_id: OTHER, open_slots: 2, budget_remaining: 9 },
        ],
      }),
    );
    for (const id of Object.keys(prices)) expect(ev.lineStatus(id), id).toEqual({ code: 'POOL_NOT_COMPLETABLE' });
  });

  it('reports POOL_CHECK_LIMIT when the search hits its cap (the server refuses such a pick too)', () => {
    const ev = buildDraftabilityEvaluator(base({ nodeLimit: 1 }));
    expect(ev.lineStatus('twenty--d')).toEqual({ code: 'POOL_CHECK_LIMIT' });
  });

  it('no gate for a viewer without an open slot or outside the draft', () => {
    const full = buildDraftabilityEvaluator(base({ me: { budget_remaining: 30, open_slots: 0, slots_total: 2, open_redraft_slots: 0 } }));
    expect(full.lineStatus('five--a')).toBeNull();
    const outsider = buildDraftabilityEvaluator(base({ isParticipant: false, me: null }));
    expect(outsider.lineStatus('five--a')).toBeNull();
  });
});
