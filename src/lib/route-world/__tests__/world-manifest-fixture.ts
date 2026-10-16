import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EMPTY_MANIFEST, WORLD_MANIFEST_FILE, type WorldManifest } from '../model-manifest';

/**
 * The world manifests in the local mirror (`public/models/world/manifest.v3.json`, the shipped
 * one, and `manifest.json`, the published v2 descriptor) list a league's figure pool, so they
 * are untracked (a checkout does not include them); without them the route world renders sprite
 * billboards instead of 3D figures, and no props. Tests that assert on the real manifest read it through here and skip
 * (`describe.skipIf(!present)`) when it is absent. When it is present every assertion runs
 * unchanged.
 */
export const WORLD_MIRROR_DIR = join(__dirname, '..', '..', '..', '..', 'public', 'models', 'world');

export interface MirrorManifest {
  /** The parsed manifest, or `EMPTY_MANIFEST` when the file is absent (safe for module-level derivations). */
  manifest: WorldManifest;
  /** Whether the file exists; gate every assertion on the real manifest with `skipIf(!present)`. */
  present: boolean;
  /** Absolute path of the file. */
  path: string;
}

/** Read a manifest from the local mirror; logs one line naming the file when it is absent. */
export function readMirrorManifest(file: string = WORLD_MANIFEST_FILE): MirrorManifest {
  const path = join(WORLD_MIRROR_DIR, file);
  if (!existsSync(path)) {
    console.warn(
      `[world-manifest] public/models/world/${file} is absent (untracked; a maintainer restores it from the private companion overlay that tracks it); skipping its tests.`,
    );
    return { manifest: EMPTY_MANIFEST, present: false, path };
  }
  return { manifest: JSON.parse(readFileSync(path, 'utf8')) as WorldManifest, present: true, path };
}
