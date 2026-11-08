import { describe, expect, it } from 'vitest';
import { actorAccess, isActionWindowOpen, findAction, validateActionSubmission, type ActionIssueCode } from '../actions';
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

  it('refuses a giver who holds a link but is no longer in the league (not on the roster), and says why', () => {
    const roster = PLAYERS.filter((id) => id !== 'p1');
    const result = validateActionSubmission(def, 'choose_gift', 'p1', [pick('garchomp'), pick('blissey')], open(), roster, SEED);
    expect(result).toEqual({ ok: false, issues: [{ code: 'actor_not_in_league' }] });
    // The system's deadline pick is refused the same way: it never draws for a player who left.
    const system = validateActionSubmission(def, 'choose_gift', 'p1', [pick('garchomp'), pick('blissey')], open(), roster, SEED, { audience: 'system' });
    expect(system).toEqual({ ok: false, issues: [{ code: 'actor_not_in_league' }] });
    // The same pick from a giver who is still enrolled is accepted.
    expect(validateActionSubmission(def, 'choose_gift', 'p1', [pick('garchomp'), pick('blissey')], open(), PLAYERS, SEED).ok).toBe(true);
  });

  it('refuses a linked giver when nobody is enrolled at all (an empty roster is no place in the league)', () => {
    expect(codes(validateActionSubmission(def, 'choose_gift', 'p1', [pick('garchomp'), pick('blissey')], open(), [], SEED))).toEqual(['actor_not_in_league']);
  });

  it('reports no link before it reports a missing place in the league', () => {
    const roster = PLAYERS.filter((id) => id !== 'p3');
    expect(codes(validateActionSubmission(def, 'choose_gift', 'p3', [pick('garchomp'), pick('blissey')], open(), roster, SEED))).toEqual(['actor_without_link']);
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
    const result = run([pick('mew')], open({ flags: { 'action:choose_gift': 'locked', 'domain:pool': 'unlocked' } }));
    expect(codes(result)).toEqual(expect.arrayContaining(['window_closed', 'item_outside_domain', 'wrong_count']));
  });
});

describe('validateActionSubmission audience', () => {
  const adminsDef = { ...def, domains: (def.domains ?? []).map((d) => (d.key === 'pool' ? { ...d, visibility: 'admins' as const } : d)) };
  const unlocked = stateFor(adminsDef, { flags: { 'action:choose_gift': 'open', 'domain:pool': 'unlocked' }, links: [link('p1', 'p2')] });
  const picks = [pick('garchomp'), pick('blissey')];

  it('answers a domain only admins see with domain_locked alone: a real id and an unknown one get the same answer', () => {
    const real = validateActionSubmission(adminsDef, 'choose_gift', 'p1', picks, unlocked, PLAYERS, SEED);
    expect(real).toEqual({ ok: false, issues: [{ code: 'domain_locked', step: 0 }] });
    const unknown = validateActionSubmission(adminsDef, 'choose_gift', 'p1', [pick('mew'), pick('mewtwo')], unlocked, PLAYERS, SEED);
    expect(unknown).toEqual(real);
  });

  it('never names a pick of a hidden pool: no item_outside_domain, where_false, duplicate or taken, whatever the ids', () => {
    const held = stateFor(adminsDef, {
      flags: { 'action:choose_gift': 'open', 'domain:pool': 'unlocked' },
      links: [link('p1', 'p2')],
      items: [item({ resource: 'picks', player_id: 'p5', item_id: 'blissey', exclusive: true })],
    });
    const result = validateActionSubmission(adminsDef, 'choose_gift', 'p1', [pick('blissey'), pick('blissey'), pick('mew')], held, PLAYERS, SEED);
    expect(result).toEqual({ ok: false, issues: [{ code: 'wrong_count', step: 0 }, { code: 'domain_locked', step: 0 }] });
    expect(JSON.stringify(result)).not.toContain('blissey');
    expect(JSON.stringify(result)).not.toContain('mew');
  });

  it('accepts the same ids for the system (a deadline pick draws from the whole list)', () => {
    const result = validateActionSubmission(adminsDef, 'choose_gift', 'p1', picks, unlocked, PLAYERS, SEED, { audience: 'system' });
    expect(result.ok).toBe(true);
  });

  it('keeps a public and a when_unlocked domain as they are for a player', () => {
    expect(run(picks).ok).toBe(true);
    const publicDef = { ...def, domains: (def.domains ?? []).map((d) => (d.key === 'pool' ? { ...d, visibility: 'public' as const } : d)) };
    const publicState = stateFor(publicDef, { flags: { 'action:choose_gift': 'open', 'domain:pool': 'unlocked' }, links: [link('p1', 'p2')] });
    expect(validateActionSubmission(publicDef, 'choose_gift', 'p1', picks, publicState, PLAYERS, SEED).ok).toBe(true);
  });

  it('reports a locked when_unlocked domain as domain_locked alone, not as item_outside_domain', () => {
    const result = run(picks, open({ flags: { 'action:choose_gift': 'open' } }));
    expect(codes(result)).toEqual(['domain_locked']);
  });

  it('does not say whether a pick belongs to a locked pool: a member and a non-member get the same answer', () => {
    const lockedState = open({ flags: { 'action:choose_gift': 'open' } });
    const member = run(picks, lockedState);
    const nonMember = run([pick('mew'), pick('mewtwo')], lockedState);
    expect(member).toEqual({ ok: false, issues: [{ code: 'domain_locked', step: 0 }] });
    expect(nonMember).toEqual(member);
    expect(JSON.stringify(nonMember)).not.toContain('mew');
  });

  it('still runs the per-pick checks for the system on a locked pool', () => {
    const lockedState = open({ flags: { 'action:choose_gift': 'open' } });
    const result = validateActionSubmission(def, 'choose_gift', 'p1', [pick('garchomp'), pick('mew')], lockedState, PLAYERS, SEED, { audience: 'system' });
    expect(result.ok ? [] : result.issues.map((i) => i.code)).toEqual(['domain_locked', 'item_outside_domain']);
  });
});

describe('actorAccess', () => {
  const rule = findAction(def, 'choose_gift')!;
  const links = [link('p1', 'p2')];

  it('lets an enrolled giver with a link act, and names the recipient', () => {
    expect(actorAccess(rule, 'p1', { links }, PLAYERS)).toEqual({ ok: true, target: 'p2' });
  });

  it('refuses a giver who left the league with the code the views and the submit share', () => {
    expect(actorAccess(rule, 'p1', { links }, ['p2'])).toEqual({ ok: false, code: 'actor_not_in_league' });
    expect(actorAccess(rule, 'p2', { links }, PLAYERS)).toEqual({ ok: false, code: 'actor_without_link' });
  });
});
