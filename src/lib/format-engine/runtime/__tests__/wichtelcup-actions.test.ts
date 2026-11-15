import { describe, expect, it } from 'vitest';
import { compile } from '@/lib/format-kit/compile';
import { wichtelcup } from '@/lib/format-kit/presets/wichtelcup';
import type { FormatDefinition } from '@/lib/format-kit/types';
import { validateActionSubmission, type ActionIssue } from '../actions';
import type { ActionPick, KitRuntimeState } from '../types';
import { item, link, stateFor } from './helpers';

// The gift form of the shipped Wichtelcup EXAMPLE: what `choose_gifts` accepts and refuses, with the made-up pools.

const compiled = compile(wichtelcup);
if (compiled.definition === null) throw new Error('the Wichtelcup example does not compile');
const DEF = compiled.definition as FormatDefinition;

const ROSTER = ['p1', 'p2', 'p3', 'p4'];
const OPEN = { 'action:choose_gifts': 'open' };
/** p1 gives to p2. Roles: starmie removes hazards, golem sets them, blissey stalls, clefable supports. */
const LINKS = [link('p1', 'p2'), link('p2', 'p3'), link('p3', 'p1')];

const junk = (...ids: string[]): ActionPick[] => ids.map((item_id) => ({ step: 0, item_id }));
const premium = (id: string): ActionPick => ({ step: 1, item_id: id });

function submit(picks: ActionPick[], over: { actor?: string; flags?: Record<string, string>; items?: ReturnType<typeof item>[]; amendments?: KitRuntimeState['amendments'] } = {}) {
  const state = stateFor(DEF, { links: LINKS, flags: over.flags ?? OPEN, items: over.items ?? [], amendments: over.amendments ?? [] });
  return validateActionSubmission(DEF, 'choose_gifts', over.actor ?? 'p1', picks, state, ROSTER);
}

const issuesOf = (result: ReturnType<typeof submit>): ActionIssue[] => (result.ok ? [] : result.issues);

describe('choose_gifts: a valid submission', () => {
  it('gives two junk gifts with different roles and one premium gift to the recipient', () => {
    const result = submit([...junk('starmie', 'golem'), premium('dragonite')]);
    expect(result).toEqual({
      ok: true,
      target: 'p2',
      items: [
        { resource: 'junk_gifts', item_id: 'starmie', exclusive: false },
        { resource: 'junk_gifts', item_id: 'golem', exclusive: false },
        { resource: 'premium_gift', item_id: 'dragonite', exclusive: true },
      ],
    });
  });

  it('targets the recipient of the giver, not the giver', () => {
    const result = submit([...junk('starmie', 'golem'), premium('dragonite')], { actor: 'p3' });
    expect(result.ok && result.target).toBe('p1');
  });

  it('lets another giver pick the same junk species (junk is not exclusive)', () => {
    const others = [item({ resource: 'junk_gifts', player_id: 'p3', item_id: 'starmie' }), item({ resource: 'junk_gifts', player_id: 'p3', item_id: 'golem' })];
    expect(submit([...junk('starmie', 'golem'), premium('dragonite')], { items: others }).ok).toBe(true);
  });
});

describe('choose_gifts: refusals', () => {
  it('refuses two junk gifts with the same primary role', () => {
    // The example's six junk species each carry a different role, so an amended entry sharing starmie's role exercises the check.
    const amendments = [{ domain: 'junk', add: [{ id: 'cloyster', attrs: [{ key: 'primary_role', value: 'hazard_removal' }] }] }];
    const issues = issuesOf(submit([...junk('starmie', 'cloyster'), premium('dragonite')], { amendments }));
    expect(issues).toEqual([{ code: 'distinct_attr_duplicate', step: 0, item_id: 'cloyster' }]);
  });

  it('refuses a third junk gift', () => {
    const issues = issuesOf(submit([...junk('starmie', 'golem', 'blissey'), premium('dragonite')]));
    expect(issues.map((i) => i.code)).toContain('wrong_count');
  });

  it('refuses one junk gift', () => {
    expect(issuesOf(submit([...junk('starmie'), premium('dragonite')]))).toEqual([{ code: 'wrong_count', step: 0 }]);
  });

  it('refuses a missing premium gift', () => {
    expect(issuesOf(submit(junk('starmie', 'golem')))).toEqual([{ code: 'wrong_count', step: 1 }]);
  });

  it('refuses a premium species in the junk step and a junk species in the premium step', () => {
    expect(issuesOf(submit([...junk('starmie', 'dragonite'), premium('tyranitar')]))).toContainEqual({ code: 'item_outside_domain', step: 0, item_id: 'dragonite' });
    expect(issuesOf(submit([...junk('starmie', 'golem'), premium('starmie')]))).toContainEqual({ code: 'item_outside_domain', step: 1, item_id: 'starmie' });
  });

  it('refuses a normal pool or New Year species as a gift', () => {
    expect(issuesOf(submit([...junk('starmie', 'pikachu'), premium('dragonite')]))).toContainEqual({ code: 'item_outside_domain', step: 0, item_id: 'pikachu' });
    expect(issuesOf(submit([...junk('starmie', 'golem'), premium('mewtwo')]))).toContainEqual({ code: 'item_outside_domain', step: 1, item_id: 'mewtwo' });
  });

  it('refuses a premium species another giver already reserved', () => {
    const taken = [item({ resource: 'premium_gift', player_id: 'p4', item_id: 'dragonite', exclusive: true })];
    expect(issuesOf(submit([...junk('starmie', 'golem'), premium('dragonite')], { items: taken }))).toEqual([
      { code: 'resource_item_taken', step: 1, item_id: 'dragonite' },
    ]);
  });

  it('refuses a recipient who would hold more than two junk gifts', () => {
    const held = [item({ resource: 'junk_gifts', player_id: 'p2', item_id: 'blissey' })];
    expect(issuesOf(submit([...junk('starmie', 'golem'), premium('dragonite')], { items: held })).map((i) => i.code)).toContain('capacity_exceeded');
  });

  it('refuses a player without a Secret Santa link', () => {
    expect(issuesOf(submit([...junk('starmie', 'golem'), premium('dragonite')], { actor: 'p4' })).map((i) => i.code)).toContain('actor_without_link');
  });

  it('refuses before the window opens and after it is locked', () => {
    const picks = [...junk('starmie', 'golem'), premium('dragonite')];
    expect(issuesOf(submit(picks, { flags: {} }))).toEqual([{ code: 'window_closed' }]);
    expect(issuesOf(submit(picks, { flags: { 'action:choose_gifts': 'locked' } }))).toEqual([{ code: 'window_closed' }]);
  });
});