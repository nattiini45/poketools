'use client';

import { useMemo } from 'react';
import Tree, { useTreeSkinMaterials } from '@/components/world/route/trees/Tree';
import type { TreeSkin } from '@/lib/route-world/tree';
import { TREE_PLACEMENTS, type TreePlacement } from './layout';
import { CLOUDS_SKY_GARDEN_SKIN, CLOUDS_GROVE_SKIN } from './tree-skin';

/**
 * The isles' REAL trees (C-104 criterion 2): the shared tree system
 * (`tree.ts`/`Tree.tsx`) over the rework's own skin DATA (`tree-skin.ts`) —
 * tapered trunk + recursive branch geometry, layered procedural leaf cards
 * with the WIND_CLOCK vertex sway, quality-gated density tiers and distance
 * culling. The round-crown cylinder/icosahedron blob kit this world used to
 * mount is gone.
 *
 * ONE `useTreeSkinMaterials(skin)` per skin (sky-garden + grove), ONE
 * `<Tree/>` per placement (the C-102/C-103 rework shape). The placements sit
 * on their isle's leeward rims behind their hero's content plane, with the
 * crown-projection scan proving 0 in-front rect hits through ALL five
 * desktop and landed-390 poses (see `layout.ts` TREE_PLACEMENTS).
 *
 * Draw cost: every Tree's static meshes merge into a handful of static
 * batches (one per material/shadow signature), so 15 real trees cost a few
 * draws — the batcher's C-032 trade, with per-tree triangles the budget
 * lever instead of instancing.
 */

const SKIN_BY_KEY: Record<TreePlacement['skin'], TreeSkin> = {
  'sky-garden': CLOUDS_SKY_GARDEN_SKIN,
  grove: CLOUDS_GROVE_SKIN,
};

/** One skin's painted material set, mounted over its placements. */
function CloudsTreeGroup({ skinKey }: { skinKey: TreePlacement['skin'] }) {
  const skin = useMemo(() => SKIN_BY_KEY[skinKey], [skinKey]);
  const materials = useTreeSkinMaterials(skin);
  return (
    <>
      {TREE_PLACEMENTS.filter((placement) => placement.skin === skinKey).map((placement) => (
        <Tree
          key={placement.seed}
          spec={{ skin, heightM: placement.heightM, seed: placement.seed }}
          position={[placement.x, placement.y, placement.z]}
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
      <CloudsTreeGroup skinKey="sky-garden" />
      <CloudsTreeGroup skinKey="grove" />
    </group>
  );
}
