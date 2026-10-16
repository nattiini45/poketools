/**
 * B1: shared 3D World Theme select-option derivation.
 *
 * `getRouteThemeOptions` is the pure option list used by both LeagueForm
 * (create) and LeagueThemeControl (post-create admin picker). It must lead
 * with the Auto option and then mirror `getRegisteredRouteThemeIds()` 1:1
 * (order preserved, labels capitalized) — never the wider DB CHECK union.
 */
import { describe, expect, it } from 'vitest';
import { getRouteThemeOptions } from '@/lib/worlds/route-theme-options';
import { getRegisteredRouteThemeIds } from '@/lib/worlds/registry';

describe('getRouteThemeOptions', () => {
  it('leads with the Auto option', () => {
    const options = getRouteThemeOptions();
    expect(options[0]).toEqual({ value: 'auto', label: 'Auto (format default)' });
  });

  it('contains exactly Auto + every registered theme id, in registry order', () => {
    const options = getRouteThemeOptions();
    const ids = getRegisteredRouteThemeIds();
    expect(options).toHaveLength(ids.length + 1);
    expect(options.slice(1).map((o) => o.value)).toEqual(ids);
  });

  it('capitalizes each registered theme id for its label', () => {
    const options = getRouteThemeOptions();
    for (const id of getRegisteredRouteThemeIds()) {
      expect(options).toContainEqual({
        value: id,
        label: id.charAt(0).toUpperCase() + id.slice(1),
      });
    }
  });

  it('returns a fresh array on each call (no shared mutable state)', () => {
    const a = getRouteThemeOptions();
    const b = getRouteThemeOptions();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
