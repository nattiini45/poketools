import { describe, expect, it } from 'vitest';
import { isActionWindowOpen, findAction, validateActionSubmission, type ActionIssueCode } from '../actions';
import type { ActionPick, KitRuntimeState } from '../types';
import { PLAYERS, SEED, giftDef, item, link, stateFor } from './helpers';

const def = giftDef();

function open(patch: Partial<KitRuntimeState> = {}): KitRuntimeState {
  return stateFor(def, { flags: { 'action:choose_gift': 'open', 'domain:pool': 'unlocked' }, links: [link('p1', 'p2')], ...patch });
}
const pick = (item_id: string, step = 0): ActionPick => ({ step, item_id });
const run = (picks: ActionPick[], state = open(), actor = 'p1') => validateActionSubmission(def, 'choose_gift', actor, picks, state, PLAYERS, SEED);
const codes = (result: ReturnType<typeof run>): ActionIssueCode[] => (result.ok ? [] : result.issues.map((i) => i.code));

describe('validateActionSubmission', () => {
  it('accepts a valid pick set and names the target', () => {
    const result = run([pick('garchomp'), pick('blissey')]);
    expect(result).toEqual({
      ok: true,
      target: 'p2',
      items: [
        { resource: 'picks', item_id: 'garchomp', exclusive: true },
        { resource: 'picks', item_id: 'blissey', exclusive: true },
      ],
    });
  });

  it('rejects an unknown action', () => {
    const result = validateActionSubmission(def, 'nope', 'p1', [], open(), PLAYERS, SEED);
    expect(result).toEqual({ ok: false, issues: [{ code: 'action_unknown' }] });
  });

  it('rejects a closed window', () => {
    expect(codes(run([pick('garchomp'), pick('blissey')], open({ flags: { 'action:choose_gift': 'locked', 'domain:pool': 'unlocked' } })))).toContain('window_closed');
    const rule = findAction(def, 'choose_gift')!;
    expect(isActionWindowOpen(rule, { flags: {} })).toBe(false);
    expect(isActionWindowOpen(rule, { flags: { 'action:choose_gift': 'open' } })).toBe(true);
    expect(isActionWindowOpen(rule, { flags: { 'action:choose_gift': 'locked' } })).toBe(false);
  });

  it('rejects an actor without a link', () => {
    expect(codes(run([pick('garchomp'), pick('blissey')], open(), 'p3'))).toContain('actor_without_link');
    expect(codes(run([pick('garchomp'), pick('blissey')], open(), 'p2'))).toContain('actor_without_link');
  });

  it('rejects a wrong count and an unknown step', () => {
    expect(codes(run([pick('garchomp')]))).toContain('wrong_count');
    expect(codes(run([pick('garchomp'), pick('blissey'), pick('corviknight')]))).toContain('wrong_count');
    expect(codes(run([pick('garchomp'), pick('blissey'), pick('corviknight', 4)]))).toContain('step_unknown');
  });

  it('rejects a locked domain', () => {
    expect(codes(run([pick('garchomp'), pick('blissey')], open({ flags: { 'action:choose_gift': 'open' } })))).toContain('domain_locked');
  });

  it('rejects an item outside the domain and a duplicate', () => {
    expect(codes(run([pick('garchomp'), pick('mew')]))).toContain('item_outside_domain');
    expect(codes(run([pick('garchomp'), pick('garchomp')]))).toContain('duplicate_item');
  });

  it('rejects an item the where expression refuses', () => {
    const state = open({ amendments: [{ domain: 'pool', add: [{ id: 'magikarp', attrs: [{ key: 'role', value: 'tank' }, { key: 'bonus', value: 0 }] }] }] });
    const result = run([pick('garchomp'), pick('magikarp')], state);
    expect(result).toEqual({ ok: false, issues: [{ code: 'where_false', step: 0, item_id: 'magikarp' }] });
  });

  it('rejects two picks with the same distinct attribute', () => {
    const state = open({ amendments: [{ domain: 'pool', add: [{ id: 'metagross', attrs: [{ key: 'role', value: 'attacker' }, { key: 'bonus', value: 1 }] }] }] });
    expect(codes(run([pick('garchomp'), pick('metagross')], state))).toEqual(['distinct_attr_duplicate']);
  });

  it('rejects past the capacity of the beneficiary', () => {
    const state = open({ items: [item({ resource: 'picks', player_id: 'p2', item_id: 'corviknight', exclusive: true })] });
    expect(codes(run([pick('garchomp'), pick('blissey')], state))).toContain('capacity_exceeded');
  });

  it('rejects an exclusive item somebody else holds', () => {
    const state = open({ items: [item({ resource: 'picks', player_id: 'p5', item_id: 'blissey', exclusive: true })] });
    expect(run([pick('garchomp'), pick('blissey')], state)).toEqual({
      ok: false,
      issues: [{ code: 'resource_item_taken', step: 0, item_id: 'blissey' }],
    });
  });

  it('lets a resubmission take over the items of the actor\'s earlier submission', () => {
    const state = open({
      submissions: [{ id: 's1', action: 'choose_gift', actor: 'p1', target: 'p2', status: 'draft', picks: [pick('garchomp'), pick('blissey')] }],
      items: [
        item({ resource: 'picks', player_id: 'p2', item_id: 'garchomp', exclusive: true, source: 'action', source_ref: 's1' }),
        item({ resource: 'picks', player_id: 'p2', item_id: 'blissey', exclusive: true, source: 'action', source_ref: 's1' }),
      ],
    });
    expect(run([pick('garchomp'), pick('blissey')], state).ok).toBe(true);
  });

  it('reports every problem, not the first', () => {
    const result = run([pick('mew')], open({ flags: {} }));
    expect(codes(result)).toEqual(expect.arrayContaining(['window_closed', 'domain_locked', 'item_outside_domain', 'wrong_count']));
  });
});
