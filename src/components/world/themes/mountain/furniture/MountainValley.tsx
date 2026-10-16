'use client';

import { useMountainPalette } from '../use-mountain-palette';
import AlpineValley from './AlpineValley';
import Ridges from './Ridges';
import Pines from './Pines';
import Snowfall from './Snowfall';
import SummitCairn from './SummitCairn';
import TrailRegister from './TrailRegister';
import CairnCircle from './CairnCircle';
import TrailSigns from './TrailSigns';
import PassGate from './PassGate';
import PassFigures from './PassFigures';
import PropMounts from './PropMounts';

/**
 * The valley's scene graph: the terrain (meadow, knoll + crag, tarn, the
 * switchback trail ring), the impostor ridge rings, the REAL conifer/alpine
 * trees (the shared tree system over the rework's own skins), the snowfall,
 * the five content heroes — the summit standings station, the register lodge
 * wall, the cairn terrace, the trail-sign meadow and the pass gate — plus
 * the Pokémon habitation layer (PassFigures) and the C-107 GLB props
 * (PropMounts). Everything derives from the route-data provider and the
 * merged mountain palette — no Supabase reads, no Meshy props, every surface
 * procedural or painted in-page. (Composition root for the Scene async
 * entry — touching this file re-wires the whole furniture graph.)
 */
export default function MountainValley() {
  const palette = useMountainPalette();
  const night = palette.exposure < 0.75;

  return (
    <group>
      <AlpineValley />
      <Ridges night={night} />
      <Pines />
      <Snowfall />
      <SummitCairn />
      <TrailRegister night={night} />
      <CairnCircle night={night} />
      <TrailSigns />
      <PassGate />
      <PassFigures />
      <PropMounts />
    </group>
  );
}
