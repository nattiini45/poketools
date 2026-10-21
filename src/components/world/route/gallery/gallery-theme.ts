import type { RouteStation } from '@/lib/route-world/chapters';
import type { RouteThemeDefinition } from '@/lib/route-world/theme-types';
import { DEFAULT_HDRI_YAW } from '@/lib/route-world/world-env';

/**
 * D42 gallery (dev-only): the theme definition the gallery world hands
 * `WorldStateProvider` directly (the provider's direct-definition path, like
 * the C-100 probe), so the registry and the theme packages stay untouched.
 *
 * One station; its camera endpoint is only the canvas's initial camera — the
 * gallery camera frames the figure itself (`gallery-camera.ts`) and no
 * CameraRig is mounted. The palette is the core token palette (the site
 * theme's light or dark tokens, read off the DOM like every world), and the
 * backdrop is the token SURFACE colour, so a gallery still reads in the
 * page's own theme.
 */

export const GALLERY_STATION_ID = 'gallery';

export const GALLERY_STATIONS: readonly RouteStation[] = [
  {
    id: GALLERY_STATION_ID,
    beat: 'One figure, framed by its bounds.',
    camera: { position: [0, 1.2, 6], target: [0, 1, 0], fov: 30 },
    cameraMobile: { position: [0, 1.2, 6], target: [0, 1, 0], fov: 30 },
    world: { key: 1.0, fog: 0, practicals: 0, particles: 0 },
    assetGroup: 'critical',
  },
];

export const GALLERY_STATION_IDS: readonly string[] = GALLERY_STATIONS.map((station) => station.id);

export interface GalleryPaletteExtension {
  /** The canvas clear colour: the token surface (overrides the core `sky`). */
  sky: string;
}

export const galleryTheme: RouteThemeDefinition<GalleryPaletteExtension> = {
  id: 'd42gallery',
  stations: GALLERY_STATIONS,
  holdIds: [GALLERY_STATION_ID],
  paletteExtension: (core) => ({ sky: core.surface }),
  lights: {
    keyDirection: [0.45, 0.75, 0.5],
    keyPosition: [4.5, 7.5, 5],
    skyBodyPosition: [4.5, 7.5, 5],
  },
  propFamilyPrefixes: [],
  textureRoles: [],
  hdriYaw: { ...DEFAULT_HDRI_YAW },
  focusVocabulary: { kinds: [], panelParams: [] },
};
