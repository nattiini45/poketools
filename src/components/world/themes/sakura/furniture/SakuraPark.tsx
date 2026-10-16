'use client';

import { useSakuraPalette } from '../use-sakura-palette';
import Ground from './Ground';
import Lake from './Lake';
import Trees from './Trees';
import PetalFall from './PetalFall';
import JumbotronRock from './JumbotronRock';
import PulseSurround from './PulseSurround';
import RosterShrine from './RosterShrine';
import AcesLine from './AcesLine';
import FestivalBanners from './FestivalBanners';
import BridgeSegment from './BridgeSegment';
import ToriiGate from './ToriiGate';
import ParkFigures from './ParkFigures';
import PropMounts from './PropMounts';

/**
 * The park's scene graph: ground, lake, bridge + island, tree ring, petal
 * fall, and the five content heroes — the rock with its r3 shore surround,
 * the dressed shrine wall, the east statuary terrace, the banner row and the
 * torii. The C-102 rework adds the habitation layer (`ParkFigures`:
 * grandstand aces + pool wilds through the C-100 figure contract) and the
 * GLB prop tier (`PropMounts`: C-107 torii hero + stone-lantern
 * practicals). Everything derives from the route-data provider and the
 * merged sakura palette — no Supabase reads, no Meshy props, every surface
 * procedural or painted in-page. (Composition root for the Scene
 * async entry — touching this file re-wires the whole furniture graph.)
 */
export default function SakuraPark() {
  const palette = useSakuraPalette();
  const night = palette.exposure < 0.75;

  return (
    <group>
      <Ground />
      <Lake />
      <BridgeSegment night={night} />
      <Trees />
      <PetalFall />
      <JumbotronRock />
      <PulseSurround />
      <RosterShrine night={night} />
      <AcesLine night={night} />
      <FestivalBanners />
      <ToriiGate />
      <ParkFigures />
      <PropMounts />
    </group>
  );
}
