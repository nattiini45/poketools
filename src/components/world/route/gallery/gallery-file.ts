/**
 * D42 gallery (dev-only): the `?galleryFile=` value. A path UNDER the asset
 * base (`models/regular/907.glb`, `props/statue-plinth.glb`), never a URL:
 * the gallery resolves it with `worldAssetUrl`, so the arm override
 * (`?routeAssetBase=`) picks the mirror and the file never leaves it.
 */

import type { FigureBounds, FigureEntry, WorldManifest } from '@/lib/route-world/model-manifest';

const GALLERY_FILE = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9._-]*)*\.glb$/i;
const GALLERY_FILE_MAX = 160;

/** The validated asset-relative path, or null for anything else (no `..`, no scheme, no leading slash). */
export function parseGalleryFile(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const file = value.trim();
  if (file.length === 0 || file.length > GALLERY_FILE_MAX) return null;
  if (file.includes('..') || file.includes('//') || file.includes('\\')) return null;
  return GALLERY_FILE.test(file) ? file : null;
}

/** The unit box a file the manifest does not list is framed with (its real size comes from the mount). */
const UNIT_BOUNDS: FigureBounds = { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] };

/**
 * The `FigureEntry` the gallery mounts `file` with, through the real
 * `Figure` path: the manifest's figure row when it lists the file, else a
 * row built from its prop entry (a prop has no Pokédex height: the figure
 * keeps its authored size), else a bare row (unit bounds, no height). Keyed
 * by FILE PATH only (D18: no species names anywhere).
 */
export function galleryFigureEntry(manifest: WorldManifest, file: string): FigureEntry {
  const figure = manifest.figures.find((entry) => entry.file === file);
  if (figure) return figure;
  const prop = manifest.props.find((entry) => entry.file === file) ?? null;
  return {
    dexId: 0,
    form: 'regular',
    species: '',
    aliases: [],
    file,
    sourceForm: 'regular',
    kb: prop?.kb ?? 0,
    heightm: null,
    bounds: prop?.bounds ?? UNIT_BOUNDS,
    clips: [],
    triangles: prop?.triangles ?? 0,
  };
}
