'use client';

import { useMemo } from 'react';
import Tree, { useTreeSkinMaterials } from '@/components/world/route/trees/Tree';
import type { TreeSkin } from '@/lib/route-world/tree';
import { knollHeight, TREE_PLACEMENTS, type TreePlacement } from './layout';
import { MOUNTAIN_CONIFER_SKIN, MOUNTAIN_ALPINE_SKIN } from './tree-skin';

/**
 * The valley's REAL trees (C-103 criterion 2): the shared tree system
 * (`tree.ts`/`Tree.tsx`) over the rework's own skin DATA (`tree-skin.ts`) —
 * tapered trunk + recursive branch geometry, layered procedural leaf cards
 * with the WIND_CLOCK vertex sway, quality-gated density tiers and distance
 * culling. The old instanced cylinder-trunk/three-cone-canopy field this
 * file used to mount is gone.
 *
 * ONE `useTreeSkinMaterials(skin)` per skin (conifer + alpine), ONE `<Tree/>`
 * per placement (the ProbeTreeGroup shape). The banded anchors keep the
 * sight-line discipline of record — the bands sit behind the heroes or
 * beside the sightlines, with per-band height caps documented in `layout.ts`
 * (treeCanopyReachM) and the crown-projection scan of record persisted as
 * gauntlet/evidence/_cC103r1-tree-scan.log.
 *
 * Anchors inside the knoll's radius seat at `knollHeight(x, z)` — the same
 * field the mound mesh displaces with, so contact is exact by construction
 * (the layout.ts law).
 *
 * Draw cost: every Tree's static meshes merge into a handful of static
 * batches (one per material/shadow signature), so 45 real trees cost a few
 * draws — the batcher's C-032 trade, with per-tree triangles (~0.7 k at the
 * capture rung) the budget lever instead of instancing. The kit facade's
 * `instancedMeshes > 0` gate stays satisfied by AlpineValley/Props.
 */

const SKIN_BY_KEY: Record<TreePlacement['skin'], TreeSkin> = {
  conifer: MOUNTAIN_CONIFER_SKIN,
  alpine: MOUNTAIN_ALPINE_SKIN,
};

/** One skin's painted material set, mounted over its placements. */
function MountainTreeGroup({ skinKey }: { skinKey: TreePlacement['skin'] }) {
  const skin = useMemo(() => SKIN_BY_KEY[skinKey], [skinKey]);
  const materials = useTreeSkinMaterials(skin);
  return (
    <>
      {TREE_PLACEMENTS.filter((placement) => placement.skin === skinKey).map((placement) => (
        <Tree
          key={placement.seed}
          spec={{ skin, heightM: placement.heightM, seed: placement.seed }}
          position={[placement.x, knollHeight(placement.x, placement.z), placement.z]}
          yaw={(placement.seed % 16) * (Math.PI / 8)}
          materials={materials}
        />
      ))}
    </>
  );
}

export default function Pines() {
  return (
    <group>
      <MountainTreeGroup skinKey="conifer" />
      <MountainTreeGroup skinKey="alpine" />
    </group>
  );
}
