/**
 * Route chapters — station ledger types and pure sampling math.
 *
 * A "station" is one beat of a route world: an id that matches a page
 * section, authored desktop + mobile camera endpoints, and the world-state
 * channels (key light, fog, practicals, particles) at that beat. The engine
 * consumes stations from the active `RouteThemeDefinition` (see
 * `theme-types.ts`); the plaza's authored data lives in
 * `src/components/world/themes/plaza/theme.ts`.
 *
 * Pure data — no client-only imports.
 */

export type AssetGroupId = 'critical' | 'route' | 'gyms' | 'stadium' | 'hall';

export type Vec3 = readonly [number, number, number];

export interface CameraEndpoint {
  position: Vec3;
  target: Vec3;
  fov: number;
}

export interface StationWorldState {
  key: number;
  fog: number;
  practicals: number;
  particles: number;
}

export interface RouteStation {
  id: string;
  beat: string;
  camera: CameraEndpoint;
  cameraMobile: CameraEndpoint;
  world: StationWorldState;
  assetGroup: AssetGroupId;
}

export const PREFETCH_LEAD = 0.6;

export function endpointFor(station: RouteStation, mobile: boolean): CameraEndpoint {
  return mobile ? station.cameraMobile : station.camera;
}

export function lerpWorldState(
  a: StationWorldState,
  b: StationWorldState,
  t: number,
): StationWorldState {
  return {
    key: a.key + (b.key - a.key) * t,
    fog: a.fog + (b.fog - a.fog) * t,
    practicals: a.practicals + (b.practicals - a.practicals) * t,
    particles: a.particles + (b.particles - a.particles) * t,
  };
}

/** Neutral channels for a world with no stations (DOM-only tiers). */
const EMPTY_WORLD_STATE: StationWorldState = { key: 0, fog: 0, practicals: 0, particles: 0 };

/** Station-indexed world-state sampler over a theme's station ledger. */
export interface WorldStateSampler {
  /**
   * Piecewise-linear world state at a conductor position in station units.
   * Clamps to the first/last station outside the route.
   */
  worldStateAt(position: number): StationWorldState;
}

/**
 * Pure factory replacing the old module-singleton `worldStateAt`: the sampler
 * closes over the THEME's stations instead of one hardcoded ledger, so any
 * theme's engine consumers (lighting, atmosphere, debug overlay) sample
 * their own world. Stable identity when `stations` is stable — memoize on it.
 */
export function createWorldStateSampler(stations: readonly RouteStation[]): WorldStateSampler {
  return {
    worldStateAt(position: number): StationWorldState {
      const last = stations.length - 1;
      if (last < 0) return EMPTY_WORLD_STATE;
      if (position <= 0) return stations[0].world;
      if (position >= last) return stations[last].world;
      const i = Math.floor(position);
      return lerpWorldState(stations[i].world, stations[i + 1].world, position - i);
    },
  };
}
