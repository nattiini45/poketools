'use client';

import { Suspense, useMemo } from 'react';
import RouteWorldCanvas from '@/components/world/route/RouteWorldCanvas';
import CameraRig from '@/components/world/route/CameraRig';
import WorldEnvironment from '@/components/world/route/env/WorldEnvironment';
import PostStack from '@/components/world/route/post/PostStack';
import {
  useWorldState,
  WorldStateContext,
  type WorldStateValue,
} from '@/components/world/route/WorldStateProvider';
import { createWorldStateSampler } from '@/lib/route-world/chapters';
import { plazaTheme } from '@/components/world/themes/plaza/theme';
import Atmosphere from './env/Atmosphere';
import Lighting from './env/Lighting';
import HeroProps from './plaza/HeroProps';
import PlazaHall from './plaza/PlazaHall';

/** Sampler over the plaza ledger, for the belt-and-braces path below. */
function usePlazaFallbackSampler() {
  return useMemo(() => createWorldStateSampler(plazaTheme.stations), []);
}

/**
 * Scene composition for the route tier. The HDRI arrives late and alone in
 * its own boundary: the plaza lights with the key + hemisphere pair until the
 * environment map resolves, then gains reflections — never a blank frame.
 * HeroProps mounts the four Meshy props from the manifest (C-043) and owns
 * its own boundary for them.
 *
 * The route theme normally arrives through `WorldStateProvider` — the shell
 * resolves `routeThemeId: 'plaza'` off the world registry. Belt and braces:
 * if the context ever lacks a theme, this scene re-provides the plaza one so
 * every engine actor below (camera, lighting, atmosphere, env) still reads
 * plaza stations, holds and light geometry rather than going inert.
 */
export default function RouteScene() {
  const worldState = useWorldState();
  const plazaSampler = usePlazaFallbackSampler();

  const value = useMemo<WorldStateValue>(
    () =>
      worldState.theme
        ? worldState
        : { ...worldState, theme: plazaTheme, sampleWorldState: plazaSampler.worldStateAt },
    [worldState, plazaSampler],
  );

  return (
    <WorldStateContext.Provider value={value}>
      <RouteWorldCanvas>
        <CameraRig />
        <Lighting />
        <Atmosphere />
        <Suspense fallback={null}>
          <WorldEnvironment />
        </Suspense>
        <PlazaHall />
        <HeroProps />
        <PostStack />
      </RouteWorldCanvas>
    </WorldStateContext.Provider>
  );
}
