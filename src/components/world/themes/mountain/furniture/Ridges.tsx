'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useMountainPalette } from '../use-mountain-palette';
import { usePaintedTexture } from '../content/use-painted-texture';
import { seeded } from './Props';

/**
 * The impostor ridges: two rings of billboard planes ringing the valley —
 * a NEAR ring (dark granite silhouettes, conifer crest, radius 46) and a
 * FAR ring (haze-washed snow-capped silhouettes, radius 74). The fog depth
 * layering is authored twice over: each ring's paint bakes its own aerial
 * haze (the far ring's ridge tones are mixed toward the horizon by ≈ 55 %),
 * and the scene's FogExp2 adds the depth response on top — two clearly
 * distinguishable depth layers in every wide capture. Each plane's outer
 * edges taper to the conifer crest and fade to transparent, so the ring
 * reads as one continuous range dissolving into the haze (no rectangular
 * seams). R4: the UPPER boundary carries the same crest treatment as the
 * base — seeded rock teeth along the whole top silhouette (both rings) —
 * plus a haze-tinted rim band stroked inside the silhouette edge, so the
 * alphaTest cut sits inside a colored gradient rather than cutting white
 * snow against bare sky (the r2/r3 side-taper widenings alone left the
 * "stair-stepped white slab" tops). The planes yaw to the camera every
 * frame (classic impostor billboards), painted once per plane from a seeded
 * ridge profile so stills stay reproducible.
 */

interface RidgeRingSpec {
  /** Ring radius (metres). */
  radius: number;
  /** Plane width/height (metres). */
  w: number;
  h: number;
  /** Plane count. */
  count: number;
  /** Base y (planes sink below the meadow line). */
  baseY: number;
  /** How much of the ridge tone is washed toward the horizon haze (0..1). */
  haze: number;
  /** Snowline in the painted profile (0 = base, 1 = peak top). */
  snowFrom: number;
  /** Paint seed base (reproducible profiles). */
  seed: number;
  /** Scale of the ridge's jagged profile. */
  jag: number;
}

const NEAR_RING: RidgeRingSpec = {
  radius: 46,
  w: 40,
  h: 15,
  count: 8,
  baseY: -0.5,
  haze: 0.12,
  snowFrom: 0.72,
  seed: 400,
  jag: 1.0,
};

const FAR_RING: RidgeRingSpec = {
  radius: 74,
  w: 58,
  h: 22,
  count: 8,
  baseY: -0.5,
  haze: 0.55,
  snowFrom: 0.52,
  seed: 800,
  jag: 1.35,
};

/**
 * Paint one ridge silhouette: a jagged massif profile with a snow cap above
 * `snowFrom` and a conifer crest at the base, haze-washed toward the horizon
 * tone by `haze`. The plane's outer band each side tapers down to the crest
 * and fades to transparent (a wider band on the far ring, plus an edge haze
 * veil), so neighboring billboards interleave into one continuous range —
 * the horizon reads as atmosphere, never cut-out cards.
 * Pure 2D on the given canvas.
 */
function paintRidge(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ring: RidgeRingSpec,
  colors: { rock: string; cliff: string; snow: string; hazeTone: string; fringe: string },
  planeIndex: number,
): void {
  const hazeMix = (hex: string, amount: number): string => {
    const parse = (value: string) => {
      const p = value.replace('#', '');
      return [
        parseInt(p.slice(0, 2), 16),
        parseInt(p.slice(2, 4), 16),
        parseInt(p.slice(4, 6), 16),
      ] as const;
    };
    const [r1, g1, b1] = parse(hex);
    const [r2, g2, b2] = parse(colors.hazeTone);
    const c = (a: number, b: number) => Math.round(a + (b - a) * amount);
    return `rgb(${c(r1, r2)},${c(g1, g2)},${c(b1, b2)})`;
  };
  const smooth = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  ctx.clearRect(0, 0, w, h);

  // The massif silhouette: a seeded ridge walk across the width.
  const segments = 64;
  const baseY = h * 0.96;
  // The far ring widens its edge taper (0.07 → 0.16): the r2 alphaTest cut
  // fired where the silhouette was still ≈ 80 % of ridge height, reading as
  // a vertical slab edge between far planes (the ≈ x655–740 / ≈ x105 seams
  // in the pulse wide frame). At 0.16 the profile is down near the crest
  // where the cut lands, and the veil below lifts the residual step into
  // the horizon tone.
  const far = ring.haze >= 0.3;
  const EDGE = far ? 0.16 : 0.07;
  /** Silhouette floor at the plane seams — the conifer-crest height. */
  const crest = 0.055;
  /** The horizon tone as rgba — the far-ring edge veil's paint. */
  const hazeRgba = (alpha: number): string => {
    const p = colors.hazeTone.replace('#', '');
    return `rgba(${parseInt(p.slice(0, 2), 16)},${parseInt(p.slice(2, 4), 16)},${parseInt(
      p.slice(4, 6),
      16,
    )},${alpha})`;
  };
  const profile: number[] = [];
  let ridge = 0.42 + seeded(ring.seed + planeIndex * 13) * 0.18;
  for (let i = 0; i <= segments; i += 1) {
    const s = seeded(ring.seed + planeIndex * 131 + i * 7);
    ridge += (s - 0.5) * 0.09 * ring.jag;
    ridge = Math.min(0.95, Math.max(0.3, ridge));
    profile.push(ridge);
  }
  // One dominant peak per plane.
  const peakAt = 0.3 + seeded(ring.seed + planeIndex * 17) * 0.4;
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const peak = Math.exp(-((t - peakAt) ** 2) / 0.06) * 0.34 * ring.jag;
    profile[i] = Math.min(0.97, profile[i] + peak);
    // Edge blend: the silhouette descends into the haze over the outer
    // taper (7 % near / 16 % far), so adjacent planes overlap as low crest
    // instead of hard vertical cuts.
    const edge = smooth(0, EDGE, t) * (1 - smooth(1 - EDGE, 1, t));
    profile[i] = crest + (profile[i] - crest) * edge;
  }
  // R5 crown headroom: `baseY` sits at 0.96·h, so any profile value above
  // 0.96 pinned the summit silhouette AT THE CANVAS TOP — a straight cut the
  // teeth (drawn upward from the profile) and the haze rim both fell off the
  // canvas on. That cut is the visual review's "smooth toothless plateau crown", and
  // its steep gaussian shoulder read as the hard vertical seam at full ridge
  // height in the rules-390/768 gate views. Scale the whole profile (shape
  // and seed determinism preserved) so even the peakiest crown keeps
  // (0.96 − 0.88)·h of headroom — room for the tallest tooth (≈ 0.05·h) and
  // the rim stroke inside the canvas on both rings.
  let maxProfile = 0;
  for (let i = 0; i <= segments; i += 1) maxProfile = Math.max(maxProfile, profile[i]);
  const CROWN_MAX = 0.88;
  if (maxProfile > CROWN_MAX) {
    const crownScale = CROWN_MAX / maxProfile;
    for (let i = 0; i <= segments; i += 1) profile[i] *= crownScale;
  }

  const bodyPath = (): void => {
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      ctx.lineTo(t * w, baseY - profile[i] * h);
    }
    ctx.lineTo(w, baseY);
    ctx.closePath();
  };

  // Rock body, haze-washed.
  bodyPath();
  ctx.fillStyle = hazeMix(colors.cliff, ring.haze);
  ctx.fill();
  bodyPath();
  ctx.fillStyle = hazeMix(colors.rock, ring.haze * 0.8);
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Snow caps above the profile's snowline band.
  ctx.save();
  bodyPath();
  ctx.clip();
  ctx.fillStyle = hazeMix(colors.snow, ring.haze);
  ctx.beginPath();
  ctx.moveTo(0, baseY - (ring.snowFrom - 0.08) * h);
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    // The snow line follows the ridge with a seeded ragged offset.
    const rag = (seeded(ring.seed + planeIndex * 57 + i * 11) - 0.5) * 0.1;
    ctx.lineTo(t * w, baseY - Math.max(0.05, profile[i] - ring.snowFrom + rag) * h);
  }
  ctx.lineTo(w, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // R4 upper-edge restructure (the r2/r3 side-taper widenings were judged
  // insufficient for the "stair-stepped white slab" read): the TOP boundary
  // gets the r2 conifer-crest treatment — seeded rock teeth along the whole
  // upper silhouette on BOTH rings — so the profile line is an irregular
  // granite crest, never a smooth low-frequency dome with a hard cut.
  // R5: the teeth now run INTO the side-taper/seam zones (the r4
  // `guard < 0.9` skip left exactly the boundaries the rules station's
  // 390/768 aspects expose) — tooth height scales smoothly with the taper
  // guard down to a short stub, so every visible boundary is crested, and
  // only the last sliver (guard < 0.15, silhouette at the conifer crest
  // under the haze veil) stays toothless.
  ctx.fillStyle = hazeMix(colors.rock, ring.haze);
  for (let i = 1; i < segments; i += 1) {
    const t = i / segments;
    const guard = smooth(0, EDGE, t) * (1 - smooth(1 - EDGE, 1, t));
    if (guard < 0.15) continue;
    const x = t * w + (seeded(ring.seed + planeIndex * 89 + i * 13) - 0.5) * (w / segments) * 0.6;
    const yTop = baseY - profile[i] * h + 1;
    const th =
      (0.02 + seeded(ring.seed + planeIndex * 97 + i * 3) * 0.042) *
      h *
      (far ? 0.8 : 1) *
      (0.4 + 0.6 * guard);
    const halfW = (w / segments) * (0.55 + seeded(ring.seed + planeIndex * 101 + i * 5) * 0.7);
    ctx.beginPath();
    ctx.moveTo(x - halfW, yTop);
    ctx.lineTo(x + (seeded(ring.seed + planeIndex * 103 + i * 7) - 0.5) * halfW, yTop - th);
    ctx.lineTo(x + halfW, yTop);
    ctx.closePath();
    ctx.fill();
  }

  // R4 haze rim: a sky-toned band stroked along the upper silhouette and
  // clipped INSIDE the body — the alphaTest cut then lands inside a colored
  // gradient (haze → snow/rock), not against bare sky. Both rings; the far
  // ring's band runs stronger (its haze mix is the horizon by ≈ 55 %).
  ctx.save();
  bodyPath();
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(0, baseY - profile[0] * h);
  for (let i = 1; i <= segments; i += 1) {
    const t = i / segments;
    ctx.lineTo(t * w, baseY - profile[i] * h);
  }
  ctx.strokeStyle = hazeRgba(far ? 0.85 : 0.7);
  ctx.lineWidth = Math.max(3, h * 0.09);
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();

  // Conifer crest along the base — seeded triangular spikes on BOTH rings
  // (the far ring's is smaller and haze-washed harder), so the dark horizon
  // reads as an irregular treeline, never a blocky band.
  ctx.fillStyle = hazeMix(colors.fringe, far ? Math.min(1, ring.haze + 0.1) : ring.haze);
  const spikes = segments * 2;
  const fringeScale = far ? 0.6 : 1;
  for (let i = 0; i <= spikes; i += 1) {
    const t = i / spikes;
    const th = (0.05 + seeded(ring.seed + planeIndex * 71 + i * 3) * 0.05) * fringeScale;
    const halfW = (w / spikes) * (0.8 + seeded(ring.seed + planeIndex * 73 + i * 5) * 0.55);
    const x = t * w + (seeded(ring.seed + planeIndex * 79 + i * 11) - 0.5) * (w / spikes);
    const tipX = x + (seeded(ring.seed + planeIndex * 83 + i * 13) - 0.5) * halfW;
    ctx.beginPath();
    ctx.moveTo(x - halfW, baseY + 1);
    ctx.lineTo(tipX, baseY - th * h);
    ctx.lineTo(x + halfW, baseY + 1);
    ctx.closePath();
    ctx.fill();
  }

  // Far ring only: a haze veil across the outer taper zones — the residual
  // crest step at the plane joins lifts into the horizon tone, so the join
  // reads as atmosphere, never a cut-out edge. `source-atop` tints existing
  // pixels only, keeping the alpha ramp intact for the alphaTest cut.
  if (far) {
    const veil = ctx.createLinearGradient(0, 0, w, 0);
    veil.addColorStop(0, hazeRgba(0.9));
    veil.addColorStop(EDGE, hazeRgba(0));
    veil.addColorStop(1 - EDGE, hazeRgba(0));
    veil.addColorStop(1, hazeRgba(0.9));
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  // Soft-edge blend: alpha fades to zero across the outer band each side
  // (5 % near / 8 % far, always inside the widened taper), so the billboard's
  // rectangle dissolves into the baked haze (the alphaTest cut then lands
  // where the silhouette is already at near-crest height, invisible).
  const fade = ctx.createLinearGradient(0, 0, w, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(far ? 0.08 : 0.05, 'rgba(0,0,0,1)');
  fade.addColorStop(far ? 0.92 : 0.95, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
}

function RidgeRing({
  spec,
  night,
}: {
  spec: RidgeRingSpec;
  night: boolean;
}) {
  const palette = useMountainPalette();
  const groupRef = useRef<THREE.Group>(null);

  const colors = useMemo(
    () => ({
      rock: palette.rockColor,
      cliff: palette.cliffColor,
      snow: palette.snowColor,
      hazeTone: palette.skyHorizon,
      fringe: palette.pineColorB,
    }),
    [palette],
  );

  const paints = useMemo(
    () =>
      Array.from({ length: spec.count }, (_, i) => (ctx: CanvasRenderingContext2D, w: number, h: number) =>
        paintRidge(ctx, w, h, spec, colors, i),
      ),
    [spec, colors],
  );

  // One shared texture per plane, mounted by index (usePaintedTexture is a
  // hook, so the ring mounts a small internal component per plane).
  return (
    <group ref={groupRef} name={`mountain-ridges-${spec.radius}`}>
      {paints.map((paint, i) => (
        <RidgePlane key={i} paint={paint} spec={spec} index={i} night={night} />
      ))}
    </group>
  );
}

function RidgePlane({
  paint,
  spec,
  index,
  night,
}: {
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  spec: RidgeRingSpec;
  index: number;
  night: boolean;
}) {
  const texture = usePaintedTexture(paint, 512, 224);
  const ref = useRef<THREE.Mesh>(null);

  const angle = (index / spec.count) * Math.PI * 2 + 0.2;
  const x = Math.cos(angle) * spec.radius;
  const z = Math.sin(angle) * spec.radius;

  // Impostor yaw: face the camera around Y every frame.
  useFrame(({ camera }) => {
    if (ref.current) {
      ref.current.rotation.y = Math.atan2(camera.position.x - x, camera.position.z - z);
    }
  });

  return (
    <mesh
      ref={ref}
      position={[x, spec.baseY + spec.h / 2, z]}
      renderOrder={-5}
    >
      <planeGeometry args={[spec.w, spec.h]} />
      {texture ? (
        <meshStandardMaterial
          map={texture}
          transparent
          alphaTest={0.5}
          roughness={0.95}
          metalness={0}
          emissive={night ? '#24314e' : '#000000'}
          emissiveIntensity={night ? 0.06 : 0}
          fog
        />
      ) : (
        <meshBasicMaterial transparent opacity={0} />
      )}
    </mesh>
  );
}

export default function Ridges({ night }: { night: boolean }) {
  return (
    <group>
      <RidgeRing spec={FAR_RING} night={night} />
      <RidgeRing spec={NEAR_RING} night={night} />
    </group>
  );
}
