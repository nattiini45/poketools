import { describe, expect, it } from 'vitest';
import type { DomainEntry } from '@/lib/format-kit/types';
import { amendEntries, domainView, findDomainView, visibleEntries } from '../domains';
import { resolveTunables } from '../tunables';
import { giftDef } from './helpers';

describe('resolveTunables', () => {
  const def = giftDef();

  it('starts from the defaults of the document', () => {
    const { values, issues } = resolveTunables(def, {});
    expect(values).toEqual({ base_level: 1, bonus_factor: 2, mode: 'cozy', curve: [3, 2, 1], open: true });
    expect(issues).toEqual([]);
  });

  it('takes valid stored values over the defaults', () => {
    const { values, issues } = resolveTunables(def, { base_level: 4, mode: 'fierce', curve: [9, 1], open: false });
    expect(values).toMatchObject({ base_level: 4, mode: 'fierce', curve: [9, 1], open: false, bonus_factor: 2 });
    expect(issues).toEqual([]);
  });

  it('ignores and reports every invalid stored value', () => {
    const { values, issues } = resolveTunables(def, {
      base_level: 99,
      bonus_factor: 'x',
      mode: 'wild',
      curve: [],
      open: 1,
      nope: 3,
    });
    expect(values).toEqual({ base_level: 1, bonus_factor: 2, mode: 'cozy', curve: [3, 2, 1], open: true });
    expect(issues).toEqual([
      { key: 'base_level', code: 'out_of_range' },
      { key: 'bonus_factor', code: 'wrong_type' },
      { key: 'mode', code: 'not_in_values' },
      { key: 'curve', code: 'bad_table' },
      { key: 'open', code: 'wrong_type' },
      { key: 'nope', code: 'unknown_key' },
    ]);
  });

  it('treats a stored value that is not an object as empty and never aliases the default table', () => {
    for (const stored of [null, [], 'x', 3]) expect(resolveTunables(def, stored).issues).toEqual([]);
    const a = resolveTunables(def, undefined).values.curve as number[];
    a.push(7);
    expect(resolveTunables(def, undefined).values.curve).toEqual([3, 2, 1]);
  });
});

describe('domains', () => {
  const entry = (id: string, role?: string): DomainEntry => ({ id, attrs: role ? [{ key: 'role', value: role }] : [] });

  it('adds, replaces and removes entries in order, for its own domain only', () => {
    const base = [entry('garchomp'), entry('blissey')];
    const out = amendEntries(base, 'pool', [
      { domain: 'pool', add: [entry('corviknight')] },
      { domain: 'other', add: [entry('mew')] },
      { domain: 'pool', add: [entry('blissey', 'support')], remove: ['garchomp'] },
    ]);
    expect(out).toEqual([entry('blissey', 'support'), entry('corviknight')]);
    expect(base.map((e) => e.id)).toEqual(['garchomp', 'blissey']);
  });

  it('is unlocked by the flag, else by initially', () => {
    const def = giftDef();
    expect(domainView(def, {}, [])[0]).toMatchObject({ key: 'pool', unlocked: false });
    expect(domainView(def, { 'domain:pool': 'unlocked' }, [])[0].unlocked).toBe(true);
    expect(domainView({ domains: [{ ...def.domains![0], initially: 'unlocked' }] }, { 'domain:pool': 'locked' }, [])[0].unlocked).toBe(false);
  });

  it('applies the amendments to the view and hides entries by visibility', () => {
    const def = giftDef();
    const view = findDomainView(def, 'pool', {}, [{ domain: 'pool', remove: ['blissey'] }]);
    expect(view?.entries.map((e) => e.id)).toEqual(['garchomp', 'corviknight']);
    expect(findDomainView(def, 'missing', {}, [])).toBeNull();
    // when_unlocked: hidden while locked, shown once unlocked, always to admins.
    expect(visibleEntries(view!, false)).toEqual([]);
    expect(visibleEntries(view!, true)).toHaveLength(2);
    expect(visibleEntries({ ...view!, unlocked: true }, false)).toHaveLength(2);
    expect(visibleEntries({ ...view!, visibility: 'admins', unlocked: true }, false)).toEqual([]);
  });
});
