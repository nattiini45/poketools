/**
 * Painted ashlar (LOOK-PLAN §2 SEAT S items 3–5): the plaza's one stone
 * program for façades, reveals, plinths, planters and the kerb.
 *
 * `patchAshlar(material)` chains an `onBeforeCompile` hook onto a lit
 * `MeshStandardMaterial` and keys it `paint-ashlar-v1` (the paint sweep
 * chains the painted light on top, `…|paint-v1`). Every ashlar material
 * shares ONE program per geometry kind (plain / instanced): what differs
 * between a façade, a plinth and a kerb stone is uniforms only.
 *
 * In the map stage, from the fragment's WORLD position (derived from
 * `vViewPosition`, so instanced and batched geometry need no vertex patch):
 * - world-space 0.40 m courses above the podium (3.55 m) with staggered head
 *   joints; channelled rustication (0.5 m, no head joints) below it;
 * - joints darkened 22 % with a small bump and a rougher line, faded out by
 *   `fwidth` before they can moiré (390, distance);
 * - ±5 % per-block value jitter, base grime toward the pavement, sill
 *   streaks under the upper windows and a gentle top-light gradient.
 *
 * Everything above is multiplied by `1 − calm`, where calm is 1 inside the
 * world-space calm boxes (`calmBoxesFor`, data-surfaces.ts): behind every
 * data face, at every pose the face is read from (desktop, 768, landed 390,
 * focus and the dolly), the façade is flat — the keep-out law's façade half.
 *
 * Per-material uniforms: `uAshCourse` (podium, course height, block length,
 * course switch — 0 for plinths, planters and the kerb, whose courses are
 * real RoundedBox geometry) and `uAshBay` (the block's window-bay phase for
 * the sill streaks, and a detail scale). Shared uniforms: the calm boxes.
 */

import * as THREE from 'three';
import { PLAZA_DATA_SURFACES } from '@/components/world/evoliga/route/plaza/data-faces';
import { calmBoxesFor, pointInCalmBoxes, themeKeepOut, type CalmBackdrop, type CalmBox } from '@/lib/route-world/data-surfaces';
import {
  CALM_BOX_FEATHER_M,
  CALM_BOX_FN_GLSL,
  CALM_BOX_UNIFORMS,
  CALM_BOX_UNIFORMS_GLSL,
  bindCalmBoxUniforms,
  writeCalmBoxes,
  type CalmBoxUniforms,
} from '@/components/world/route/paint/calm-boxes';
import { HAUSSMANN, plazaFacadeBackdrops, type WindowClear } from '@/lib/route-world/haussmann';
import { PLAZA } from '@/lib/route-world/layout';
import { GRIME_BOXES } from '@/lib/route-world/plaza-ground';

/** Program-cache key of the ashlar patch. Bump on any GLSL change. */
export const ASHLAR_PROGRAM_KEY = 'paint-ashlar-v3';

/**
 * LOOK r6 (L1 lots, L3 weathering, storey bands and reveals — LOOK r5:
 * "wall after wall of the same flat yellow façade"). FAÇADE-ONLY: every term
 * below is gated by `uAshBlock.y` (the weather gain, 0 on plinths, planters
 * and the kerb) or `uAshBay.w` (the lot width, 0 there too), and multiplied
 * by `ashKeep` (flat inside every calm box). Weathering darkens AND cools
 * (`mix(1, WEATHER_TINT, w)`); bands and lots are feathered ≥ 0.15 m.
 *
 * - `lot`: ±`value` per lot (every |uAshBay.w| bays, seams on the pilasters),
 *   `cool` share of lots a step cooler;
 * - `podium`: the rusticated ground storey darker and cooler, the piano
 *   nobile the lightest band (`nobile`), a gentle lift toward the cornice
 *   (`crown`), a light lip on the up-facing string-course / sill / cornice
 *   tops (`lip`);
 * - weathering: drips under every string course and the cornice (`drip`,
 *   `dripLen` m), soot under the cornice (`soot`), base grime up to
 *   `baseM` (`base`), and the sill streaks × `streak`;
 * - `jamb`: the window reveals (faces along the façade axis, and soffits,
 *   inside a window rect) take a cool multiply.
 */
export const ASHLAR_WEATHERING = {
  lot: { value: 0.16, cool: 0.5 },
  podium: [0.82, 0.85, 0.92] as const,
  nobile: 0.05,
  crown: 0.03,
  lip: 0.14,
  drip: 1.3,
  dripLen: [0.5, 1.5] as const,
  soot: 1.0,
  base: 1.0,
  baseM: 2.2,
  streak: 1.8,
  tint: [0.62, 0.68, 0.8] as const,
  jamb: [0.72, 0.78, 0.84] as const,
} as const;

/**
 * LOOK r4 (lead: "ashlar reads as bumpy, noisy stucco — calmer painted
 * blocks with clear joints"): the painted set's fine grain is blended this
 * far toward its own low-frequency mean (a biased fetch of the same map), the
 * joints widen and darken, and each block takes a soft pillow (darker at its
 * arrises) and a stronger per-block value — form from blocks, not noise.
 */
export const ASHLAR_CALM = { grain: 0.6, bias: 3.5, joint: 0.34, jointW: 0.02, jitter: 0.14, pillow: 0.08 } as const;

/** Anchors in three 0.185.1 (pinned; `paint-ashlar.test.ts` fails on drift). */
export const ASHLAR_ANCHORS = {
  common: '#include <common>',
  mapFragment: '#include <map_fragment>',
  roughnessFragment: '#include <roughnessmap_fragment>',
  normalMapsFragment: '#include <normal_fragment_maps>',
} as const;

/** Calm-box feather (m): detail fades back in over this distance outside a box. */
export const ASHLAR_CALM_FEATHER_M = CALM_BOX_FEATHER_M;

// ── Calm boxes and backdrops (the plaza's façade half of the keep-out law) ──

const TERRACE = GRIME_BOXES.find((box) => box.id === 'terrace');

/**
 * The plaza's backdrops: every façade plane (`plazaFacadeBackdrops`) plus the
 * statue terrace front the teams ledger is read against (§1.3 teams: "the
 * terrace front above the ledger is a calm box"). The terrace is the
 * `plaza-ground` grime box, widened for StatueRow's 1.35 m re-seat and
 * thick enough to hold the plinth faces behind the ledger.
 */
export const PLAZA_CALM_BACKDROPS: readonly CalmBackdrop[] = [
  ...plazaFacadeBackdrops(PLAZA.half),
  ...(TERRACE
    ? [
        {
          id: 'teams-terrace',
          axis: 'x' as const,
          at: TERRACE.center[0] - TERRACE.half[0],
          span: [TERRACE.center[1] - TERRACE.half[1] - 1, TERRACE.center[1] + TERRACE.half[1] + 2.4] as const,
          y: [0, 2.2] as const,
          depth: 2.4,
        },
      ]
    : []),
];

let calmCache: CalmBox[] | null = null;

/** The plaza calm boxes (computed once; pure maths over the frozen poses). */
export function plazaCalmBoxes(): CalmBox[] {
  calmCache ??= calmBoxesFor(PLAZA_DATA_SURFACES, PLAZA_CALM_BACKDROPS);
  return calmCache;
}

/**
 * The window-light keep-out for the plaza blocks: a lit pane's world sphere
 * must clear every keep-out wedge (in front of a face) and every calm box
 * (behind it). Static: evaluated once per block plan, never per frame.
 */
export const plazaWindowClear: WindowClear = (center, radius) =>
  themeKeepOut(PLAZA_DATA_SURFACES).sphereClear(center, radius) &&
  !pointInCalmBoxes(plazaCalmBoxes(), center, radius);

// ── Uniforms ────────────────────────────────────────────────────────────────

/** ROLLOUT §2.2 (l): the calm-box half lives in `route/paint/calm-boxes.ts`; the plaza names stay. */
export type AshlarSharedUniforms = CalmBoxUniforms;

/** The one shared calm set every ashlar program binds (by reference). */
export const ASHLAR_SHARED: AshlarSharedUniforms = CALM_BOX_UNIFORMS;

export { writeCalmBoxes };

let plazaCalmInstalled = false;

function ensurePlazaCalm(): void {
  if (plazaCalmInstalled) return;
  plazaCalmInstalled = true;
  writeCalmBoxes(plazaCalmBoxes());
}

export interface AshlarOptions {
  /** 1: procedural coursing; 0: the geometry carries the courses (plinths, planters, kerb). */
  courseOn?: number;
  /** World phase (m) of the block's window-bay centres along the wall, for sill streaks. */
  bayPhase?: number;
  /** Detail scale (1 = façade). */
  detail?: number;
  /**
   * LOOK r6 (L1): signed lot width in bays (0 = no lots — plinths, planters,
   * kerb). The sign is the wall's world direction per block-local +x.
   */
  lotBays?: number;
}

export interface AshlarUniforms {
  /** (podium, course height, block length, course switch). */
  uAshCourse: { value: THREE.Vector4 };
  /** (bay phase, bay width, detail scale, signed lot width in bays — 0 off). */
  uAshBay: { value: THREE.Vector4 };
  /** LOOK r6 (L3): (block top y, weather gain — 0 off, cool amount, façade axis 0 = x / 1 = z). */
  uAshBlock: { value: THREE.Vector4 };
}

/** A block's weathering write (`uAshBlock`). */
export interface AshlarBlockLook {
  top: number;
  weather: number;
  cool: number;
  axis: 0 | 1;
}

// ── GLSL ────────────────────────────────────────────────────────────────────

export const ASHLAR_PARS_GLSL = /* glsl */ `
${CALM_BOX_UNIFORMS_GLSL}uniform vec4 uAshCourse;
uniform vec4 uAshBay;
uniform vec4 uAshBlock;
float ashHash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
// LOOK r6: a smooth 1-D value noise (drip columns — soft, never a stucco grain).
float ashNoise1( float x, float salt ) {
	float i = floor( x );
	float f = fract( x );
	return mix( ashHash( vec2( i, salt ) ), ashHash( vec2( i + 1.0, salt ) ), f * f * ( 3.0 - 2.0 * f ) );
}
${CALM_BOX_FN_GLSL}`;

/**
 * Runs right after the stock `map_fragment`. Declares `ashJoint`,
 * `ashBumpY` for the roughness and normal stages.
 */
export const ASHLAR_MAP_GLSL = /* glsl */ `
	vec3 ashW = ( ( vec4( - vViewPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
	vec3 ashN = abs( normalize( cross( dFdx( ashW ), dFdy( ashW ) ) ) );
	float ashKeep = uAshBay.z * ( 1.0 - ashCalmAt( ashW ) );
	float ashWall = 1.0 - step( 0.7, ashN.y );
	float ashS = ashN.x > ashN.z ? ashW.z : ashW.x;
	float ashAbove = step( uAshCourse.x, ashW.y );
	float ashCH = mix( 0.5, uAshCourse.y, ashAbove );
	float ashCy = ( ashW.y - uAshCourse.x * ashAbove ) / ashCH;
	float ashRow = floor( ashCy );
	float ashFy = fract( ashCy );
	float ashStagger = mod( ashRow, 2.0 ) * 0.5 + ( ashHash( vec2( ashRow, 3.1 ) ) - 0.5 ) * 0.2;
	float ashCx = ashS / uAshCourse.z + ashStagger;
	float ashCol = floor( ashCx );
	float ashFx = fract( ashCx );
	vec2 ashFw = vec2( fwidth( ashS ), fwidth( ashW.y ) );
	float ashDy = min( ashFy, 1.0 - ashFy ) * ashCH;
	float ashDx = min( ashFx, 1.0 - ashFx ) * uAshCourse.z;
	float ashJw = mix( 0.03, ${ASHLAR_CALM.jointW.toFixed(3)}, ashAbove );
	float ashJointH = 1.0 - smoothstep( ashJw, ashJw + ashFw.y * 1.5, ashDy );
	float ashJointV = ashAbove * ( 1.0 - smoothstep( ${ASHLAR_CALM.jointW.toFixed(3)}, ${ASHLAR_CALM.jointW.toFixed(3)} + ashFw.x * 1.5, ashDx ) );
	float ashFade = 1.0 - smoothstep( 0.08, 0.25, max( ashFw.y / ashCH, ashFw.x / uAshCourse.z ) );
	float ashCourse = uAshCourse.w * ashWall * ashFade;
	float ashJoint = max( ashJointH, ashJointV ) * ashCourse * ashKeep;
	float ashBumpY = ashJointH * ashCourse * ashKeep * ( ashFy < 0.5 ? 1.0 : - 1.0 );
	float ashJitter = ( ashHash( vec2( ashCol, ashRow ) + uAshBay.x ) - 0.5 ) * ${ASHLAR_CALM.jitter.toFixed(2)} * ashCourse;
	float ashPillow = ( 1.0 - smoothstep( 0.0, 0.07, min( ashDy, mix( 1.0, ashDx, ashAbove ) ) ) ) * ${ASHLAR_CALM.pillow.toFixed(2)} * ashCourse;
	float ashTop = ( smoothstep( 0.55, 1.0, ashFy ) * 0.035 ) * ashCourse;
	float ashGrime = ( 1.0 - smoothstep( 0.0, 1.4, ashW.y ) ) * 0.16;
	float ashBayU = mod( ashS - uAshBay.x, uAshBay.y ) - 0.5 * uAshBay.y;
	float ashSillBelow = mod( ( uAshCourse.x + 0.11 ) - ashW.y, 3.2 );
	float ashStreakCol = ( 1.0 - smoothstep( 0.3, 0.55, abs( ashBayU ) ) ) * ( 0.4 + 0.6 * ashHash( vec2( floor( ashS * 7.0 ), 11.0 ) ) );
	float ashStreak = ( 1.0 - smoothstep( 0.0, 1.3, ashSillBelow ) ) * ashStreakCol * step( 2.4, ashW.y ) * ashWall * 0.09;
	float ashLift = smoothstep( 0.0, 12.0, ashW.y ) * 0.04;
	#ifdef USE_MAP
		// Calm the painted grain toward its own mean (never inside a calm box's
		// flat read: the blend is the same everywhere, so the calm stays flat).
		diffuseColor.rgb = mix( diffuseColor.rgb, diffuse * texture2D( map, vMapUv, ${ASHLAR_CALM.bias.toFixed(1)} ).rgb, ${ASHLAR_CALM.grain.toFixed(2)} * uAshBay.z );
	#endif
	float ashDetail = - ashJoint * ${ASHLAR_CALM.joint.toFixed(2)} + ( ashJitter + ashTop - ashStreak - ashPillow ) * ashKeep - ashGrime * ( 0.5 + 0.5 * ashKeep ) + ashLift;
	diffuseColor.rgb *= max( 0.0, 1.0 + ashDetail );
	// ── LOOK r6 (L1 lots, L3 weathering / storey bands / reveals): façade-only ──
	float ashFac = step( 1e-3, uAshBlock.y );
	float ashAlong = mix( ashW.x, ashW.z, uAshBlock.w );
	float ashAw = fwidth( ashAlong );
	float ashY = ashW.y;
	float ashTopY = uAshBlock.x;
	// Lots every |w| bays, seams on the pilasters, feathered over 0.15 m.
	float ashLotOn = step( 0.5, abs( uAshBay.w ) );
	float ashLotW = max( abs( uAshBay.w ), 1.0 ) * uAshBay.y;
	float ashLotT = ( ashAlong - uAshBay.x + sign( uAshBay.w ) * 0.42 * uAshBay.y ) / ashLotW;
	float ashLotI = floor( ashLotT );
	float ashLotF = smoothstep( 0.0, 0.15 / ashLotW, fract( ashLotT ) );
	vec2 ashLotSalt = vec2( 5.7, 9.1 ) + uAshBay.x * 0.37;
	vec2 ashLotA = vec2( ashHash( vec2( ashLotI - 1.0, ashLotSalt.x ) ), ashHash( vec2( ashLotI - 1.0, ashLotSalt.y ) ) );
	vec2 ashLotB = vec2( ashHash( vec2( ashLotI, ashLotSalt.x ) ), ashHash( vec2( ashLotI, ashLotSalt.y ) ) );
	float ashLotV = ( mix( ashLotA.x, ashLotB.x, ashLotF ) - 0.5 ) * ${ASHLAR_WEATHERING.lot.value.toFixed(3)} * ashLotOn;
	float ashLotC = mix( step( ${(1 - ASHLAR_WEATHERING.lot.cool).toFixed(3)}, ashLotA.y ), step( ${(1 - ASHLAR_WEATHERING.lot.cool).toFixed(3)}, ashLotB.y ), ashLotF ) * ashLotOn;
	// Storey bands: a darker, cooler podium; the piano nobile lightest; a lift toward the crown.
	float ashPod = ( 1.0 - smoothstep( uAshCourse.x - 0.15, uAshCourse.x + 0.15, ashY ) ) * ashFac;
	float ashNob = smoothstep( uAshCourse.x - 0.15, uAshCourse.x + 0.15, ashY ) * ( 1.0 - smoothstep( ashTopY - 0.1, ashTopY + 0.2, ashY ) );
	float ashCrown = smoothstep( uAshCourse.x + 0.4, ashTopY, ashY ) * ( 1.0 - smoothstep( ashTopY + 0.3, ashTopY + 0.6, ashY ) );
	float ashUpN = dot( normalize( vNormal ), normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) );
	float ashLip = smoothstep( 0.6, 0.85, ashUpN ) * step( 0.5, ashY );
	vec3 ashBand = mix( vec3( 1.0 ), vec3( ${ASHLAR_WEATHERING.podium.map((v) => v.toFixed(3)).join(', ')} ), ashPod )
		* ( 1.0 + ( ${ASHLAR_WEATHERING.nobile.toFixed(3)} * ashNob + ${ASHLAR_WEATHERING.crown.toFixed(3)} * ashCrown + ${ASHLAR_WEATHERING.lip.toFixed(3)} * ashLip ) * ashFac + ashLotV );
	ashBand *= mix( vec3( 1.0 ), vec3( 0.97, 0.985, 1.02 ), ashLotC * uAshBlock.z );
	// Weathering (darker AND cooler): drips under the string courses and the
	// cornice, soot under the cornice, base grime, and the sill streaks × ${ASHLAR_WEATHERING.streak}.
	float ashColN = mix( ashNoise1( ashAlong * 3.2, 17.0 ), 0.5, smoothstep( 0.04, 0.15, ashAw ) );
	float ashColN2 = mix( ashNoise1( ashAlong * 1.3 + 4.0, 23.0 ), 0.5, smoothstep( 0.1, 0.35, ashAw ) );
	float ashBelow = mod( uAshCourse.x - ashY, ${HAUSSMANN.floorHeight.toFixed(2)} );
	float ashDripOn = step( uAshCourse.x - 1.6, ashY ) * step( ashY, ashTopY + 0.02 ) * ashWall;
	float ashDrip = ( 1.0 - smoothstep( 0.0, mix( ${ASHLAR_WEATHERING.dripLen[0].toFixed(2)}, ${ASHLAR_WEATHERING.dripLen[1].toFixed(2)}, ashColN2 ), ashBelow ) ) * ( 0.3 + 0.7 * smoothstep( 0.35, 0.8, ashColN ) ) * ashDripOn;
	float ashSoot = smoothstep( ashTopY - 1.4, ashTopY - 0.05, ashY ) * step( ashY, ashTopY + 0.02 ) * ( 0.5 + 0.5 * ashColN ) * ashWall;
	float ashBase = 1.0 - smoothstep( 0.0, ${ASHLAR_WEATHERING.baseM.toFixed(2)}, ashY );
	ashBase *= ashBase * ( 0.7 + 0.3 * ashColN2 );
	float ashWeather = clamp( ( ashDrip * ${ASHLAR_WEATHERING.drip.toFixed(2)} + ashSoot * ${ASHLAR_WEATHERING.soot.toFixed(2)} + ashBase * ${ASHLAR_WEATHERING.base.toFixed(2)} + ashStreak * ${((ASHLAR_WEATHERING.streak - 1) / 0.16).toFixed(3)} ) * uAshBlock.y, 0.0, 1.0 );
	// Window reveals: faces along the façade axis (jambs) and soffits inside a window rect.
	float ashAlongN = mix( ashN.x, ashN.z, uAshBlock.w );
	float ashBayA = mod( ashAlong - uAshBay.x + 0.5 * uAshBay.y, uAshBay.y ) - 0.5 * uAshBay.y;
	float ashInWin = ( 1.0 - smoothstep( 0.62, 0.8, abs( ashBayA ) ) ) * max(
		smoothstep( 0.4, 0.55, ashY ) * ( 1.0 - smoothstep( 2.75, 2.9, ashY ) ),
		smoothstep( uAshCourse.x, uAshCourse.x + 0.15, ashY ) * ( 1.0 - smoothstep( uAshCourse.x + 1.75, uAshCourse.x + 1.9, ashY ) ) );
	float ashJamb = max( smoothstep( 0.55, 0.8, ashAlongN ), smoothstep( 0.6, 0.85, - ashUpN ) ) * ashInWin * ashFac;
	vec3 ashR6 = mix( vec3( 1.0 ), ashBand, ashKeep )
		* mix( vec3( 1.0 ), vec3( ${ASHLAR_WEATHERING.tint.map((v) => v.toFixed(3)).join(', ')} ), ashWeather * ashKeep )
		* mix( vec3( 1.0 ), vec3( ${ASHLAR_WEATHERING.jamb.map((v) => v.toFixed(3)).join(', ')} ), ashJamb * ashKeep );
	diffuseColor.rgb *= ashR6;
`;

/** Runs right after the stock `roughnessmap_fragment`. */
export const ASHLAR_ROUGHNESS_GLSL = /* glsl */ `
	roughnessFactor = min( 1.0, roughnessFactor + ashJoint * 0.12 );
`;

/** Runs right after the stock `normal_fragment_maps`: a small joint bump in the world vertical. */
export const ASHLAR_NORMAL_GLSL = /* glsl */ `
	normal = normalize( normal + ( viewMatrix * vec4( 0.0, ashBumpY * 0.35, 0.0, 0.0 ) ).xyz );
`;

function requireAnchor(source: string, anchor: string): void {
  if (!source.includes(anchor)) {
    throw new Error(`[ashlar] three shader anchor missing: ${anchor} (three is pinned at 0.185.1)`);
  }
}

/** Patch a Standard program's fragment source and bind the shared + per-material uniforms. */
export function patchAshlarShader(
  shader: THREE.WebGLProgramParametersWithUniforms,
  uniforms: AshlarUniforms,
  shared: AshlarSharedUniforms = ASHLAR_SHARED,
): void {
  const src = shader.fragmentShader;
  for (const anchor of Object.values(ASHLAR_ANCHORS)) requireAnchor(src, anchor);
  shader.fragmentShader = src
    .replace(ASHLAR_ANCHORS.common, `${ASHLAR_ANCHORS.common}\n${ASHLAR_PARS_GLSL}`)
    .replace(ASHLAR_ANCHORS.mapFragment, `${ASHLAR_ANCHORS.mapFragment}\n${ASHLAR_MAP_GLSL}`)
    .replace(ASHLAR_ANCHORS.roughnessFragment, `${ASHLAR_ANCHORS.roughnessFragment}\n${ASHLAR_ROUGHNESS_GLSL}`)
    .replace(ASHLAR_ANCHORS.normalMapsFragment, `${ASHLAR_ANCHORS.normalMapsFragment}\n${ASHLAR_NORMAL_GLSL}`);
  bindCalmBoxUniforms(shader.uniforms, shared);
  shader.uniforms.uAshCourse = uniforms.uAshCourse;
  shader.uniforms.uAshBay = uniforms.uAshBay;
  shader.uniforms.uAshBlock = uniforms.uAshBlock;
}

const ashlarRecords = new WeakMap<THREE.Material, AshlarUniforms>();

/** The ashlar uniforms of a patched material (null when it was never patched). */
export function ashlarUniforms(material: THREE.Material): AshlarUniforms | null {
  return ashlarRecords.get(material) ?? null;
}

/**
 * D42 N4: the StaticBatcher merge key of an ashlar material — its
 * per-material uniform VALUES (course, bay, block), rewritten on every
 * uniform write here (creation, a re-patch, `writeAshlarBlock`; never per
 * frame). Two ashlar materials merge only while these agree; a merged family
 * draws with ONE member's uniforms.
 */
export function ashlarMergeKey(uniforms: AshlarUniforms): string {
  const c = uniforms.uAshCourse.value;
  const b = uniforms.uAshBay.value;
  const k = uniforms.uAshBlock.value;
  return `ashlar:${c.x},${c.y},${c.z},${c.w}|${b.x},${b.y},${b.z},${b.w}|${k.x},${k.y},${k.z},${k.w}`;
}

/**
 * Patch one lit material with the painted ashlar. Must run before the
 * material's first compile (at creation). Idempotent. Installs the plaza
 * calm boxes into the shared uniforms on first use.
 */
export function patchAshlar(material: THREE.MeshStandardMaterial, options: AshlarOptions = {}): AshlarUniforms {
  const existing = ashlarRecords.get(material);
  const uniforms: AshlarUniforms = existing ?? {
    uAshCourse: { value: new THREE.Vector4() },
    uAshBay: { value: new THREE.Vector4() },
    // Weather gain 0: furniture (plinths, planters, kerb) never weathers.
    uAshBlock: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  uniforms.uAshCourse.value.set(HAUSSMANN.podiumHeight, 0.4, 0.92, options.courseOn ?? 1);
  uniforms.uAshBay.value.set(options.bayPhase ?? 0, HAUSSMANN.bayWidth, options.detail ?? 1, options.lotBays ?? 0);
  material.userData.mergeKey = ashlarMergeKey(uniforms);
  if (existing) return uniforms;
  ensurePlazaCalm();
  const prevHook = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prevHook.call(material, shader, renderer);
    patchAshlarShader(shader, uniforms);
  };
  material.customProgramCacheKey = () => ASHLAR_PROGRAM_KEY;
  material.userData.ashlar = true;
  ashlarRecords.set(material, uniforms);
  return uniforms;
}

/**
 * LOOK r6 (L3): a façade block's weathering frame — a uniform write on an
 * already-patched material (never a program change; a no-op on an
 * unpatched one). `weather` 0 turns every façade-only term off.
 */
export function writeAshlarBlock(material: THREE.Material, look: AshlarBlockLook): void {
  const uniforms = ashlarRecords.get(material);
  if (!uniforms) return;
  uniforms.uAshBlock.value.set(look.top, Math.max(0, look.weather), Math.max(0, look.cool), look.axis);
  material.userData.mergeKey = ashlarMergeKey(uniforms);
}

// ── Placeholder maps (same configuration as the painted set) ────────────────

/** One PBR set as the ashlar consumes it (`arm`: R = AO, G = roughness). */
export interface AshlarMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  arm: THREE.Texture;
}

function texel(r: number, g: number, b: number, colorSpace: THREE.ColorSpace): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  tex.colorSpace = colorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 1×1 stand-ins with the painted set's configuration (sRGB colour, linear
 * normal and ARM, repeat wrapping): a material built on them has exactly the
 * defines — and so the program — of one built on the real set, and swapping
 * the real textures in later links nothing. Mean `plaza-ashlar` albedo, flat
 * normal, AO 1 / roughness ≈ 0.9.
 */
export function ashlarPlaceholderMaps(): AshlarMaps {
  return {
    map: texel(151, 143, 127, THREE.SRGBColorSpace),
    normalMap: texel(128, 128, 255, THREE.NoColorSpace),
    arm: texel(255, 230, 0, THREE.NoColorSpace),
  };
}

export function disposeAshlarMaps(maps: AshlarMaps): void {
  maps.map.dispose();
  maps.normalMap.dispose();
  maps.arm.dispose();
}

// ── Shared stone set for furniture outside the perimeter (plinths) ──────────

type Listener = () => void;
let publishedMaps: AshlarMaps | null = null;
const listeners = new Set<Listener>();

/**
 * The perimeter publishes its loaded stone set here so furniture mounted
 * elsewhere (StatueRow's plinths and terrace) wears the same painted stone
 * without loading it twice. Consumers build on placeholders (same program)
 * and swap the textures in on publish.
 */
export function publishAshlarMaps(maps: AshlarMaps | null): void {
  if (publishedMaps === maps) return;
  publishedMaps = maps;
  for (const listener of listeners) listener();
}

export function publishedAshlarMaps(): AshlarMaps | null {
  return publishedMaps;
}

export function subscribeAshlarMaps(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Point a Standard material's colour / normal / ARM slots at a set (no program change). */
export function assignAshlarMaps(material: THREE.MeshStandardMaterial, maps: AshlarMaps): void {
  material.map = maps.map;
  material.normalMap = maps.normalMap;
  material.roughnessMap = maps.arm;
  material.aoMap = maps.arm;
}

/** Test seam: forget the calm install and the published set. */
export function resetAshlarForTest(): void {
  plazaCalmInstalled = false;
  calmCache = null;
  publishedMaps = null;
  listeners.clear();
  writeCalmBoxes([]);
}
