import { describe, expect, it } from 'vitest';
import { TEXT_MAX } from '@/components/format-runtime/admin/admin-shared';
import { FORMAT_ADJUSTMENT_REASON_MAX } from '@/lib/supabase/queries/format-runtime';
import {
  actionBody,
  actionKeyParam,
  adjustmentBody,
  adjustmentListQuery,
  challengeAnswerBody,
  challengeMakeBody,
  challengeWithdrawQuery,
  checkListQuery,
  checkResolveBody,
  toAdjustmentInput,
  unmaskBody,
} from '../api-schemas';

const ID_A = '3f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5b';
const ID_B = '4f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5c';
const ID_C = '5f2b8c1e-5a47-4d0b-9f6e-0c1d2e3f4a5d';

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) => schema.safeParse(value).success;
const withAdjustment = (adjustment: unknown, reason = 'a fair reason') => ({ reason, adjustment });

describe('actions', () => {
  it('accepts a list of picks and refuses an extra member, a bad step and a bad key', () => {
    expect(ok(actionBody, { picks: [{ step: 0, item_id: 'garchomp' }] })).toBe(true);
    expect(ok(actionBody, { picks: [] })).toBe(true);
    expect(ok(actionBody, { picks: [], actor_id: ID_A })).toBe(false);
    expect(ok(actionBody, { picks: [{ step: 8, item_id: 'garchomp' }] })).toBe(false);
    expect(ok(actionBody, { picks: [{ step: -1, item_id: 'garchomp' }] })).toBe(false);
    expect(ok(actionBody, { picks: [{ step: 0.5, item_id: 'garchomp' }] })).toBe(false);
    expect(ok(actionBody, { picks: [{ step: 0, item_id: 'Not A Key' }] })).toBe(false);
    expect(ok(actionBody, { picks: [{ step: 0, item_id: 'garchomp', extra: 1 }] })).toBe(false);
    expect(ok(actionBody, {})).toBe(false);
  });

  it('refuses more picks than 8 steps of 16', () => {
    const many = (n: number) => ({ picks: Array.from({ length: n }, () => ({ step: 0, item_id: 'a' })) });
    expect(ok(actionBody, many(128))).toBe(true);
    expect(ok(actionBody, many(129))).toBe(false);
  });

  it('takes a format key as the action id', () => {
    expect(ok(actionKeyParam, 'choose_gift')).toBe(true);
    expect(ok(actionKeyParam, '../x')).toBe(false);
    expect(ok(actionKeyParam, 'Choose')).toBe(false);
  });
});

describe('challenges', () => {
  it('needs uuids and refuses extra members (the challenger is always the session player)', () => {
    expect(ok(challengeMakeBody, { phase_id: ID_A, defender_id: ID_B })).toBe(true);
    expect(ok(challengeMakeBody, { phase_id: ID_A, defender_id: 'nope' })).toBe(false);
    expect(ok(challengeMakeBody, { phase_id: ID_A, defender_id: ID_B, challenger_id: ID_C })).toBe(false);
    expect(ok(challengeAnswerBody, { accept: true })).toBe(true);
    expect(ok(challengeAnswerBody, { accept: 'yes' })).toBe(false);
    expect(ok(challengeAnswerBody, {})).toBe(false);
  });

  it('reads the withdraw query: self by default, admin on request, nothing else', () => {
    expect(challengeWithdrawQuery.parse({})).toEqual({ as: 'self' });
    expect(challengeWithdrawQuery.parse({ as: 'admin' })).toEqual({ as: 'admin' });
    expect(ok(challengeWithdrawQuery, { as: 'root' })).toBe(false);
    expect(ok(challengeWithdrawQuery, { as: 'self', x: '1' })).toBe(false);
  });
});

describe('adjustments', () => {
  it('accepts every submittable kind', () => {
    const bodies = [
      { kind: 'points', stage: 'main', player_id: ID_A, points: 2 },
      { kind: 'rank', stage: 'main', order: [ID_A, ID_B] },
      { kind: 'resource', resource: 'picks', player_id: ID_A, item_id: 'garchomp', amount: 1 },
      { kind: 'resource', resource: 'coins', player_id: ID_A, amount: -2 },
      { kind: 'relation', relation: 'santa', reveal: true },
      { kind: 'relation', relation: 'santa', draw: true },
      { kind: 'relation', relation: 'santa', draw: true, reveal: true },
      { kind: 'relation', relation: 'santa', links: [{ from: ID_A, to: ID_B }, { from: ID_B, to: ID_A }] },
      { kind: 'action', action: 'choose_gift', state: 'locked' },
      { kind: 'domain', domain: 'pool', add: [{ id: 'mew', attrs: [] }], remove: ['pikachu'] },
    ];
    for (const adjustment of bodies) expect(ok(adjustmentBody, withAdjustment(adjustment)), JSON.stringify(adjustment)).toBe(true);
  });

  it('refuses the outcome kind: it is record-only and not exposed', () => {
    expect(ok(adjustmentBody, withAdjustment({ kind: 'outcome', match_id: ID_A }))).toBe(false);
    expect(ok(adjustmentBody, withAdjustment({ kind: 'nope' }))).toBe(false);
  });

  it('refuses an extra member at either level', () => {
    expect(ok(adjustmentBody, { ...withAdjustment({ kind: 'action', action: 'a', state: 'open' }), admin_id: ID_A })).toBe(false);
    expect(ok(adjustmentBody, withAdjustment({ kind: 'action', action: 'a', state: 'open', extra: true }))).toBe(false);
  });

  it('needs a relation adjustment to reveal or to set links', () => {
    expect(ok(adjustmentBody, withAdjustment({ kind: 'relation', relation: 'santa' }))).toBe(false);
    expect(ok(adjustmentBody, withAdjustment({ kind: 'relation', relation: 'santa', reveal: false }))).toBe(false);
    expect(ok(adjustmentBody, withAdjustment({ kind: 'relation', relation: 'santa', reveal: true }))).toBe(true);
  });

  it('accepts a draw alone but not an empty or exclusive-violating one', () => {
    expect(ok(adjustmentBody, withAdjustment({ kind: 'relation', relation: 'santa', draw: true }))).toBe(true);
    expect(ok(adjustmentBody, withAdjustment({ kind: 'relation', relation: 'santa', draw: false }))).toBe(false);
    expect(ok(adjustmentBody, withAdjustment({ kind: 'relation', relation: 'santa', draw: 'yes' }))).toBe(false);
    // A draw makes the links itself: explicit links next to it are ambiguous.
    expect(
      ok(adjustmentBody, withAdjustment({ kind: 'relation', relation: 'santa', draw: true, links: [{ from: ID_A, to: ID_B }, { from: ID_B, to: ID_A }] })),
    ).toBe(false);
  });

  it('maps a draw into the library input', () => {
    const parsed = adjustmentBody.parse(withAdjustment({ kind: 'relation', relation: 'santa', draw: true }));
    expect(toAdjustmentInput(parsed.adjustment)).toEqual({ kind: 'relation', relation: 'santa', draw: true });
  });

  it('refuses a link to oneself, a giver twice and a receiver twice', () => {
    const relation = (links: unknown) => withAdjustment({ kind: 'relation', relation: 'santa', links });
    expect(ok(adjustmentBody, relation([{ from: ID_A, to: ID_A }]))).toBe(false);
    expect(ok(adjustmentBody, relation([{ from: ID_A, to: ID_B }, { from: ID_A, to: ID_C }]))).toBe(false);
    expect(ok(adjustmentBody, relation([{ from: ID_A, to: ID_C }, { from: ID_B, to: ID_C }]))).toBe(false);
    expect(ok(adjustmentBody, relation([{ from: 'x', to: ID_B }]))).toBe(false);
  });

  it('needs a domain adjustment to add or remove, with unique added ids', () => {
    expect(ok(adjustmentBody, withAdjustment({ kind: 'domain', domain: 'pool' }))).toBe(false);
    expect(ok(adjustmentBody, withAdjustment({ kind: 'domain', domain: 'pool', add: [{ id: 'mew' }, { id: 'mew' }] }))).toBe(false);
    expect(ok(adjustmentBody, withAdjustment({ kind: 'domain', domain: 'pool', remove: ['mew'] }))).toBe(true);
    const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i}` }));
    expect(ok(adjustmentBody, withAdjustment({ kind: 'domain', domain: 'pool', add: entries(512) }))).toBe(true);
    expect(ok(adjustmentBody, withAdjustment({ kind: 'domain', domain: 'pool', add: entries(513) }))).toBe(false);
  });

  it('needs a rank order without a duplicate', () => {
    expect(ok(adjustmentBody, withAdjustment({ kind: 'rank', stage: 'main', order: [ID_A, ID_A] }))).toBe(false);
    expect(ok(adjustmentBody, withAdjustment({ kind: 'rank', stage: 'main', order: [] }))).toBe(false);
  });

  it('bounds the points to ±1000 with at most two decimals, and refuses zero', () => {
    const points = (value: number) => withAdjustment({ kind: 'points', stage: 'main', player_id: ID_A, points: value });
    expect(ok(adjustmentBody, points(0.5))).toBe(true);
    expect(ok(adjustmentBody, points(-1000))).toBe(true);
    expect(ok(adjustmentBody, points(1000))).toBe(true);
    expect(ok(adjustmentBody, points(1000.01))).toBe(false);
    expect(ok(adjustmentBody, points(0.001))).toBe(false);
    expect(ok(adjustmentBody, points(0))).toBe(false);
    expect(ok(adjustmentBody, points(Number.NaN))).toBe(false);
  });

  it('refuses an amount of zero or a fraction for a resource', () => {
    const amount = (value: number) => withAdjustment({ kind: 'resource', resource: 'coins', player_id: ID_A, amount: value });
    expect(ok(adjustmentBody, amount(0))).toBe(false);
    expect(ok(adjustmentBody, amount(1.5))).toBe(false);
    expect(ok(adjustmentBody, amount(65))).toBe(false);
    expect(ok(adjustmentBody, amount(-64))).toBe(true);
  });

  it('counts the reason in code points: 500 pass, 501 do not, an emoji counts once', () => {
    const action = { kind: 'action', action: 'a', state: 'open' };
    expect(ok(adjustmentBody, withAdjustment(action, 'x'.repeat(500)))).toBe(true);
    expect(ok(adjustmentBody, withAdjustment(action, 'x'.repeat(501)))).toBe(false);
    expect(ok(adjustmentBody, withAdjustment(action, '😀'.repeat(500)))).toBe(true);
    expect(ok(adjustmentBody, withAdjustment(action, '😀'.repeat(501)))).toBe(false);
  });

  it('trims the reason and refuses a blank or unstorable one', () => {
    const action = { kind: 'action', action: 'a', state: 'open' };
    expect(adjustmentBody.parse(withAdjustment(action, '  fair  ')).reason).toBe('fair');
    expect(ok(adjustmentBody, withAdjustment(action, '   '))).toBe(false);
    expect(ok(adjustmentBody, withAdjustment(action, 'nul\u0000byte'))).toBe(false);
  });

  it('maps every kind to the library input (snake_case to camelCase), one place', () => {
    const parse = (adjustment: unknown) => toAdjustmentInput(adjustmentBody.parse(withAdjustment(adjustment)).adjustment);
    expect(parse({ kind: 'points', stage: 'main', player_id: ID_A, points: 2 })).toEqual({ kind: 'points', stage: 'main', playerId: ID_A, points: 2 });
    expect(parse({ kind: 'rank', stage: 'main', order: [ID_A, ID_B] })).toEqual({ kind: 'rank', stage: 'main', order: [ID_A, ID_B] });
    expect(parse({ kind: 'resource', resource: 'picks', player_id: ID_A, item_id: 'mew', amount: 1 })).toEqual({
      kind: 'resource',
      resource: 'picks',
      playerId: ID_A,
      itemId: 'mew',
      amount: 1,
    });
    expect(parse({ kind: 'resource', resource: 'coins', player_id: ID_A, amount: -1 })).toEqual({ kind: 'resource', resource: 'coins', playerId: ID_A, amount: -1 });
    expect(parse({ kind: 'relation', relation: 'santa', reveal: true })).toEqual({ kind: 'relation', relation: 'santa', reveal: true });
    expect(parse({ kind: 'relation', relation: 'santa', links: [{ from: ID_A, to: ID_B }] })).toEqual({
      kind: 'relation',
      relation: 'santa',
      links: [{ from: ID_A, to: ID_B }],
    });
    expect(parse({ kind: 'action', action: 'a', state: 'locked' })).toEqual({ kind: 'action', action: 'a', state: 'locked' });
    expect(parse({ kind: 'domain', domain: 'pool', add: [{ id: 'mew' }], remove: ['x'] })).toEqual({
      kind: 'domain',
      domain: 'pool',
      add: [{ id: 'mew', attrs: [] }],
      remove: ['x'],
    });
  });
});

describe('checks and lists', () => {
  it('resolves with a verdict (not a status) and an optional note', () => {
    expect(ok(checkResolveBody, { verdict: 'confirmed' })).toBe(true);
    expect(ok(checkResolveBody, { verdict: 'rejected', note: 'seen' })).toBe(true);
    expect(ok(checkResolveBody, { status: 'confirmed' })).toBe(false);
    expect(ok(checkResolveBody, { verdict: 'open' })).toBe(false);
    expect(ok(checkResolveBody, { verdict: 'confirmed', note: 'x'.repeat(501) })).toBe(false);
    expect(ok(checkResolveBody, { verdict: 'confirmed', note: 'bad\u0000' })).toBe(false);
    expect(checkResolveBody.parse({ verdict: 'confirmed', note: '  ' }).note).toBe('');
  });

  it('counts the note in code points (as the admin counter), so 500 emoji fit and 501 do not', () => {
    const emoji = String.fromCodePoint(0x1f600);
    expect(ok(checkResolveBody, { verdict: 'confirmed', note: emoji.repeat(FORMAT_ADJUSTMENT_REASON_MAX) })).toBe(true);
    expect(ok(checkResolveBody, { verdict: 'confirmed', note: emoji.repeat(FORMAT_ADJUSTMENT_REASON_MAX + 1) })).toBe(false);
  });

  it('keeps the admin counter limit in step with the server limit', () => {
    expect(TEXT_MAX).toBe(FORMAT_ADJUSTMENT_REASON_MAX);
  });

  it('reads the list queries with defaults and bounds', () => {
    expect(checkListQuery.parse({})).toEqual({ status: 'open', limit: 50, offset: 0 });
    expect(checkListQuery.parse({ status: 'all', limit: '10', offset: '20' })).toEqual({ status: 'all', limit: 10, offset: 20 });
    expect(ok(checkListQuery, { status: 'whatever' })).toBe(false);
    expect(ok(checkListQuery, { limit: '0' })).toBe(false);
    expect(ok(checkListQuery, { limit: '101' })).toBe(false);
    expect(ok(checkListQuery, { offset: '-1' })).toBe(false);
    expect(ok(checkListQuery, { offset: '10001' })).toBe(false);
    expect(adjustmentListQuery.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(ok(adjustmentListQuery, { status: 'open' })).toBe(false);
  });

  it('takes an empty unmask body only', () => {
    expect(ok(unmaskBody, {})).toBe(true);
    expect(ok(unmaskBody, { include_hidden: true })).toBe(false);
  });
});
