import { describe, expect, it } from 'vitest';
import { CLAUSES, clauseId, clauseName, getClause, isEnforcedClause } from '../clauses';
import { PRESETS } from '../format-catalog';
import { toID } from '../i18n/id';

describe('the clause catalog', () => {
  it('has unique ids that are the id fold of the Showdown name', () => {
    const ids = CLAUSES.map((clause) => clause.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const clause of CLAUSES) expect(clause.id, clause.name).toBe(toID(clause.name));
  });

  it('enforces exactly the species and item clauses, and says so for every other clause', () => {
    expect(CLAUSES.filter((clause) => clause.enforcement === 'validator').map((clause) => clause.id)).toEqual(['speciesclause', 'itemclause']);
    expect(isEnforcedClause('Species Clause')).toBe(true);
    expect(isEnforcedClause('itemclause')).toBe(true);
    expect(isEnforcedClause('Sleep Clause Mod')).toBe(false);
    expect(isEnforcedClause('OHKO Clause')).toBe(false);
    expect(isEnforcedClause('not a clause')).toBe(false);
  });

  it('gives the legacy and the Showdown spelling of the Baton Pass clause one id', () => {
    expect(clauseId('Batonpass Clause')).toBe(clauseId('Baton Pass Clause'));
    expect(getClause('Batonpass Clause')).toBe(getClause('Baton Pass Clause'));
    expect(clauseName('Batonpass Clause')).toBe('Baton Pass Clause');
  });

  it('converts both ways and keeps an unknown clause as written', () => {
    expect(clauseId('Sleep Clause Mod')).toBe('sleepclausemod');
    expect(clauseName('sleepclausemod')).toBe('Sleep Clause Mod');
    expect(clauseName('Something Clause')).toBe('Something Clause');
    expect(getClause('Something Clause')).toBeUndefined();
  });

  it('knows every clause a preset lists', () => {
    const unknown = new Set<string>();
    for (const preset of PRESETS) for (const name of preset.clauses) if (getClause(name) === undefined) unknown.add(name);
    expect([...unknown]).toEqual([]);
  });

  it('ties the generation-bound clauses to their generation', () => {
    expect(getClause('Dynamax Clause')?.gen).toBe(8);
    expect(getClause('Terastal Clause')?.gen).toBe(9);
    expect(getClause('Species Clause')?.gen).toBeUndefined();
  });
});
