'use client';

import RouteWorldCanvas from '@/components/world/route/RouteWorldCanvas';
import CameraRig from '@/components/world/route/CameraRig';
import WorldEnvironment from '@/components/world/route/env/WorldEnvironment';
import PostStack from '@/components/world/route/post/PostStack';
import { ResidentSuspense } from '@/components/world/route/residency-store';
import Lighting from './env/Lighting';
import Atmosphere from './env/Atmosphere';
import CloudsArchipelago from './furniture/CloudsArchipelago';

/**
 * Scene composition for the clouds route tier. The HDRI arrives late and
 * alone in its own boundary (the plaza's law): the isles light with the
 * key + hemisphere pair until the environment map resolves, then gain PBR
 * response — never a blank frame. The archipelago is one composition root
 * (`furniture/CloudsArchipelago`), and the post stack is the engine's own
 * shared, props-less `<PostStack />` mount (bloom/SMAA/vignette/AgX) — the
 * theme's stronger bloom READ comes from its authored emission (the
 * light-bridges' 7.0 night emissive), never from engine edits.
 */
export default function Scene() {
  return (
    <RouteWorldCanvas>
      <CameraRig />
      <Lighting />
      <Atmosphere />
      {/* ROLLOUT-PLAN §3.2 E4 (as mountain): the environment counts toward
          residency, so the warm (PMREM, the gain-map decode) never settles
          before it. */}
      <ResidentSuspense id="clouds:environment">
        <WorldEnvironment />
      </ResidentSuspense>
      <CloudsArchipelago />
      <PostStack />
    </RouteWorldCanvas>
  );
}
