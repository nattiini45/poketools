import type { RouteStation } from '@/lib/route-world/chapters';
import type { RouteThemeDefinition } from '@/lib/route-world/theme-types';
import { DEFAULT_HDRI_YAW } from '@/lib/route-world/world-env';

/**
 * The C-100 engine-probe theme (criterion 1 + 2 + 6) — a dev-only fixture
 * definition, NOT a registry entry. It proves the engine contract by
 * consumption: a theme that declares `textureRoles: ['cobble']` (criterion
 * 2 — the consumer resolves a declared bucket set) and mounts figures
 * through the shared pipeline from BOTH sources — a roster plan (per-player
 * aces, the StatueRow pattern) and a pool plan (an arbitrary species list).
 *
 * Passed DIRECTLY to `WorldStateProvider` as the `theme` prop (the
 * provider's direct-definition path), so the read-only registry and the
 * theme packages are untouched. Stations orbit one small meadow whose
 * layout mirrors the probe scene in `ProbeWorldScene.tsx`.
 */

export const PROBE_STATIONS: readonly RouteStation[] = [
  {
    id: 'pulse',
    beat: 'The probe meadow — the engine reads the theme.',
    camera: { position: [0, 3.4, -8], target: [0, 1.5, 0], fov: 45 },
    cameraMobile: { position: [0.4, 3.3, -6.4], target: [0, 1.5, 0], fov: 52 },
    world: { key: 1.0, fog: 0.006, practicals: 0, particles: 0 },
    assetGroup: 'critical',
  },
  {
    id: 'roster',
    beat: 'The tree line — three skins of the shared tree system.',
    camera: { position: [-4.2, 3.2, -7.2], target: [-12.5, 2.4, 0.5], fov: 45 },
    cameraMobile: { position: [-3.4, 3.1, -5.8], target: [-12.5, 2.4, 0.5], fov: 52 },
    world: { key: 0.95, fog: 0.007, practicals: 0, particles: 0 },
    assetGroup: 'route',
  },
  {
    id: 'teams',
    beat: 'The figure row — roster and pool, one pipeline.',
    camera: { position: [8.6, 2.6, -6.4], target: [12, 1.1, 0.8], fov: 45 },
    cameraMobile: { position: [7.2, 2.5, -5.2], target: [12, 1.1, 0.8], fov: 52 },
    world: { key: 0.92, fog: 0.007, practicals: 0, particles: 0 },
    assetGroup: 'gyms',
  },
  {
    id: 'schedule',
    beat: 'The bollard ring — batching reads the probe prefixes.',
    camera: { position: [1.6, 3.6, -6], target: [-4, 1, -8.5], fov: 45 },
    cameraMobile: { position: [1.3, 3.5, -4.9], target: [-4, 1, -8.5], fov: 52 },
    world: { key: 0.9, fog: 0.006, practicals: 0, particles: 0 },
    assetGroup: 'stadium',
  },
  {
    id: 'rules',
    beat: 'And the contract holds from every angle.',
    camera: { position: [0, 4.4, -11], target: [0, 1.8, 2], fov: 40 },
    cameraMobile: { position: [0, 4.2, -9.4], target: [0, 1.8, 2], fov: 52 },
    world: { key: 0.85, fog: 0.008, practicals: 0, particles: 0 },
    assetGroup: 'hall',
  },
] as const;

export const PROBE_STATION_IDS: readonly string[] = PROBE_STATIONS.map((station) => station.id);

/**
 * The probe theme definition. `textureRoles: ['cobble']` is the load — the
 * consumer resolves the SAME env/tex/cobble URLs the plaza union path
 * yields. Figure plans are scene-side data (`ProbeWorldScene`); the theme
 * only carries what `RouteThemeDefinition` requires, everything optional
 * defaulted so the shape stays additive for real reworks (C-102..104).
 */
export const probeTheme: RouteThemeDefinition<object> = {
  id: 'c100probe',
  stations: PROBE_STATIONS,
  holdIds: ['pulse', 'schedule'],
  paletteExtension: () => ({}),
  lights: {
    keyDirection: [12, 15, 7],
    keyPosition: [16.8, 21, 9.8],
    skyBodyPosition: [9.4, 12.9, 5.5],
  },
  propFamilyPrefixes: ['probe-'],
  textureRoles: ['cobble'],
  hdriYaw: { ...DEFAULT_HDRI_YAW },
  focusVocabulary: { kinds: [], panelParams: [] },
};
