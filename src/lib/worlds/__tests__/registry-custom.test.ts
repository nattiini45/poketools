/**
 * The world registry per league type: the explicit auto-map of the four classic formats and of every route-theme
 * pin stays as it is, and the Format Studio league type resolves to the park world through its own entry.
 */
import { describe, expect, it } from 'vitest';
import { getDefaultWorld, getSeasonWorld, resolveWorld } from '../registry';

const CLASSIC = ['singles', 'doubles', 'draft', 'evolution_point_buy'] as const;
const THEMES = ['plaza', 'sakura', 'mountain', 'clouds'] as const;

describe('getSeasonWorld (classic formats)', () => {
  it('maps point buy to the evoliga world and the other classic formats to the sakura park', () => {
    expect(getSeasonWorld('evolution_point_buy').id).toBe('evoliga');
    for (const format of ['singles', 'doubles', 'draft'] as const) {
      expect(getSeasonWorld(format).id, format).toBe('sakura');
    }
  });

  it('gives the sakura world the classic draft experience and the evoliga world its own', () => {
    expect(getSeasonWorld('singles').draftExperience).toBe('classic');
    expect(getSeasonWorld('evolution_point_buy').draftExperience).toBe('evoliga');
  });
});

describe('resolveWorld (explicit pins and auto)', () => {
  it.each(CLASSIC)('follows the format map for %s with route_theme auto', (format_type) => {
    expect(resolveWorld({ format_type, route_theme: 'auto' })).toBe(getSeasonWorld(format_type));
  });

  it.each(THEMES)('route_theme %s wins over every classic format', (route_theme) => {
    const ids = CLASSIC.map((format_type) => resolveWorld({ format_type, route_theme }).id);
    expect(new Set(ids).size).toBe(1);
  });

  it('pins plaza to the evoliga world, mountain and clouds to their own', () => {
    expect(resolveWorld({ format_type: 'singles', route_theme: 'plaza' }).id).toBe('evoliga');
    expect(resolveWorld({ format_type: 'singles', route_theme: 'mountain' }).id).toBe('mountain');
    expect(resolveWorld({ format_type: 'singles', route_theme: 'clouds' }).id).toBe('clouds');
  });
});

describe('the custom league type', () => {
  it('resolves explicitly to the sakura world, not through the default world', () => {
    const world = getSeasonWorld('custom');
    expect(world.id).toBe('sakura');
    expect(world.routeThemeId).toBe('sakura');
    expect(world).toBe(getDefaultWorld());
    expect(resolveWorld({ format_type: 'custom', route_theme: 'auto' }).id).toBe('sakura');
  });

  it('keeps the explicit theme pins over the custom type', () => {
    expect(resolveWorld({ format_type: 'custom', route_theme: 'plaza' }).id).toBe('evoliga');
    expect(resolveWorld({ format_type: 'custom', route_theme: 'mountain' }).id).toBe('mountain');
  });

  it('leaves the match lists of the worlds untouched: they are part of every league world payload', () => {
    expect(getSeasonWorld('evolution_point_buy').matchesFormats).toEqual(['evolution_point_buy']);
    expect(getSeasonWorld('singles').matchesFormats).toEqual(['singles', 'doubles', 'draft']);
  });
});
