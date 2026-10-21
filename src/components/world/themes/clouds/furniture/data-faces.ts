import type { Vec3 } from '@/lib/route-world/chapters';
import type { DataFace, DataFaceKind, DataSurfaceTheme, KeepOutBox } from '@/lib/route-world/data-surfaces';
import { landedEndpoint } from '@/lib/route-world/legibility';
import { coveringFace, type FaceRect, type StationFaces } from '@/lib/route-world/particle-discipline';
import { CLOUDS_STATIONS } from '../theme';
import { makeTeamsSite, teamsLedgerFace } from '@/lib/route-world/teams-formation';
import { FIXTURES_AIRSHIP, FLAGSHIP, FLOAT_ROW, HALO_GATE, ISLES, MOORINGS, REGISTER_AIRSHIP, type Airship } from './layout';

/**
 * Skyisle's data surfaces (fidelity wave 2, seat 2A — `data-surfaces.ts`):
 * the painted faces the keep-out wedges, the standby dim and the Station
 * Card placement read (`CLOUDS_DATA_FACES`, derived from the SAME rendered
 * rectangles as the corridors below), the prop boxes the keep-out test holds
 * against them, and the content corridors the wind field keeps clear
 * (`particle-discipline.ts`; `particle-faces.ts` re-exports this module).
 * Pure data (no client imports).
 *
 * Fidelity W1 r3 (the pulse-face streak veto): the round-2 faces came from
 * the layout ANCHORS (`FLAGSHIP.face`), but `MooredAirship` mounts the sail
 * on the hull group — `hull.y = face.y + hullLift` — so the painted sail
 * rides 0.85–0.9 m ABOVE the anchor the corridor was centred on. The wedge
 * therefore covered the lower board and the air below it, and streaks
 * crossed the kicker, the masthead and the LIVE pill with hard cut-offs.
 * Every face is now derived from the RENDERED rectangle (the framed board,
 * bezel included — the same transforms Airships / SkyGate / AcesFloats
 * apply) through `coveringFace`, from both the desktop and the landed
 * mobile eye, plus `MARGIN` for the streak's own width and the soft rim.
 * No airship bobs (MooredAirship is static), so the frozen derivation is
 * the rendered geometry; the debug readout `__routeWorldParticles()`
 * re-projects both through the live camera to prove it.
 */

const MARGIN = 0.3;

/** The rendered, framed sail of a moored airship (Airships.tsx `MooredAirship`). */
export function airshipSailRect(ship: Airship): FaceRect {
  // The group sits at `ship.hull`; the painted plane is at normal · (hullRadius + 0.02),
  // the bezel box (faceW + 0.5 × faceH + 0.5) directly behind it.
  const k = ship.hullRadius + 0.02;
  return {
    center: [ship.hull.x + Math.sin(ship.faceYaw) * k, ship.hull.y, ship.hull.z + Math.cos(ship.faceYaw) * k],
    yaw: ship.faceYaw,
    halfWidth: ship.faceW / 2 + 0.25,
    halfHeight: ship.faceH / 2 + 0.25,
  };
}

/** The rules plaque plus its 0.4 m-oversize bezel (SkyGate.tsx). */
export const HALO_PLAQUE_RECT: FaceRect = {
  center: [HALO_GATE.face.x, HALO_GATE.face.y, HALO_GATE.face.z],
  yaw: HALO_GATE.faceYaw,
  halfWidth: HALO_GATE.faceW / 2 + 0.2,
  halfHeight: HALO_GATE.faceH / 2 + 0.2,
};

/**
 * The teams Roll-Call Ledger (fidelity wave 2, seat 2G — D16): ONE brass rail
 * at the isle's west kerb replaces the eight float plaques. Geometry from
 * `teams-formation.ts` (the law AcesFloats mounts), the conservative covering
 * face of a full formation (`teamsLedgerFace`). The wind corridor covers it
 * as an upright rect of the face's full size (the face leans back ≈ 20°, so
 * its real height is shorter — conservative).
 */
export const TEAMS_LEDGER_FACE: DataFace = teamsLedgerFace(makeTeamsSite('clouds', CLOUDS_STATIONS, FLOAT_ROW.site));

export const TEAMS_LEDGER_RECT: FaceRect = {
  center: TEAMS_LEDGER_FACE.center,
  yaw: Math.atan2(TEAMS_LEDGER_FACE.normal[0], TEAMS_LEDGER_FACE.normal[2]),
  halfWidth: TEAMS_LEDGER_FACE.size.w / 2,
  halfHeight: TEAMS_LEDGER_FACE.size.h / 2,
};

/** The rendered rectangles each station's corridor must cover. */
export const CLOUDS_FACE_RECTS: Readonly<Record<string, readonly FaceRect[]>> = {
  pulse: [airshipSailRect(FLAGSHIP)],
  roster: [airshipSailRect(REGISTER_AIRSHIP)],
  teams: [TEAMS_LEDGER_RECT],
  schedule: [airshipSailRect(FIXTURES_AIRSHIP)],
  rules: [HALO_PLAQUE_RECT],
};

function stationEyes(id: string): Vec3[] {
  const station = CLOUDS_STATIONS.find((candidate) => candidate.id === id);
  if (!station) return [];
  return [station.camera.position, landedEndpoint(station.cameraMobile).position, station.cameraMobile.position];
}

export const CLOUDS_PARTICLE_FACES: StationFaces = Object.fromEntries(
  Object.entries(CLOUDS_FACE_RECTS).map(([id, rects]) => [id, coveringFace(rects, stationEyes(id), MARGIN)]),
);

// ── Data faces (fidelity wave 2) ────────────────────────────────────────────

const STATION_FACE_KIND: Readonly<Record<string, DataFaceKind>> = {
  pulse: 'board',
  roster: 'board',
  teams: 'ledger',
  schedule: 'board',
  rules: 'tablet',
};

function rectFace(id: string, station: string, rect: FaceRect): DataFace {
  return {
    id,
    station,
    kind: STATION_FACE_KIND[station] ?? 'board',
    center: rect.center,
    normal: [Math.sin(rect.yaw), 0, Math.cos(rect.yaw)],
    size: { w: rect.halfWidth * 2, h: rect.halfHeight * 2 },
  };
}

/**
 * One data face per rendered rectangle: `pulse:board`, `roster:board`,
 * `teams:ledger` (the Roll-Call Ledger, seat 2G), `schedule:board`,
 * `rules:tablet`.
 */
export const CLOUDS_DATA_FACES: readonly DataFace[] = Object.entries(CLOUDS_FACE_RECTS).flatMap(([station, rects]) =>
  // The teams ledger leans back to its eye: its data face is the exact tilted face, not the upright corridor rect.
  station === 'teams'
    ? [TEAMS_LEDGER_FACE]
    : rects.map((rect, i) =>
        rectFace(rects.length > 1 ? `${station}:${STATION_FACE_KIND[station] ?? 'board'}:${i}` : `${station}:${STATION_FACE_KIND[station] ?? 'board'}`, station, rect),
      ),
);

export const CLOUDS_DATA_SURFACES: DataSurfaceTheme = {
  id: 'clouds',
  stations: CLOUDS_STATIONS,
  faces: CLOUDS_DATA_FACES,
};

/**
 * Prop boxes the keep-out holds against the faces. PropMounts.tsx mooring
 * masts: a ≈ 0.16 m mast `h` tall on its isle's top. (The tethers are
 * sloped lines — `segmentClear` material, not boxes; not modelled here.)
 */
export const CLOUDS_PROP_BOXES: readonly KeepOutBox[] = Object.entries(MOORINGS).map(([isle, m]) => {
  const top = isle in ISLES ? ISLES[isle as keyof typeof ISLES].top : 0;
  return { id: `mooring:${isle}`, center: [m.x, top + m.h / 2, m.z], half: [0.08, m.h / 2, 0.08] };
});
