import { describe, expect, it } from 'vitest';
import { validateActionSubmission } from '../actions';
import { planRandomPicks } from '../random-pick';
import { PLAYERS, SEED, giftDef, link, stateFor } from './helpers';

const base = giftDef();
const adminsDef = { ...base, domains: (base.domains ?? []).map((d) => (d.key === 'pool' ? { ...d, visibility: 'admins' as const } : d)) };
const state = (def: typeof base) =>
  stateFor(def, { flags: { 'action:choose_gift': 'open', 'domain:pool': 'unlocked' }, links: [link('p1', 'p2')] });

describe('planRandomPicks', () => {
  it('draws a valid set of picks, the same one for the same state and seed', () => {
    const first = planRandomPicks(base, 'choose_gift', 'p1', state(base), PLAYERS, SEED);
    expect(first).not.toBeNull();
    expect(first).toHaveLength(2);
    expect(planRandomPicks(base, 'choose_gift', 'p1', state(base), PLAYERS, SEED)).toEqual(first);
    expect(validateActionSubmission(base, 'choose_gift', 'p1', first ?? [], state(base), PLAYERS, SEED).ok).toBe(true);
  });

  it('still draws from a domain only admins see: the deadline pick is the system, not a player', () => {
    const picks = planRandomPicks(adminsDef, 'choose_gift', 'p1', state(adminsDef), PLAYERS, SEED);
    expect(picks).not.toBeNull();
    expect(picks).toHaveLength(2);
    // The same picks are refused for a player, who cannot see the domain.
    const asPlayer = validateActionSubmission(adminsDef, 'choose_gift', 'p1', picks ?? [], state(adminsDef), PLAYERS, SEED);
    expect(asPlayer.ok).toBe(false);
    const asSystem = validateActionSubmission(adminsDef, 'choose_gift', 'p1', picks ?? [], state(adminsDef), PLAYERS, SEED, { audience: 'system' });
    expect(asSystem.ok).toBe(true);
  });

  it('gives up (null) for an actor without a link and for an unknown action', () => {
    expect(planRandomPicks(base, 'choose_gift', 'p3', state(base), PLAYERS, SEED)).toBeNull();
    expect(planRandomPicks(base, 'nope', 'p1', state(base), PLAYERS, SEED)).toBeNull();
  });
});
