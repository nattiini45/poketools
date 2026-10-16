import { HERO_PROPS } from '@/lib/route-world/layout';
import { propUrl, type WorldManifest } from '@/lib/route-world/model-manifest';
import { kitBayUrls } from '@/lib/route-world/world-env';
import { KIT_BAY_IDS } from '@/lib/route-world/haussmann';

/**
 * D42 N7b: the plaza GLBs whose URLs the manifest alone decides — the ones
 * the plaza mounts on every load, whatever the cast and the roster:
 *  - the five façade kit modules (`facade-kit.tsx`, when the manifest ships
 *    the whole kit);
 *  - the street lamp (`PlazaHall` `StreetLamps`);
 *  - the gate crest (`ChallengeGate`);
 *  - the hero props seated by `HERO_PROPS` (`HeroProps`).
 * Prop names only (no species: D18). `PlazaHall` registers this selector for
 * the plaza theme (`registerGenerationPrefetch`), so these fetches start when
 * the scene generation begins instead of when each mount first renders.
 */

/** The street-lamp prop (`PlazaHall` `StreetLamps`). */
export const PLAZA_LAMP_PROP = 'haussmann-lamp-post';
/** The gate crest prop; must equal `ChallengeGate`'s `CREST_PROP` (pinned by test). */
export const PLAZA_GATE_CREST_PROP = 'gate-crest-ornament';

export function plazaKnownGLBs(manifest: WorldManifest): string[] {
  const urls: string[] = [];
  const kit = kitBayUrls(manifest);
  if (kit) for (const bay of KIT_BAY_IDS) urls.push(kit[bay]);
  const names = new Set<string>([PLAZA_LAMP_PROP, PLAZA_GATE_CREST_PROP, ...HERO_PROPS.map((seat) => seat.prop)]);
  for (const prop of manifest.props) {
    if (names.has(prop.name)) urls.push(propUrl(prop));
  }
  return urls;
}
