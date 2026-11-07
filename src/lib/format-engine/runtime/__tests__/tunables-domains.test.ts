import { describe, expect, it } from 'vitest';
import type { DomainEntry } from '@/lib/format-kit/types';
import { amendEntries, domainView, findDomainView, visibleEntries } from '../domains';
import { isTunableEditable, lockedTunableKeys, resolveTunables, tunableEditContext } from '../tunables';
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

describe('editable_until', () => {
  const def = giftDef();
  const current = resolveTunables(def, undefined).values;
  const before = { started: false, actionLocked: false };
  const started = { started: true, actionLocked: false };
  const locked = { started: true, actionLocked: true };

  it('start closes at the start of the league, lock at the first locked action, always never', () => {
    expect(isTunableEditable({ editable_until: 'start' }, before)).toBe(true);
    expect(isTunableEditable({ editable_until: 'start' }, started)).toBe(false);
    expect(isTunableEditable({ editable_until: 'lock' }, started)).toBe(true);
    expect(isTunableEditable({ editable_until: 'lock' }, locked)).toBe(false);
    expect(isTunableEditable({ editable_until: 'always' }, locked)).toBe(true);
  });

  it('reads the lock from the action flags', () => {
    expect(tunableEditContext(true, { flags: { 'action:choose_gift': 'locked' } })).toEqual(locked);
    expect(tunableEditContext(true, { flags: { 'action:choose_gift': 'open', 'domain:pool': 'locked' } })).toEqual(started);
  });

  it('names the closed tunables a change would touch, and ignores unchanged values and unknown keys', () => {
    const changes = { base_level: 5, mode: 'fierce', open: false, curve: [3, 2, 1], nope: 1 };
    expect(lockedTunableKeys(def, current, changes, before)).toEqual([]);
    expect(lockedTunableKeys(def, current, changes, started)).toEqual(['base_level']);
    expect(lockedTunableKeys(def, current, changes, locked)).toEqual(['base_level', 'mode']);
    expect(lockedTunableKeys(def, current, { base_level: current.base_level }, locked)).toEqual([]);
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
