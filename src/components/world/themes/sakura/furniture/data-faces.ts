import type { DataFace, DataSurfaceTheme, KeepOutBox } from '@/lib/route-world/data-surfaces';
import type { StationFaces } from '@/lib/route-world/particle-discipline';
import { SAKURA_STATIONS } from '../theme';
import { ACES_LINE, BANNERS, BRIDGE, PULSE_SURROUND, ROCK, SHRINE, SHRINE_DRESSING, TORII } from './layout';
import { makeTeamsSite, teamsLedgerFace } from '@/lib/route-world/teams-formation';

/**
 * Sakura's data surfaces (fidelity wave 2, seat 2A — `data-surfaces.ts`):
 * the painted faces the keep-out wedges, the standby dim and the Station
 * Card placement read, the prop boxes the keep-out test holds against them,
 * and the particle corridors the petal field keeps clear
 * (`particle-discipline.ts`; `particle-faces.ts` re-exports this module).
 *
 * Pure data (no client imports). Positions come from the layout anchors;
 * sizes that live as component-local constants are restated with their
 * source named beside them — a component that changes one must change it
 * here too (the analytic model's known risk; captures stay the evidence).
 */

// ── Component constants, restated ───────────────────────────────────────────

/** JumbotronRock.tsx: ROCK_SCREEN_W 7.0 × 9/16, bezel +0.5, plane at local (0, 2.7, 1.545). */
const ROCK_FACE = { w: 7.0 + 0.5, h: 7.0 * (9 / 16) + 0.5, y: 2.7, depth: 1.545 } as const;
/** FestivalBanners.tsx: 2.0 × 6.0 m cloths hung from the 6.5 m arm (desktop row; the mobile row sits inside it). */
const BANNER_CLOTH = { w: 2.0, h: 6.0, armY: 6.5, z: 0.075 } as const;
/** FestivalBanners.tsx ROW_YAW — the banner plane faces the schedule camera. */
const BANNER_ROW_YAW = Math.atan2(1.2 - BANNERS.x, -3.4 - BANNERS.z);
/** ToriiGate.tsx TABLET: the 2.6 × 2.95 m gakuzuka tablet at y = height·0.62 − 1.65, local z 0.3, facing +Z. */
const TORII_TABLET = { w: 2.6, h: 2.95, y: TORII.height * 0.62 - 1.65, z: 0.3 } as const;
/** RosterShrine.tsx: the painted wall plane at local x 0.36, SHRINE.length × (height − 0.14), facing +X. */
const SHRINE_FACE = { x: 0.36, w: SHRINE.length, h: SHRINE.height - 0.14 } as const;
const MARGIN = 0.3;

function yawNormal(yaw: number): [number, number, number] {
  return [Math.sin(yaw), 0, Math.cos(yaw)];
}

// ── Data faces ───────────────────────────────────────────────────────────────

const PULSE_FACE: DataFace = {
  id: 'pulse:board',
  station: 'pulse',
  kind: 'board',
  center: [ROCK.x + Math.sin(ROCK.faceYaw) * ROCK_FACE.depth, ROCK_FACE.y, ROCK.z + Math.cos(ROCK.faceYaw) * ROCK_FACE.depth],
  normal: yawNormal(ROCK.faceYaw),
  size: { w: ROCK_FACE.w, h: ROCK_FACE.h },
};

const ROSTER_FACE: DataFace = {
  id: 'roster:wall',
  station: 'roster',
  kind: 'board',
  center: [SHRINE.x + SHRINE_FACE.x, SHRINE.height / 2, SHRINE.z],
  normal: [1, 0, 0],
  size: { w: SHRINE_FACE.w, h: SHRINE_FACE.h },
};

/**
 * The teams Roll-Call Ledger (fidelity wave 2, seat 2G — D16): ONE walnut
 * rail at the forecourt front edge replaces the eight pedestal plaques.
 * Geometry from `teams-formation.ts` (the law AcesLine mounts), the
 * conservative covering face of a full formation (`teamsLedgerFace`).
 */
const TEAMS_LEDGER_FACE: DataFace = teamsLedgerFace(makeTeamsSite('sakura', SAKURA_STATIONS, ACES_LINE.site));

const SCHEDULE_FACES: DataFace[] = Array.from({ length: BANNERS.count }, (_, i) => {
  const lx = (i - (BANNERS.count - 1) / 2) * BANNERS.spacing;
  const c = Math.cos(BANNER_ROW_YAW);
  const s = Math.sin(BANNER_ROW_YAW);
  // three rotation about +Y: world = (x c + z s, y, −x s + z c).
  return {
    id: `schedule:banner:${i}`,
    station: 'schedule',
    kind: 'sign',
    center: [
      BANNERS.x + lx * c + BANNER_CLOTH.z * s,
      BANNER_CLOTH.armY - BANNER_CLOTH.h / 2 - 0.06,
      BANNERS.z - lx * s + BANNER_CLOTH.z * c,
    ],
    normal: yawNormal(BANNER_ROW_YAW),
    size: { w: BANNER_CLOTH.w, h: BANNER_CLOTH.h },
  };
});

const RULES_FACE: DataFace = {
  id: 'rules:tablet',
  station: 'rules',
  kind: 'tablet',
  center: [TORII.x, TORII_TABLET.y, TORII.z + TORII_TABLET.z],
  normal: [0, 0, 1],
  size: { w: TORII_TABLET.w, h: TORII_TABLET.h },
};

export const SAKURA_DATA_FACES: readonly DataFace[] = [
  PULSE_FACE,
  ROSTER_FACE,
  TEAMS_LEDGER_FACE,
  ...SCHEDULE_FACES,
  RULES_FACE,
];

export const SAKURA_DATA_SURFACES: DataSurfaceTheme = {
  id: 'sakura',
  stations: SAKURA_STATIONS,
  faces: SAKURA_DATA_FACES,
};

// ── Prop boxes the keep-out holds against the faces ──────────────────────────

/** StoneLantern.tsx: ≈ 1.3 m × scale tall, ≈ 0.34 m × scale roof half-width. */
function stoneLantern(id: string, x: number, z: number, scale: number): KeepOutBox {
  return { id, center: [x, 0.65 * scale, z], half: [0.3 * scale, 0.65 * scale, 0.3 * scale] };
}

/** Props.tsx RopeRailing: 0.95 m posts, the rope hung from the caps (≈ 0.92 m). */
function ropeRailing(prefix: string, x: number, posts: readonly number[]): KeepOutBox[] {
  const out: KeepOutBox[] = posts.map((z, i) => ({ id: `${prefix}:post:${i}`, center: [x, 0.47, z], half: [0.06, 0.47, 0.06] }));
  for (let i = 0; i + 1 < posts.length; i += 1) {
    const z0 = posts[i];
    const z1 = posts[i + 1];
    out.push({ id: `${prefix}:rope:${i}`, center: [x, 0.86, (z0 + z1) / 2], half: [0.02, 0.07, Math.abs(z1 - z0) / 2] });
  }
  return out;
}

function fence(): KeepOutBox[] {
  const f = PULSE_SURROUND.fence;
  const out: KeepOutBox[] = [];
  for (let i = 0; i < f.posts; i += 1) {
    const x = f.x0 + ((f.x1 - f.x0) * i) / Math.max(1, f.posts - 1);
    out.push({ id: `pulse-fence:post:${i}`, center: [x, 0.52, f.z], half: [0.06, 0.52, 0.06] });
  }
  f.railY.forEach((y, i) =>
    out.push({ id: `pulse-fence:rail:${i}`, center: [(f.x0 + f.x1) / 2, y, f.z], half: [(f.x1 - f.x0) / 2, 0.03, 0.03] }),
  );
  return out;
}

/** BridgeSegment.tsx: hand rails ≈ 0.9 m over the deck at ±width/2, the deck rising `rise` at mid-span. */
function bridgeRails(): KeepOutBox[] {
  const dx = BRIDGE.to.x - BRIDGE.from.x;
  const dz = BRIDGE.to.z - BRIDGE.from.z;
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(dz, dx) * -1;
  const px = -dz / len;
  const pz = dx / len;
  return ([-1, 1] as const).map((side) => ({
    id: `bridge:rail:${side}`,
    center: [
      (BRIDGE.from.x + BRIDGE.to.x) / 2 + px * side * (BRIDGE.width / 2),
      BRIDGE.rise + 0.45,
      (BRIDGE.from.z + BRIDGE.to.z) / 2 + pz * side * (BRIDGE.width / 2),
    ],
    half: [len / 2, 0.5, 0.04],
    yaw,
  }));
}

export const SAKURA_PROP_BOXES: readonly KeepOutBox[] = [
  ...fence(),
  ...PULSE_SURROUND.lanterns.map((l, i) => stoneLantern(`pulse-lantern:${i}`, l.x, l.z, l.scale)),
  { id: 'pulse-signpost', center: [PULSE_SURROUND.signpost.x, 0.95, PULSE_SURROUND.signpost.z], half: [0.4, 0.95, 0.06] },
  ...([-1, 1] as const).map((side) => stoneLantern(`teams-bookend:${side}`, ACES_LINE.bookends.x, side * ACES_LINE.bookends.z, ACES_LINE.bookends.scale)),
  ...ACES_LINE.flankers.map((f, i) => stoneLantern(`teams-flanker:${i}`, f.x, f.z, 0.95)),
  ...ropeRailing('teams-railing', ACES_LINE.railing.x, ACES_LINE.railing.posts),
  ...ACES_LINE.pennants.map((p, i) => ({ id: `teams-pennant:${i}`, center: [p.x, p.h / 2, p.z] as const, half: [0.05, p.h / 2, 0.05] as const })),
  ...bridgeRails(),
  // Props.tsx Shrub (RosterShrine wall-foot dressing): two blobs, the pair's
  // extent ±0.44·s around the seat and 0–0.74·s tall (wave-2 r2: boxed so
  // the roster:wall focus pose holds them out of the wedge).
  ...SHRINE_DRESSING.shrubs.map((b) => ({
    id: `roster-shrub:${b.z}`,
    center: [b.x + 0.08 * b.s, 0.37 * b.s, b.z] as const,
    half: [0.44 * b.s, 0.37 * b.s, 0.44 * b.s] as const,
  })),
];

// ── Particle corridors (the petal field keeps these clear) ───────────────────

export const SAKURA_PARTICLE_FACES: StationFaces = {
  pulse: {
    center: PULSE_FACE.center,
    halfWidth: ROCK_FACE.w / 2 + MARGIN,
    halfHeight: ROCK_FACE.h / 2 + MARGIN,
  },
  roster: {
    center: [SHRINE.x + 0.36, SHRINE.height / 2, SHRINE.z],
    halfWidth: SHRINE.length / 2 + MARGIN,
    halfHeight: SHRINE.height / 2 + MARGIN,
  },
  // Fidelity wave 2 (2G, D16): the teams data face is the Roll-Call Ledger
  // (the plaques are gone; the statues are figures, not data).
  teams: {
    center: TEAMS_LEDGER_FACE.center,
    halfWidth: TEAMS_LEDGER_FACE.size.w / 2 + MARGIN,
    halfHeight: TEAMS_LEDGER_FACE.size.h / 2 + MARGIN,
  },
  schedule: {
    center: [BANNERS.x, BANNER_CLOTH.armY - BANNER_CLOTH.h / 2, BANNERS.z],
    halfWidth: ((BANNERS.count - 1) / 2) * BANNERS.spacing + BANNER_CLOTH.w / 2 + MARGIN,
    halfHeight: BANNER_CLOTH.h / 2 + MARGIN,
  },
  rules: {
    center: RULES_FACE.center,
    halfWidth: TORII_TABLET.w / 2 + MARGIN,
    halfHeight: TORII_TABLET.h / 2 + MARGIN,
  },
};
