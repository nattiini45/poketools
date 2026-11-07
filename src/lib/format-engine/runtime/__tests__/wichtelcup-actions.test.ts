import { describe, expect, it } from 'vitest';
import { compile } from '@/lib/format-kit/compile';
import { wichtelcup } from '@/lib/format-kit/presets/wichtelcup';
import type { FormatDefinition } from '@/lib/format-kit/types';
import { validateActionSubmission, type ActionIssue } from '../actions';
import type { ActionPick } from '../types';
import { item, link, stateFor } from './helpers';

// The gift form of the shipped Wichtelcup example: what `choose_gifts` accepts and refuses, with the real pools.

const compiled = compile(wichtelcup);
if (compiled.definition === null) throw new Error('the Wichtelcup example does not compile');
const DEF = compiled.definition as FormatDefinition;

const ROSTER = ['p1', 'p2', 'p3', 'p4'];
const OPEN = { 'action:choose_gifts': 'open' };
/** p1 gives to p2. Roles: bergmite and staryu remove hazards, delibird sets them, sudowoodo sets them. */
const LINKS = [link('p1', 'p2'), link('p2', 'p3'), link('p3', 'p1')];

const junk = (...ids: string[]): ActionPick[] => ids.map((item_id) => ({ step: 0, item_id }));
const premium = (id: string): ActionPick => ({ step: 1, item_id: id });

function submit(picks: ActionPick[], over: { actor?: string; flags?: Record<string, string>; items?: ReturnType<typeof item>[] } = {}) {
  const state = stateFor(DEF, { links: LINKS, flags: over.flags ?? OPEN, items: over.items ?? [] });
  return validateActionSubmission(DEF, 'choose_gifts', over.actor ?? 'p1', picks, state, ROSTER);
}

const issuesOf = (result: ReturnType<typeof submit>): ActionIssue[] => (result.ok ? [] : result.issues);

describe('choose_gifts: a valid submission', () => {
  it('gives two junk gifts with different roles and one premium gift to the recipient', () => {
    const result = submit([...junk('bergmite', 'delibird'), premium('glastrier')]);
    expect(result).toEqual({
      ok: true,
      target: 'p2',
      items: [
        { resource: 'junk_gifts', item_id: 'bergmite', exclusive: false },
        { resource: 'junk_gifts', item_id: 'delibird', exclusive: false },
        { resource: 'premium_gift', item_id: 'glastrier', exclusive: true },
      ],
    });
  });

  it('targets the recipient of the giver, not the giver', () => {
    const result = submit([...junk('bergmite', 'delibird'), premium('glastrier')], { actor: 'p3' });
    expect(result.ok && result.target).toBe('p1');
  });

  it('lets another giver pick the same junk species (junk is not exclusive)', () => {
    const others = [item({ resource: 'junk_gifts', player_id: 'p3', item_id: 'bergmite' }), item({ resource: 'junk_gifts', player_id: 'p3', item_id: 'delibird' })];
    expect(submit([...junk('bergmite', 'delibird'), premium('glastrier')], { items: others }).ok).toBe(true);
  });
});

describe('choose_gifts: refusals', () => {
  it('refuses two junk gifts with the same primary role', () => {
    const issues = issuesOf(submit([...junk('bergmite', 'staryu'), premium('glastrier')]));
    expect(issues).toEqual([{ code: 'distinct_attr_duplicate', step: 0, item_id: 'staryu' }]);
  });

  it('refuses a third junk gift', () => {
    const issues = issuesOf(submit([...junk('bergmite', 'delibird', 'bronzor'), premium('glastrier')]));
    expect(issues.map((i) => i.code)).toContain('wrong_count');
  });

  it('refuses one junk gift', () => {
    expect(issuesOf(submit([...junk('bergmite'), premium('glastrier')]))).toEqual([{ code: 'wrong_count', step: 0 }]);
  });

  it('refuses a missing premium gift', () => {
    expect(issuesOf(submit(junk('bergmite', 'delibird')))).toEqual([{ code: 'wrong_count', step: 1 }]);
  });

  it('refuses a premium species in the junk step and a junk species in the premium step', () => {
    expect(issuesOf(submit([...junk('bergmite', 'glastrier'), premium('tyranitar')]))).toContainEqual({ code: 'item_outside_domain', step: 0, item_id: 'glastrier' });
    expect(issuesOf(submit([...junk('bergmite', 'delibird'), premium('staryu')]))).toContainEqual({ code: 'item_outside_domain', step: 1, item_id: 'staryu' });
  });

  it('refuses a normal pool or New Year species as a gift', () => {
    expect(issuesOf(submit([...junk('bergmite', 'abomasnow'), premium('glastrier')]))).toContainEqual({ code: 'item_outside_domain', step: 0, item_id: 'abomasnow' });
    expect(issuesOf(submit([...junk('bergmite', 'delibird'), premium('necrozma')]))).toContainEqual({ code: 'item_outside_domain', step: 1, item_id: 'necrozma' });
  });

  it('refuses a premium species another giver already reserved', () => {
    const taken = [item({ resource: 'premium_gift', player_id: 'p4', item_id: 'glastrier', exclusive: true })];
    expect(issuesOf(submit([...junk('bergmite', 'delibird'), premium('glastrier')], { items: taken }))).toEqual([
      { code: 'resource_item_taken', step: 1, item_id: 'glastrier' },
    ]);
  });

  it('refuses a recipient who would hold more than two junk gifts', () => {
    const held = [item({ resource: 'junk_gifts', player_id: 'p2', item_id: 'snover' })];
    expect(issuesOf(submit([...junk('bergmite', 'delibird'), premium('glastrier')], { items: held })).map((i) => i.code)).toContain('capacity_exceeded');
  });

  it('refuses a player without a Secret Santa link', () => {
    expect(issuesOf(submit([...junk('bergmite', 'delibird'), premium('glastrier')], { actor: 'p4' })).map((i) => i.code)).toContain('actor_without_link');
  });

  it('refuses before the window opens and after it is locked', () => {
    const picks = [...junk('bergmite', 'delibird'), premium('glastrier')];
    expect(issuesOf(submit(picks, { flags: {} }))).toEqual([{ code: 'window_closed' }]);
    expect(issuesOf(submit(picks, { flags: { 'action:choose_gifts': 'locked' } }))).toEqual([{ code: 'window_closed' }]);
  });
});
