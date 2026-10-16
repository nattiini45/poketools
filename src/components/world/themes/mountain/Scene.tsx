'use client';

import RouteWorldCanvas from '@/components/world/route/RouteWorldCanvas';
import CameraRig from '@/components/world/route/CameraRig';
import WorldEnvironment from '@/components/world/route/env/WorldEnvironment';
import PostStack from '@/components/world/route/post/PostStack';
import { ResidentSuspense } from '@/components/world/route/residency-store';
import Lighting from './env/Lighting';
import Atmosphere from './env/Atmosphere';
import MountainValley from './furniture/MountainValley';

/**
 * Scene composition for the mountain route tier. The HDRI arrives late and
 * alone in its own boundary (the plaza's law): the valley lights with the
 * key + hemisphere pair until the environment map resolves, then gains PBR
 * response — never a blank frame. The valley itself is one composition root
 * (`furniture/MountainValley`), and the post stack is the engine's own
 * (bloom/SMAA/vignette/AgX) — no reflection pass of any kind is added.
 */
export default function Scene() {
  return (
    <RouteWorldCanvas>
      <CameraRig />
      <Lighting />
      <Atmosphere />
      {/* ROLLOUT-PLAN §3.2 E4: the environment counts toward residency, so
          the warm (PMREM, the gain-map decode) never settles before it. */}
      <ResidentSuspense id="mountain:environment">
        <WorldEnvironment />
      </ResidentSuspense>
      <MountainValley />
      <PostStack />
    </RouteWorldCanvas>
  );
}
