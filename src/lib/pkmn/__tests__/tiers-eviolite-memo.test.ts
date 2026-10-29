/**
 * The Eviolite tier cap rescanned the whole dex on every team validation (#54). The banned set depends only on
 * `(universe, gen, cap)`, so it is computed once per process, and only for a team that holds an Eviolite.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamConstraints } from '@/types/ruleset';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { makeSet } from '@/test/team-fixtures';

const scans = vi.hoisted(() => ({ count: 0 }));

// Count the dex-wide scans without changing what they return: `getGeneration(...).species` is iterated once per scan.
vi.mock('../dex', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../dex')>();
  return {
    ...actual,
    getGeneration: (gen?: number) => {
      const generation = actual.getGeneration(gen);
      return new Proxy(generation, {
        get(target, prop, receiver) {
          if (prop === 'species') {
            return new Proxy(target.species, {
              get(speciesTarget, speciesProp) {
                if (speciesProp === Symbol.iterator) {
                  scans.count += 1;
                  return speciesTarget[Symbol.iterator].bind(speciesTarget);
                }
                const value = Reflect.get(speciesTarget, speciesProp);
                return typeof value === 'function' ? value.bind(speciesTarget) : value;
              },
            });
          }
          return Reflect.get(target, prop, receiver);
        },
      });
    },
  };
});

import { computeEvioliteBannedSpecies } from '../tiers';
import { validateTeam } from '../validation';

const CAP: TeamConstraints = { eviolite_tier_cap: 'RU' };
const RULESET = makeRuleset({ base_format: 'gen9ru', team_constraints: CAP, clauses: [] });

describe('computeEvioliteBannedSpecies', () => {
  beforeEach(() => {
    scans.count = 0;
  });

  it('returns the same instance for the same generation and cap, scanning the dex once', () => {
    const first = computeEvioliteBannedSpecies(9, 'UU');
    const scansAfterFirst = scans.count;
    const second = computeEvioliteBannedSpecies(9, 'UU');

    expect(second).toBe(first);
    expect(scansAfterFirst).toBeGreaterThan(0);
    expect(scans.count).toBe(scansAfterFirst);
  });

  it('keeps a result per generation, cap and universe', () => {
    const gen9 = computeEvioliteBannedSpecies(9, 'RU');
    expect(computeEvioliteBannedSpecies(8, 'RU')).not.toBe(gen9);
    expect(computeEvioliteBannedSpecies(9, 'NU')).not.toBe(gen9);
    expect(computeEvioliteBannedSpecies(9, 'RU', 'national')).not.toBe(gen9);
    expect(computeEvioliteBannedSpecies(9, 'RU')).toBe(gen9);
  });

  it('still names the NFEs whose evolution is above the cap', () => {
    const banned = computeEvioliteBannedSpecies(9, 'RU');
    expect(banned.has('gligar')).toBe(true); // Gliscor is OU
    expect(banned.has('scyther')).toBe(true); // Scizor is OU
    expect(banned.has('chansey')).toBe(false); // Blissey is not above RU
    expect(banned.has('garchomp')).toBe(false); // fully evolved: Eviolite does nothing for it anyway
  });
});

describe('validateTeam and the Eviolite scan', () => {
  beforeEach(() => {
    // Warm the memo for the cap under test, so a scan during validation would be a rescan.
    computeEvioliteBannedSpecies(9, 'RU');
    scans.count = 0;
  });

  it('does not touch the scan for a team without an Eviolite, even for a fresh generation and cap', () => {
    const fresh = makeRuleset({ base_format: 'gen9ru', team_constraints: { eviolite_tier_cap: 'PU' }, clauses: [] });
    const result = validateTeam([makeSet('Garchomp'), makeSet('Dragonite', { ability: 'Multiscale' })], fresh);
    expect(result.valid).toBe(true);
    expect(scans.count).toBe(0);
  });

  it('judges Eviolite by item id, however it is written', () => {
    const gligar = (item: string) => makeSet('Gligar', { item, ability: 'Hyper Cutter', moves: ['Earthquake'] });
    for (const item of ['Eviolite', 'eviolite', 'EVIOLITE']) {
      const result = validateTeam([gligar(item)], RULESET);
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'eviolite_tier_cap' }));
    }
  });

  it('scans at most once for many teams (the pin-impact loop runs 4000 validations)', () => {
    const fresh = makeRuleset({ base_format: 'gen9ru', team_constraints: { eviolite_tier_cap: 'ZU' }, clauses: [] });
    for (let i = 0; i < 50; i++) {
      validateTeam([makeSet('Gligar', { item: 'Eviolite', ability: 'Hyper Cutter', moves: ['Earthquake'] })], fresh);
    }
    expect(scans.count).toBeLessThanOrEqual(1);
  });
});
