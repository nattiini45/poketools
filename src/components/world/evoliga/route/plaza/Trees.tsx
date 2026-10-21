'use client';

import { useLayoutEffect, useMemo } from 'react';
import Tree, { useCanopyLight, useTreeSkinMaterials } from '@/components/world/route/trees/Tree';
import { PLAZA_LAMP_SEATS, PLAZA_TEAMS_LAMPS } from '@/lib/route-world/teams-formation';
import type { TreeSpec } from '@/lib/route-world/tree';
import { paintFeature } from '@/lib/route-world/theme-types';
import { usePlazaPalette } from '@/components/world/themes/plaza/use-plaza-palette';
import { PLAZA_CANOPY_LOOK } from '@/components/world/themes/plaza/theme-palette';
import { plazaTheme } from '@/components/world/themes/plaza/theme';
import SunShafts from '../env/SunShafts';
import {
  PLANTER_SOIL_Y,
  PLAZA_SKIN_BY_KEY,
  PLAZA_TREE_SEATS,
  plazaTreeYaw,
  type PlazaTreeSeat,
} from './tree-skin';

export { PLANTER_SOIL_Y, PLAZA_TREE_SEATS, type PlazaTreeSeat };

/**
 * The plaza's REAL trees (C-108 criterion 3): the shared tree system
 * (`tree.ts`/`Tree.tsx`) over the route package's own skin DATA
 * (`tree-skin.ts`) — tapered trunk + recursive branch geometry, layered
 * procedural leaf cards on the WIND_CLOCK vertex sway, quality-gated
 * density tiers, distance culling. They replace the Planter's topiary
 * spheres (the C-106 panel's "topiary only" finding) one tree per planter
 * seat, trunk based at the planter's soil line (PlazaHall keeps the stone
 * box as the tree's setting).
 *
 * LOOK-PLAN §2 SEAT M: the plaza skins opt into the PAINTED canopy (one
 * brushy crown per tree, back-lit translucency, draw-range density), and
 * this module also mounts the rules contre-jour moment (`SunShafts`) at
 * load, at every rung. The palette only writes uniforms here (the canopy's
 * translucency strength), never a program.
 *
 * SEATS are the four committed planter anchors (`PLANTER_SEATS` in
 * PlazaHall), now held as data in `tree-skin.ts`. Heights stay low so the
 * crowns clear the station sight lines — the trunk-inclusive
 * crown-projection scan of record lives in the round evidence
 * (`_ccC108r1-*scan*`): every trunk cylinder and canopy card corner
 * projected through ALL ten landed poses (desktop + landed-390 per station)
 * against every text-bearing face quad, zero hits. The painted canopy draws
 * exactly the rung-0 card set that scan judged.
 */

/** LOOK r5/r6 (L6.3): the night canopy multiplier (deep teal-green, not slate; day is white = the painted atlas). */
export const NIGHT_CANOPY_TINT = '#5a8f6e';

/**
 * LOOK r6: plaza canopy uniforms per palette — the contre-jour silhouette
 * (L4b, by day) and the warm lamp under-light (L6.3, at night). Uniform
 * writes; every other world keeps both at their 0 defaults. ROLLOUT §2.2
 * (h): the values live in the plaza's `paint.canopy` (`PLAZA_CANOPY_LOOK`);
 * this per-palette view of them stays for the tests of record.
 */
export const PLAZA_LEAF_LOOK = {
  day: { sil: PLAZA_CANOPY_LOOK.sil.day, lamp: PLAZA_CANOPY_LOOK.lamp.day },
  night: { sil: PLAZA_CANOPY_LOOK.sil.night, lamp: PLAZA_CANOPY_LOOK.lamp.night },
} as const;

/**
 * Lamp HEADS the canopy under-light is baked against (world): the boulevard
 * and gate lamps at the 4.4 m lamp's head (PlazaHall `LAMP_NIGHT_POOL`, ≈ 4.1 m).
 * The teams pair is never included (no tree stands near it; the teams law).
 */
export const PLAZA_CANOPY_LAMPS: readonly (readonly [number, number, number])[] = PLAZA_LAMP_SEATS.filter(
  (at) => !PLAZA_TEAMS_LAMPS.some((seat) => seat[0] === at[0] && seat[1] === at[1]),
).map((at) => [at[0], 4.1, at[1]] as const);

/** One skin's painted material set, mounted over its seats. */
function PlazaTreeGroup({ skinKey, night }: { skinKey: PlazaTreeSeat['skin']; night: boolean }) {
  const skin = PLAZA_SKIN_BY_KEY[skinKey];
  const materials = useTreeSkinMaterials(skin);
  // LOOK r5 (night: "the trees are pale grey ghosts"): a deep blue-green
  // multiplier on the canopy at night — a colour write, never a program.
  useLayoutEffect(() => {
    materials.canopy?.material.color.set(night ? NIGHT_CANOPY_TINT : '#ffffff');
  }, [materials, night]);
  // Stable specs: a new spec object per render would replan the canopy
  // (new geometry = an upload after reveal).
  const seats = useMemo(
    () =>
      PLAZA_TREE_SEATS.filter((seat) => seat.skin === skinKey).map((seat) => ({
        seat,
        spec: { skin, heightM: seat.heightM, seed: seat.seed } satisfies TreeSpec,
      })),
    [skin, skinKey],
  );
  return (
    <>
      {seats.map(({ seat, spec }) => (
        <Tree
          // C-106 r2 lead-ruled fix: the two north linden seats share one seed
          // literal (the judged C-108 content — both stay 20260984), so the
          // seed alone is NOT a unique React key (route-preview?world=plaza
          // fired duplicate-key console errors; the r2 switch cert caught it).
          // The seat's x disambiguates; keys are reconciliation-only — no
          // rendered pixel, seed, yaw, or placement changes with it.
          key={`${seat.seed}-${seat.x}`}
          spec={spec}
          position={[seat.x, PLANTER_SOIL_Y, seat.z]}
          yaw={plazaTreeYaw(seat)}
          materials={materials}
          lamps={PLAZA_CANOPY_LAMPS}
        />
      ))}
    </>
  );
}

export default function Trees() {
  const palette = usePlazaPalette();
  const night = palette.exposure < 0.75;
  // Back-light translucency, silhouette and lamp under-light per palette
  // (the shared `useCanopyLight` over the plaza's `paint.canopy`): uniform
  // writes, never a program; leaving the plaza hands them back at their defaults.
  const paint = plazaTheme.paint;
  useCanopyLight(paintFeature(paint, 'paintedCanopy') ? (paint?.canopy ?? PLAZA_CANOPY_LOOK) : null, night);
  return (
    <group>
      <PlazaTreeGroup skinKey="linden" night={night} />
      <PlazaTreeGroup skinKey="plane" night={night} />
      <SunShafts />
    </group>
  );
}
