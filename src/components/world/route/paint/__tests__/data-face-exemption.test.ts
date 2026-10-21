import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { markPaintScene, paintSweep, PAINT_EXEMPT_OBJECT_NAMES } from '../paint-sweep';
import { acquirePaintScope, isPainted, resetPaintScopeForTest } from '../painted-light';
import { createStandbyUniforms, standbyMaterialProps } from '@/components/world/route/useStandbyDim';
import { PLAZA_DATA_FACES } from '@/components/world/evoliga/route/plaza/data-faces';
import { SAKURA_DATA_FACES } from '@/components/world/themes/sakura/furniture/data-faces';
import { MOUNTAIN_DATA_FACES } from '@/components/world/themes/mountain/furniture/data-faces';
import { CLOUDS_DATA_FACES } from '@/components/world/themes/clouds/furniture/data-faces';
import { plazaTheme } from '@/components/world/themes/plaza/theme';
import { sakuraTheme } from '@/components/world/themes/sakura/theme';
import { mountainTheme } from '@/components/world/themes/mountain/theme';
import { cloudsTheme } from '@/components/world/themes/clouds/theme';
import { paintFeature, type RouteThemeDefinition } from '@/lib/route-world/theme-types';
import type { DataFace } from '@/lib/route-world/data-surfaces';

/**
 * ROLLOUT §2.2 (c) / §4.2 veto 1 / §6: for every theme, a paint sweep over a
 * scene built from that theme's DATA-FACE OWNERS exempts every
 * `*_DATA_FACES` material. The owners are React components, so the scene is
 * built from their source: every lit material block that carries the standby
 * dim (the mark of a data face in every world), `userData-dataFace`, or sits
 * on a named ledger face, with the tags, the map / emissive-map identity (the
 * self-lit display rule) and the standby props it declares.
 *
 * Two readings:
 * - AS MOUNTED: the sweep's own rules (standby key, self-lit display, tags)
 *   must exempt every face material — in every world, painted or not.
 * - EXPLICIT (§6: "explicit dataFace / frame / paintExempt tags before
 *   features.sweep is set"): only a tag (material or mesh), role `frame` or
 *   a named exempt object counts. `KNOWN_UNTAGGED` is the list of record;
 *   it may only SHRINK — the AD seats tag their faces before their world
 *   sets `features.sweep`, then delete the entries. The plaza's two entries
 *   are grandfathered (exempt as mounted by the standby key and the self-lit
 *   rule; the owners are outside PLATFORM's files).
 */

const WORLD = path.join(process.cwd(), 'src', 'components', 'world');

interface FaceOwner {
  /** Face ids (or a prefix ending in ':') this owner draws. */
  faces: readonly string[];
  file: string;
}

const OWNERS: Record<string, { theme: RouteThemeDefinition<unknown>; faces: readonly DataFace[]; owners: readonly FaceOwner[] }> = {
  plaza: {
    theme: plazaTheme,
    faces: PLAZA_DATA_FACES,
    owners: [
      { faces: ['pulse:board', 'schedule:board'], file: 'evoliga/route/plaza/board/Board.tsx' },
      { faces: ['roster:kiosk'], file: 'evoliga/route/plaza/CenterDesk.tsx' },
      { faces: ['rules:plaque:left', 'rules:plaque:right', 'rules:field'], file: 'evoliga/route/plaza/ChallengeGate.tsx' },
      { faces: ['teams:ledger'], file: 'route/teams/RollCallLedger.tsx' },
    ],
  },
  sakura: {
    theme: sakuraTheme,
    faces: SAKURA_DATA_FACES,
    owners: [
      { faces: ['pulse:board'], file: 'themes/sakura/furniture/JumbotronRock.tsx' },
      { faces: ['roster:wall'], file: 'themes/sakura/furniture/RosterShrine.tsx' },
      { faces: ['schedule:banner:'], file: 'themes/sakura/furniture/FestivalBanners.tsx' },
      { faces: ['rules:tablet'], file: 'themes/sakura/furniture/ToriiGate.tsx' },
      { faces: ['teams:ledger'], file: 'route/teams/RollCallLedger.tsx' },
    ],
  },
  mountain: {
    theme: mountainTheme,
    faces: MOUNTAIN_DATA_FACES,
    owners: [
      { faces: ['pulse:board'], file: 'themes/mountain/furniture/SummitCairn.tsx' },
      { faces: ['roster:frieze'], file: 'themes/mountain/furniture/TrailRegister.tsx' },
      { faces: ['schedule:sign:'], file: 'themes/mountain/furniture/TrailSigns.tsx' },
      { faces: ['rules:tablet'], file: 'themes/mountain/furniture/PassGate.tsx' },
      { faces: ['teams:ledger'], file: 'route/teams/RollCallLedger.tsx' },
    ],
  },
  clouds: {
    theme: cloudsTheme,
    faces: CLOUDS_DATA_FACES,
    owners: [
      { faces: ['pulse:board', 'roster:board', 'schedule:board'], file: 'themes/clouds/furniture/Airships.tsx' },
      { faces: ['rules:tablet'], file: 'themes/clouds/furniture/SkyGate.tsx' },
      { faces: ['teams:ledger'], file: 'route/teams/RollCallLedger.tsx' },
    ],
  },
};

/**
 * Face materials without an EXPLICIT exemption, per theme (`<file>:<line>`
 * of the material block). May only shrink.
 */
const KNOWN_UNTAGGED: Record<string, readonly string[]> = {
  // Grandfathered: exempt as mounted (the kiosk by its standby key, the gate
  // plaque face by the self-lit rule). Owners: CenterDesk / ChallengeGate.
  plaza: ['evoliga/route/plaza/CenterDesk.tsx', 'evoliga/route/plaza/ChallengeGate.tsx'],
  // The AD seats tag these before their world sets `features.sweep`.
  sakura: [
    'themes/sakura/furniture/JumbotronRock.tsx',
    'themes/sakura/furniture/RosterShrine.tsx',
    'themes/sakura/furniture/FestivalBanners.tsx',
    'themes/sakura/furniture/ToriiGate.tsx',
  ],
  mountain: [
    'themes/mountain/furniture/SummitCairn.tsx',
    'themes/mountain/furniture/TrailRegister.tsx',
    'themes/mountain/furniture/TrailSigns.tsx',
    'themes/mountain/furniture/PassGate.tsx',
  ],
  clouds: ['themes/clouds/furniture/Airships.tsx', 'themes/clouds/furniture/SkyGate.tsx'],
};

/** One face material as its owner declares it. */
interface ScannedFaceMaterial {
  file: string;
  line: number;
  kind: 'standard' | 'basic';
  tags: { dataFace: boolean; paintExempt: boolean; frame: boolean };
  meshTags: { dataFace: boolean; paintExempt: boolean };
  meshName: string | null;
  standby: boolean;
  /** `map` and `emissiveMap` name the same texture (the self-lit display rule). */
  selfLit: boolean;
}

/** The opening `<mesh …>` tag before `at` (brace-aware), or ''. */
function meshTagBefore(source: string, at: number): string {
  let start = source.lastIndexOf('<mesh', at - 1);
  // Skip `<meshStandardMaterial` and friends: the mesh element is `<mesh` + space / newline / `>`.
  while (start >= 0 && !/[\s>]/.test(source[start + 5] ?? '')) start = source.lastIndexOf('<mesh', start - 1);
  if (start < 0) return '';
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return source.slice(start, i + 1);
  }
  return '';
}

function scanOwner(file: string): ScannedFaceMaterial[] {
  const source = readFileSync(path.join(WORLD, file), 'utf8');
  const out: ScannedFaceMaterial[] = [];
  const re = /<(meshStandardMaterial|meshBasicMaterial)\b[\s\S]*?\/>/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const block = m[0];
    const mesh = meshTagBefore(source, m.index);
    const meshName = /name="([^"]+)"/.exec(mesh)?.[1] ?? null;
    const standby = /materialProps\}|\{\.\.\.standby\}/.test(block);
    const tagged = /userData-dataFace/.test(block) || /userData-dataFace/.test(mesh);
    const namedFace = meshName !== null && PAINT_EXEMPT_OBJECT_NAMES.has(meshName);
    if (!standby && !tagged && !namedFace) continue;
    const map = /\bmap=\{([A-Za-z_$][\w$]*)\}/.exec(block)?.[1];
    const emissiveMap = /\bemissiveMap=\{([A-Za-z_$][\w$]*)/.exec(block)?.[1];
    out.push({
      file,
      line: source.slice(0, m.index).split('\n').length,
      kind: m[1] === 'meshBasicMaterial' ? 'basic' : 'standard',
      tags: {
        dataFace: /userData-dataFace/.test(block),
        paintExempt: /userData-paintExempt/.test(block),
        frame: /userData-paintRole="frame"/.test(block),
      },
      meshTags: { dataFace: /userData-dataFace/.test(mesh), paintExempt: /userData-paintExempt/.test(mesh) },
      meshName,
      standby,
      selfLit: map !== undefined && map === emissiveMap,
    });
  }
  return out;
}

/** Build the scanned material into a mesh, as mounted (`asMounted`) or with its explicit tags only. */
function build(face: ScannedFaceMaterial, asMounted: boolean): { mesh: THREE.Mesh; material: THREE.Material } {
  const material =
    face.kind === 'basic' ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial();
  if (face.tags.dataFace) material.userData.dataFace = true;
  if (face.tags.paintExempt) material.userData.paintExempt = true;
  if (face.tags.frame) material.userData.paintRole = 'frame';
  if (asMounted) {
    if (face.selfLit && material instanceof THREE.MeshStandardMaterial) {
      const texture = new THREE.Texture();
      material.map = texture;
      material.emissiveMap = texture;
    }
    if (face.standby) Object.assign(material, standbyMaterialProps(createStandbyUniforms()));
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  if (face.meshTags.dataFace) mesh.userData.dataFace = true;
  if (face.meshTags.paintExempt) mesh.userData.paintExempt = true;
  if (face.meshName) mesh.name = face.meshName;
  return { mesh, material };
}

function faceMaterials(theme: string): ScannedFaceMaterial[] {
  const files = [...new Set(OWNERS[theme].owners.map((owner) => owner.file))];
  return files.flatMap(scanOwner);
}

/** Paint-sweep a painted scene of the scanned faces; the materials the sweep painted. */
function paintedFaces(theme: string, asMounted: boolean): ScannedFaceMaterial[] {
  const scene = new THREE.Scene();
  markPaintScene(scene, theme);
  const built = faceMaterials(theme).map((face) => ({ face, ...build(face, asMounted) }));
  for (const entry of built) scene.add(entry.mesh);
  paintSweep(scene);
  return built.filter((entry) => isPainted(entry.material)).map((entry) => entry.face);
}

let release: () => void = () => {};

beforeEach(() => {
  resetPaintScopeForTest();
  release = acquirePaintScope('test');
});

afterEach(() => {
  release();
  resetPaintScopeForTest();
});

describe.each(Object.keys(OWNERS))('data-face exemption: %s', (theme) => {
  it('every data face has an owner, and every owner declares a face material', () => {
    const { faces, owners } = OWNERS[theme];
    for (const face of faces) {
      const owned = owners.some((owner) => owner.faces.some((id) => (id.endsWith(':') ? face.id.startsWith(id) : face.id === id)));
      expect(owned, `${theme}: ${face.id} has no owner`).toBe(true);
    }
    for (const owner of owners) expect(scanOwner(owner.file).length, `${owner.file}: no face material found`).toBeGreaterThan(0);
  });

  it('AS MOUNTED: the sweep exempts every face material (standby key, self-lit rule, tags)', () => {
    expect(paintedFaces(theme, true).map((face) => `${face.file}:${face.line}`)).toEqual([]);
  });

  it('EXPLICIT: faces without a dataFace / paintExempt / frame tag are only the known ones (the list may only shrink)', () => {
    const untagged = [...new Set(paintedFaces(theme, false).map((face) => face.file))];
    for (const file of untagged) expect(KNOWN_UNTAGGED[theme], `${theme}: ${file} lost (or never had) an explicit tag`).toContain(file);
    // A stale entry (its faces are now tagged) must be deleted from the list.
    for (const file of KNOWN_UNTAGGED[theme]) expect(untagged, `${theme}: ${file} is tagged now — shrink KNOWN_UNTAGGED`).toContain(file);
  });

  it('a world that sets features.sweep carries no untagged face beyond the grandfathered plaza pair', () => {
    if (!paintFeature(OWNERS[theme].theme.paint, 'sweep')) return;
    expect(theme === 'plaza' || KNOWN_UNTAGGED[theme].length === 0, `${theme} sweeps with untagged faces`).toBe(true);
  });
});
