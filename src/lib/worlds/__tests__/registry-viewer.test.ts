import { describe, expect, it } from 'vitest';
import {
  getRegisteredRouteThemeIds,
  getWorldByRouteThemeId,
  resolveViewerWorld,
  resolveWorld,
} from '../registry';

/**
 * B2 — the viewer override must be resolvable on the SERVER, because that is
 * the only place the scene root, the shell's token namespace, the station
 * manifest and the palette can be chosen from one world. These tests pin the
 * precedence chain (`?world=` > admin pin > format auto-map) and the
 * fall-through behavior that keeps an unknown value from ever blanking a route.
 */

const epbLeague = { format_type: 'evolution_point_buy' as const, route_theme: 'auto' as const };
const singlesLeague = { format_type: 'singles' as const, route_theme: 'auto' as const };

describe('getWorldByRouteThemeId', () => {
  it('resolves every registered theme id to a world providing it', () => {
    for (const id of getRegisteredRouteThemeIds()) {
      expect(getWorldByRouteThemeId(id)?.routeThemeId).toBe(id);
    }
  });

  it('returns null for an unknown id', () => {
    expect(getWorldByRouteThemeId('northsea')).toBeNull();
  });

  it('never returns the DOM-only default world', () => {
    // The default world carries no routeThemeId, so it is unreachable here —
    // an unregistered pick must fall through to resolveWorld, not to a
    // theme-shaped default.
    expect(getWorldByRouteThemeId('default')).toBeNull();
  });
});

describe('resolveViewerWorld — precedence chain', () => {
  it('viewer override beats the format auto-map', () => {
    expect(resolveViewerWorld(epbLeague, 'mountain').id).toBe('mountain');
    expect(resolveViewerWorld(singlesLeague, 'clouds').id).toBe('clouds');
  });

  it('viewer override beats an admin pin', () => {
    const pinned = { format_type: 'singles' as const, route_theme: 'sakura' as const };
    expect(resolveWorld(pinned).id).toBe('sakura');
    expect(resolveViewerWorld(pinned, 'plaza').id).toBe('evoliga');
  });

  it('falls through to the admin pin when no override is present', () => {
    const pinned = { format_type: 'singles' as const, route_theme: 'mountain' as const };
    expect(resolveViewerWorld(pinned, undefined).id).toBe('mountain');
    expect(resolveViewerWorld(pinned, null).id).toBe('mountain');
  });

  it('falls through to the format auto-map when no override or pin applies', () => {
    expect(resolveViewerWorld(epbLeague, undefined).id).toBe('evoliga');
    expect(resolveViewerWorld(singlesLeague, undefined).id).toBe('sakura');
  });

  it('ignores an unregistered override instead of blanking the route', () => {
    expect(resolveViewerWorld(epbLeague, 'northsea').id).toBe('evoliga');
    expect(resolveViewerWorld(singlesLeague, 'northsea').id).toBe('sakura');
  });

  it('ignores an empty-string override', () => {
    expect(resolveViewerWorld(epbLeague, '').id).toBe('evoliga');
  });

  it('takes the first entry of an array-valued search param', () => {
    // Next.js hands repeated query keys through as an array; a duplicated
    // ?world= must still resolve deterministically rather than throw.
    expect(resolveViewerWorld(epbLeague, ['clouds', 'mountain']).id).toBe('clouds');
  });

  it('treats an array whose first entry is unregistered as no override', () => {
    expect(resolveViewerWorld(epbLeague, ['northsea']).id).toBe('evoliga');
  });
});
