'use client';

import { useCloudsPalette } from '../use-clouds-palette';
import CloudSea from './CloudSea';
import Islands from './Islands';
import LightBridges from './LightBridges';
import WindField from './WindField';
import Airships from './Airships';
import AcesFloats from './AcesFloats';
import SkyGate from './SkyGate';
import Trees from './Trees';
import SkyFigures from './SkyFigures';
import PropMounts from './PropMounts';
import { ISLE_DRESSING, ISLES } from './layout';
import { Crate, DockRailing, LanternPost, Pennant, Scrub, Shard } from './Props';

/**
 * The archipelago's scene graph: the cloud sea below, the five station isles
 * with their dressing (docks, railings, lanterns, crates, pennants, shards,
 * scrubs), the REAL tree ring (the shared tree system over the rework's own
 * skins), the light-bridge arcs, the wind field, the Pokémon habitation
 * layer (float spotters + fitted sky wilds + the grounded leviathan), the
 * C-107 prop seats (the register's Blender hull + the halo crown) and the
 * station heroes — the moored airships, the aces float row and the halo
 * gate. Everything derives from the route-data provider and the merged
 * clouds palette — no Supabase reads, no Meshy props, every surface
 * procedural or painted in-page. (Composition root for the Scene async
 * entry — touching this file re-wires the whole furniture graph.)
 */
export default function CloudsArchipelago() {
  const palette = useCloudsPalette();
  const night = palette.exposure < 0.75;

  return (
    <group>
      <CloudSea />
      <Islands />
      <LightBridges />
      {Object.entries(ISLE_DRESSING).map(([id, dressing]) => {
        const isle = ISLES[id as keyof typeof ISLES];
        const isleTop = isle ? isle.top : 0;
        return (
          <group key={id}>
            {dressing.railings.map((r) => (
              <DockRailing key={`${r.x},${r.z0}`} x={r.x} z0={r.z0} z1={r.z1} y={isleTop} />
            ))}
            {dressing.lanterns.map((l) => (
              <LanternPost
                key={`${l.x},${l.z}`}
                x={l.x}
                z={l.z}
                y={isleTop}
                s={1.1}
                night={night}
                practical={l.practical}
              />
            ))}
            {dressing.crates.map((c) => (
              <Crate key={`${c.x},${c.z}`} x={c.x} z={c.z} y={isleTop} />
            ))}
            {dressing.pennants.map((p) => (
              <Pennant key={`${p.x},${p.z}`} x={p.x} z={p.z} y={isleTop} h={p.h} />
            ))}
            {dressing.shards.map((s) => (
              <Shard key={`${s.x},${s.z}`} x={s.x} y={s.y} z={s.z} s={s.s} night={night} />
            ))}
            {dressing.scrubs.map((s) => (
              <Scrub key={`${s.x},${s.z}`} x={s.x} z={s.z} y={isleTop} s={s.s} />
            ))}
          </group>
        );
      })}
      <Trees />
      <Airships />
      <AcesFloats />
      <SkyGate />
      <SkyFigures />
      <PropMounts />
      <WindField />
    </group>
  );
}
