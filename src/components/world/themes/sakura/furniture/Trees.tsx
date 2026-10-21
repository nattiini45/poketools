'use client';

import { useMemo } from 'react';
import Tree, { useTreeSkinMaterials } from '@/components/world/route/trees/Tree';
import type { TreeSkin } from '@/lib/route-world/tree';
import { TREE_PLACEMENTS, type TreePlacement } from './layout';
import { SAKURA_CHERRY_SKIN, SAKURA_PARK_SKIN } from './tree-skin';

/**
 * The park's REAL trees (C-102 criterion 2): the shared tree system
 * (`tree.ts`/`Tree.tsx`) over the rework's own skin DATA (`tree-skin.ts`) —
 * tapered trunk + recursive branch geometry, layered procedural blossom
 * leaf cards with the WIND_CLOCK vertex sway, quality-gated density tiers
 * and distance culling. The old instanced cylinder-trunk/icosahedron-blob
 * field this file used to mount is gone.
 *
 * ONE `useTreeSkinMaterials(skin)` per skin (cherry + park), ONE `<Tree/>`
 * per placement (the ProbeTreeGroup shape). The ring's banded anchors keep
 * the sight-line discipline of record — the bands sit behind the heroes or
 * beside the sightlines, never across them, with per-band height caps
 * documented in `layout.ts` (treeCanopyReachM).
 *
 * Draw cost: every Tree's static meshes merge into a handful of static
 * batches (one per material/shadow signature), so 34 real trees cost a few
 * draws — the batcher's C-032 trade, with per-tree triangles (~0.6 k at the
 * capture rung) the budget lever instead of instancing.
 */

const SKIN_BY_KEY: Record<TreePlacement['skin'], TreeSkin> = {
  cherry: SAKURA_CHERRY_SKIN,
  park: SAKURA_PARK_SKIN,
};

/** One skin's painted material set, mounted over its placements. */
function SakuraTreeGroup({ skinKey }: { skinKey: TreePlacement['skin'] }) {
  const skin = useMemo(() => SKIN_BY_KEY[skinKey], [skinKey]);
  const materials = useTreeSkinMaterials(skin);
  return (
    <>
      {TREE_PLACEMENTS.filter((placement) => placement.skin === skinKey).map((placement) => (
        <Tree
          key={placement.seed}
          spec={{ skin, heightM: placement.heightM, seed: placement.seed }}
          position={[placement.x, 0, placement.z]}
          yaw={(placement.seed % 16) * (Math.PI / 8)}
          materials={materials}
        />
      ))}
    </>
  );
}

export default function Trees() {
  return (
    <group>
      <SakuraTreeGroup skinKey="cherry" />
      <SakuraTreeGroup skinKey="park" />
    </group>
  );
}
