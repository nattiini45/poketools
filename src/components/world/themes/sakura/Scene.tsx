'use client';

import RouteWorldCanvas from '@/components/world/route/RouteWorldCanvas';
import CameraRig from '@/components/world/route/CameraRig';
import WorldEnvironment from '@/components/world/route/env/WorldEnvironment';
import PostStack from '@/components/world/route/post/PostStack';
import { ResidentSuspense } from '@/components/world/route/residency-store';
import Lighting from './env/Lighting';
import Atmosphere from './env/Atmosphere';
import SakuraPark from './furniture/SakuraPark';

/**
 * Scene composition for the sakura route tier. The HDRI arrives late and
 * alone in its own boundary (the plaza's law): the park lights with the key
 * + hemisphere pair until the environment map resolves, then gains PBR
 * response — never a blank frame. The park itself is one composition root
 * (`furniture/SakuraPark`), and the post stack is the engine's own
 * (bloom/SMAA/vignette/AgX) — no reflection pass of any kind is added.
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
      <ResidentSuspense id="sakura:environment">
        <WorldEnvironment />
      </ResidentSuspense>
      <SakuraPark />
      <PostStack />
    </RouteWorldCanvas>
  );
}
