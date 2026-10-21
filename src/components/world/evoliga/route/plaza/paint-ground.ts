/**
 * Painted ground (LOOK-PLAN §2 SEAT S item 1): the plaza floor's material.
 *
 * ONE `MeshStandardMaterial` for the life of the plaza, keyed
 * `paint-ground-v1` (the paint sweep chains the painted light on top). It is
 * created on 1×1 placeholder maps with the painted set's exact configuration
 * — sRGB diffuse, tangent-space normal, the story mask — so the resolved set
 * is swapped in by assignment and links nothing (the cache-key test pins it).
 * The 2048² procedural cobble generator never runs any more.
 *
 * Fragment stages (anchors pinned below, `paint-ground.test.ts`):
 * - `map_fragment`: IQ technique-3 anti-tiling (two offset `textureGrad`
 *   fetches blended by the mask's macro index; ONE fetch beyond 28 m), then
 *   the story mask — lanes lift (capped), grime darkens, macro value drift —
 *   the hue-only tint lerp (0.35, unit-luminance tint; value comes from the
 *   palette's pigment luminance, never from a chromatic multiply), the Poké
 *   Ball compass medallion (analytic SDF, fwidth AA, ΔL ≤ 15) and the wet
 *   darkening in puddles (albedo × 0.55).
 * - `roughnessmap_fragment`: roughness derived from luminance and wear, wet
 *   at night, 0.06 in puddles.
 * - `normal_fragment_maps`: the same two anti-tiling fetches for the normal
 *   map (same offsets and blend as the albedo), flattened in puddles.
 * - `emissivemap_fragment`: STATIC emitter reflections — a uniform-bounded
 *   loop over `plaza-emitters.ts`, each emitter's mirror image streaked along
 *   the view on the ground plane, only where mask B (puddles; 0 in every
 *   wedge and the footer dry band) is wet, clamped to `uPgReflCap`. No uTime.
 *
 * World position is derived in the fragment from `vViewPosition`, so the
 * patch needs no vertex change; the mask UV is `worldToMaskUv`.
 */

import * as THREE from 'three';
import { MEDALLION, PLAZA_GROUND_PLANE, LANE_ANCHORS } from '@/lib/route-world/plaza-ground';
import { PLAZA_EMITTER_SLOTS, PLAZA_WET_LANES, WET_LANE } from '@/lib/route-world/plaza-emitters';

/** LOOK r6 (L6.2): wet-lane slots in the ground shader (`PLAZA_WET_LANES`). */
export const WET_LANE_SLOTS = 4;

/** Program-cache key of the painted ground. Bump on any GLSL change. */
export const PAINT_GROUND_KEY = 'paint-ground-v5';

/**
 * LOOK r6 (L6.2, night: "no gate or lamp streaks in the puddles"): the
 * emitter reflections become long, narrow, ASYMMETRIC vertical streaks — a
 * streak runs `toward` × (base + perM · distance) metres toward the eye and
 * only `away` of that beyond its source's mirror point, is `width` metres
 * plus the source's own half-width wide, and is broken up by the sett normal
 * (a static ripple, `ripple` metres of lateral wobble — no time term).
 */
export const STREAK = { toward: 1.0, away: 0.25, base: 0.4, perM: 0.12, width: 0.025, ripple: 0.18 } as const;

/** Anchors in three 0.185.1 the patch rewrites (the anchors test pins every one). */
export const GROUND_ANCHORS = {
  common: '#include <common>',
  mapFragment: '#include <map_fragment>',
  mapSample: 'texture2D( map, vMapUv )',
  normalMapsFragment: '#include <normal_fragment_maps>',
  normalSample: 'texture2D( normalMap, vNormalMapUv )',
  roughnessFragment: '#include <roughnessmap_fragment>',
  emissiveFragment: '#include <emissivemap_fragment>',
} as const;

/** Beyond this distance (m) the anti-tiling falls back to one fetch. */
export const NO_TILE_FAR_M = 28;
/**
 * Hue-only tint strength (LOOK-PLAN §1.2). LOOK r4 (lead: "cobbles too
 * blue — the sett base albedo stays warm grey-ochre; lilac/blue belongs only
 * in the SHADOW term"): the warm pigment hue carries more of the albedo.
 */
export const GROUND_TINT_MIX = 0.6;
/**
 * Lane lift ceiling: worn lanes brighten at most this share. LOOK r4 (the
 * ground story must read at 1440 and in the dolly): the desire lines are
 * also polished — the sett grain smoothed toward its local mean
 * (`LANE_POLISH`) and a glossier roughness (`LANE_GLOSS`), so the key
 * draws a sheen along them.
 */
export const LANE_LIFT_MAX = 0.4;
export const LANE_POLISH = 0.7;
export const LANE_GLOSS = 0.34;
/**
 * Macro value/hue drift of the setts at 4–8 m (the mask's alpha): ±`MACRO_VALUE`
 * in value and a warm-ochre ↔ cool-grey patchwork from a second read of the
 * same field — breaks the scan's repetition. LOOK r5 (LOOK: "at 1440 and in
 * the dolly it is still a uniform cobble scan"): ±0.3.
 */
export const MACRO_VALUE = 0.3;
/**
 * Sett patchwork at 1–2 m (a third read of the mask's macro field at 5.3×):
 * repair patches of warmer, redder setts and cooler grey ones, ±`PATCH.value`.
 */
export const PATCH = { sizeM: 1.7, value: 0.04, warm: [1.04, 0.99, 0.93], cool: [0.96, 0.99, 1.03] } as const;
/** Size (m) of the warm-ochre / cool-grey hue drift (a procedural field — the mask clamps outside its plane). */
export const MACRO_HUE_M = 6.5;
/**
 * LOOK r5 (LOOK: "the dolly shows a uniform sett scan"): a procedural value
 * field at ~5 m, ±`value`, independent of the baked mask (whose macro
 * channel is nearly flat across the north forecourt), so paler and darker
 * sett fields read at 1440 camera distances.
 */
export const MACRO_FIELD = { sizeM: 4.8, value: 0.16 } as const;

/** Grime: overall darkening, and extra darkening + moss hue in the joints near walls and plinths. */
export const GRIME = { value: 0.3, joint: 0.55, moss: '#6f7442' } as const;
/**
 * LOOK r5 (LOOK: "darker grime at the kerbs and building bases"): a
 * procedural band of grime along the perimeter — from `from` metres off
 * the centre (max |x|, |z|) to the kerb at `to` — darkening by `value`.
 */
export const EDGE_GRIME = { from: 13.8, to: 17.4, value: 0.3 } as const;
/**
 * The medallion is drawn this much larger than `MEDALLION.radius` (the
 * compass rose must read from the dolly and the 390 rules pose); inside it
 * the setts are polished smooth (an inlay, not painted setts) and the lanes
 * stop at its rim.
 */
export const MEDALLION_SCALE = 1.25;
export const MEDALLION_POLISH = 0.7;
/**
 * Reflection ceiling in linear radiance. LOOK-PLAN §2 S.1: reflected luma ≤ ⅓
 * of a face's P50. The boards and plaques render their night faces around
 * 0.3–0.45 linear at P50 (self-lit, unlit ShaderMaterials), so 0.1 keeps a
 * streak at or under a third of the dimmest face; captures tune it down, never up.
 */
export const REFLECTION_CAP = 0.18;
/** LOOK r5: share of the practicals' streaks the wet setts carry outside the puddles. */
export const WET_SETT_REFLECTION = 0.4;

/**
 * Sett form (LOOK r2 art direction): the ground albedo is re-spread by a
 * gamma about the sett midtone before tinting — the Kuwahara bake reads
 * milky at 390 without it. Gain keeps a 0.4 midtone where it was.
 */
export const SETT_CONTRAST_GAMMA = 1.3;
export const SETT_CONTRAST_GAIN = Math.pow(0.4, 1 - SETT_CONTRAST_GAMMA);

// ── Medallion palette (multipliers on the local sett albedo; ΔL ≤ 15) ───────

/** Darkest and lightest value factors the medallion applies (ΔL well under 15 at sett albedo). */
/**
 * LOOK r5 (lead: "at roster 390 it reads as an ambiguous red/blue blob"):
 * the inlay reads by its dark outline — ring, band and button at the ΔL
 * limit — over two halves that differ only a little (light 1.18, a muted
 * terracotta north at mix 0.3), so a partial view is a stone line drawing,
 * never a painted blob.
 */
export const MEDALLION_VALUES = { dark: 0.58, light: 1.18, tick: 0.6, north: 0.94 } as const;
/** The warm north cap hue (unit luminance at use; hue mix `MEDALLION_NORTH_MIX` — a terracotta stone, not a sign). */
export const MEDALLION_NORTH_HUE = '#c07a58';
export const MEDALLION_NORTH_MIX = 0.3;

/** CIE L* of a relative luminance (0..1). */
export function lightnessOf(y: number): number {
  const t = y > 216 / 24389 ? Math.cbrt(y) : (y * 24389) / 27 / 116 + 16 / 116;
  return 116 * t - 16;
}

// ── GLSL ────────────────────────────────────────────────────────────────────

export const GROUND_PARS_GLSL = /* glsl */ `
uniform sampler2D uPgMask;
uniform vec2 uPgPlane;
uniform vec3 uPgTint;
uniform float uPgTintMix;
uniform float uPgValue;
uniform float uPgWet;
uniform float uPgLaneLift;
uniform vec4 uPgMed;
uniform vec4 uPgMedA;
uniform vec3 uPgMedHue;
uniform vec4 uPgMedV;
uniform vec2 uPgTicks[ 5 ];
uniform vec4 uPgEmitA[ ${PLAZA_EMITTER_SLOTS} ];
uniform vec4 uPgEmitB[ ${PLAZA_EMITTER_SLOTS} ];
uniform float uPgEmitCount;
uniform float uPgReflCap;
uniform vec3 uPgMoss;
uniform vec4 uPgLanes[ ${WET_LANE_SLOTS} ];
uniform float uPgLaneCount;
// LOOK r6 (L6.2): standing water along the solved wet lanes (0..1).
float pgLaneWet( vec2 p ) {
	float wet = 0.0;
	for ( int i = 0; i < ${WET_LANE_SLOTS}; i ++ ) {
		if ( float( i ) >= uPgLaneCount ) break;
		vec4 l = uPgLanes[ i ];
		vec2 ab = l.zw - l.xy;
		float h = clamp( dot( p - l.xy, ab ) / max( dot( ab, ab ), 1e-4 ), 0.0, 1.0 );
		float d = length( p - ( l.xy + ab * h ) );
		wet = max( wet, 1.0 - smoothstep( ${(WET_LANE.halfWidth * 0.55).toFixed(3)}, ${WET_LANE.halfWidth.toFixed(3)}, d ) );
	}
	return wet;
}
float pgLuma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
float pgHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float pgNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( pgHash( i ), pgHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( pgHash( i + vec2( 0.0, 1.0 ) ), pgHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
vec3 pgMedallion( vec3 col, vec2 p ) {
	float r = length( p );
	float aa = fwidth( r ) * uPgMed.w + 1e-4;
	float R = uPgMed.z;
	float inside = 1.0 - smoothstep( R - aa, R + aa, r );
	float north = smoothstep( - aa, aa, - p.y );
	float ring = inside * smoothstep( R - uPgMedA.x - aa, R - uPgMedA.x + aa, r );
	float band = inside * ( 1.0 - smoothstep( uPgMedA.y - aa, uPgMedA.y + aa, abs( p.y ) ) );
	float bOuter = 1.0 - smoothstep( uPgMedA.z - aa, uPgMedA.z + aa, r );
	float bInner = 1.0 - smoothstep( uPgMedA.w - aa, uPgMedA.w + aa, r );
	vec3 m = col;
	m = mix( m, col * mix( vec3( 1.0 ), uPgMedHue, ${MEDALLION_NORTH_MIX.toFixed(2)} ) * uPgMedV.w, inside * north );
	m = mix( m, col * uPgMedV.y, inside * ( 1.0 - north ) );
	m = mix( m, col * uPgMedV.x, max( ring, max( band, bOuter ) ) );
	m = mix( m, col * uPgMedV.y, bInner );
	float tick = 0.0;
	for ( int i = 0; i < 5; i ++ ) {
		vec2 d = uPgTicks[ i ];
		float along = dot( p, d ) - ( R + 0.12 );
		float lat = abs( p.x * d.y - p.y * d.x );
		float aat = fwidth( along ) * uPgMed.w + 1e-4;
		float t = ( 1.0 - smoothstep( 0.5 * 0.12 - aat, 0.5 * 0.12 + aat, lat ) )
			* smoothstep( - aat, aat, along ) * ( 1.0 - smoothstep( 0.55 - aat, 0.55 + aat, along ) );
		tick = max( tick, t );
	}
	return mix( m, col * uPgMedV.z, tick );
}
vec3 pgReflect( vec3 P, float wetPuddle, float pool, vec2 ripple ) {
	vec3 acc = vec3( 0.0 );
	vec3 C = cameraPosition;
	vec3 V = normalize( C - P );
	float fres = 0.02 + 0.98 * pow( 1.0 - saturate( V.y ), 5.0 );
	for ( int i = 0; i < ${PLAZA_EMITTER_SLOTS}; i ++ ) {
		if ( float( i ) >= uPgEmitCount ) break;
		vec4 a = uPgEmitA[ i ];
		vec4 b = uPgEmitB[ i ];
		float t0 = C.y / max( C.y + a.y, 1e-3 );
		float t1 = C.y / max( C.y + b.w, 1e-3 );
		vec2 r0 = C.xz + ( a.xz - C.xz ) * t0;
		vec2 r1 = C.xz + ( a.xz - C.xz ) * t1;
		vec2 axis = r0 - C.xz;
		float al = length( axis );
		axis /= max( al, 1e-3 );
		vec2 ab = r1 - r0;
		float h = clamp( dot( P.xz - r0, ab ) / max( dot( ab, ab ), 1e-4 ), 0.0, 1.0 );
		vec2 q = P.xz - ( r0 + ab * h );
		float qa = dot( q, axis );
		float ql = q.x * axis.y - q.y * axis.x + ripple.x * ${STREAK.ripple.toFixed(3)};
		// LOOK r6 (L6.2): a narrow glint at the mirror point, long toward the eye
		// (qa < 0) and short beyond — on every wet sett …
		float w = a.w * t0 + ${STREAK.width.toFixed(3)};
		float len = mix( ${STREAK.away.toFixed(2)}, ${STREAK.toward.toFixed(2)}, step( qa, 0.0 ) ) * ( ${STREAK.base.toFixed(2)} + ${STREAK.perM.toFixed(2)} * al );
		float glint = exp( - ( ql * ql ) / ( w * w ) ) * exp( - ( qa * qa ) / ( len * len ) ) * wetPuddle;
		// … and, on standing water only (puddles, wet lanes), the long rough-water
		// streak from the mirror point back to the source's base: the vertical
		// gold streak a low eye sees under a lamp on a rainy night.
		float farLen = max( length( a.xz - r0 ), 0.5 );
		float wFar = w * mix( 1.0, 2.4, saturate( qa / farLen ) ) + 0.04;
		float streakFar = step( 0.0, qa ) * exp( - ( ql * ql ) / ( wFar * wFar ) ) * exp( - 1.2 * ( qa / farLen ) * ( qa / farLen ) ) * pool;
		acc += b.rgb * ( glint + streakFar ) * ( 1.0 + ripple.y );
	}
	vec3 refl = acc * fres;
	float l = pgLuma( refl );
	return refl * min( 1.0, uPgReflCap / max( l, 1e-5 ) );
}
`;

/** The stock map stage with the anti-tiled fetch, followed by the story mask. */
export function groundMapGlsl(mapChunk: string = THREE.ShaderChunk.map_fragment): string {
  if (!mapChunk.includes(GROUND_ANCHORS.mapSample)) {
    throw new Error(`[paint-ground] anchor missing: ${GROUND_ANCHORS.mapSample}`);
  }
  return /* glsl */ `
	vec3 pgW = ( ( vec4( - vViewPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
	vec2 pgMaskUv = vec2( ( pgW.x + uPgPlane.x ) / uPgPlane.y, ( uPgPlane.x - pgW.z ) / uPgPlane.y );
	vec4 pgMask = texture2D( uPgMask, pgMaskUv );
	float pgFar = step( ${NO_TILE_FAR_M.toFixed(1)}, length( pgW - cameraPosition ) );
	float pgIndex = pgMask.a * 8.0;
	float pgI = floor( pgIndex );
	vec2 pgOffA = sin( vec2( 3.0, 7.0 ) * pgI );
	vec2 pgOffB = sin( vec2( 3.0, 7.0 ) * ( pgI + 1.0 ) );
	float pgBlend = 0.0;
	#ifdef USE_MAP
		vec2 pgDx = dFdx( vMapUv );
		vec2 pgDy = dFdy( vMapUv );
		vec4 pgColA = textureGrad( map, vMapUv + pgOffA * ( 1.0 - pgFar ), pgDx, pgDy );
		// The sett field's local mean (a wide-footprint fetch): polish and joint detection.
		vec3 pgMean = textureGrad( map, vMapUv + pgOffA * ( 1.0 - pgFar ), pgDx * 9.0, pgDy * 9.0 ).rgb;
		vec4 pgColB = pgColA;
		if ( pgFar < 0.5 ) {
			pgColB = textureGrad( map, vMapUv + pgOffB, pgDx, pgDy );
			pgBlend = smoothstep( 0.2, 0.8, fract( pgIndex ) - 0.1 * dot( pgColA.rgb - pgColB.rgb, vec3( 1.0 ) ) );
		}
		${mapChunk.replace(GROUND_ANCHORS.mapSample, 'mix( pgColA, pgColB, pgBlend )')}
	#endif
	#ifndef USE_MAP
		vec3 pgMean = diffuseColor.rgb;
	#endif
	vec2 pgMedP = pgW.xz - uPgMed.xy;
	float pgInlay = 1.0 - smoothstep( uPgMed.z - 0.05, uPgMed.z + 0.05, length( pgMedP ) );
	float pgLane = pgMask.r * ( 1.0 - pgInlay );
	float pgGrime = pgMask.g;
	float pgPuddle = max( pgMask.b, pgLaneWet( pgW.xz ) * step( 1e-3, uPgWet ) );
	// Joints: where the sett is darker than its local mean (grout, cracks).
	float pgJoint = clamp( ( pgLuma( pgMean ) - pgLuma( diffuseColor.rgb ) ) * 5.0, 0.0, 1.0 );
	// LOOK r4: polished desire lines and the smooth medallion inlay.
	diffuseColor.rgb = mix( diffuseColor.rgb, pgMean * 1.04, max( pgLane * ${LANE_POLISH.toFixed(2)}, pgInlay * ${MEDALLION_POLISH.toFixed(2)} ) );
	// LOOK r2: sett form — the painterly bake flattens the grout, so the value
	// is re-spread (a gamma about the sett midtone: grout darker, tops kept).
	diffuseColor.rgb = pow( max( diffuseColor.rgb, vec3( 0.0 ) ), vec3( ${SETT_CONTRAST_GAMMA.toFixed(2)} ) ) * ${SETT_CONTRAST_GAIN.toFixed(3)};
	diffuseColor.rgb *= uPgValue * mix( vec3( 1.0 ), uPgTint, uPgTintMix );
	// LOOK r4: macro patchwork at 4–8 m — value from the mask's macro field,
	// warm-ochre / cool-grey hue from a second, offset read of the same field.
	float pgMacro2 = pgNoise( pgW.xz / ${MACRO_HUE_M.toFixed(2)} + vec2( 3.1, 7.7 ) );
	diffuseColor.rgb *= 1.0 + ${MACRO_VALUE.toFixed(2)} * ( 2.0 * pgMask.a - 1.0 );
	diffuseColor.rgb *= mix( vec3( 0.95, 0.98, 1.04 ), vec3( 1.05, 1.0, 0.9 ), smoothstep( 0.3, 0.7, pgMacro2 ) );
	float pgField = pgNoise( pgW.xz / ${MACRO_FIELD.sizeM.toFixed(2)} + vec2( 17.9, 5.3 ) ) * 0.65 + pgNoise( pgW.xz / ${(MACRO_FIELD.sizeM * 0.45).toFixed(2)} + vec2( 2.2, 13.1 ) ) * 0.35;
	diffuseColor.rgb *= 1.0 + ${MACRO_FIELD.value.toFixed(2)} * ( 2.0 * smoothstep( 0.2, 0.8, pgField ) - 1.0 ) * ( 1.0 - pgInlay );
	float pgPatch = pgNoise( pgW.xz / ${PATCH.sizeM.toFixed(2)} + vec2( 11.3, 2.9 ) );
	float pgWarmP = smoothstep( 0.62, 0.78, pgPatch );
	float pgCoolP = 1.0 - smoothstep( 0.22, 0.38, pgPatch );
	diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( ${PATCH.warm.map((v) => v.toFixed(2)).join(', ')} ) * ( 1.0 + ${PATCH.value.toFixed(2)} ), pgWarmP * ( 1.0 - pgInlay ) );
	diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( ${PATCH.cool.map((v) => v.toFixed(2)).join(', ')} ) * ( 1.0 - ${PATCH.value.toFixed(2)} ), pgCoolP * ( 1.0 - pgInlay ) );
	diffuseColor.rgb *= 1.0 - ${GRIME.value.toFixed(2)} * pgGrime;
	// LOOK r5: grime gathers along the kerbs and the building bases.
	float pgEdge = smoothstep( ${EDGE_GRIME.from.toFixed(2)}, ${EDGE_GRIME.to.toFixed(2)}, max( abs( pgW.x ), abs( pgW.z ) ) );
	diffuseColor.rgb *= 1.0 - ${EDGE_GRIME.value.toFixed(2)} * pgEdge * ( 0.6 + 0.4 * pgJoint );
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * uPgMoss * ( 1.0 - ${GRIME.joint.toFixed(2)} ), pgGrime * pgJoint );
	diffuseColor.rgb *= 1.0 + uPgLaneLift * pgLane;
	diffuseColor.rgb = pgMedallion( diffuseColor.rgb, pgMedP );
	diffuseColor.rgb *= 1.0 - 0.45 * uPgWet * pgPuddle;
	// LOOK r3: rain darkens the whole floor (wet stone), puddles most.
	diffuseColor.rgb *= 1.0 - 0.3 * uPgWet;
`;
}

export const GROUND_ROUGHNESS_GLSL = /* glsl */ `
	float pgLum = pgLuma( diffuseColor.rgb );
	roughnessFactor = clamp( 0.97 - ${LANE_GLOSS.toFixed(2)} * max( pgLane, 0.8 * pgInlay ) - 0.1 * smoothstep( 0.12, 0.5, pgLum ) + 0.03 * pgGrime, 0.5, 1.0 );
	roughnessFactor = mix( roughnessFactor, 0.14 + 0.16 * ( 1.0 - pgLane ), uPgWet );
	roughnessFactor = mix( roughnessFactor, 0.06, uPgWet * pgPuddle );
`;

/** The stock normal-map stage with the same two anti-tiled fetches, then puddle flattening. */
export function groundNormalGlsl(normalChunk: string = THREE.ShaderChunk.normal_fragment_maps): string {
  const count = normalChunk.split(GROUND_ANCHORS.normalSample).length - 1;
  if (count !== 2) throw new Error(`[paint-ground] expected 2 × ${GROUND_ANCHORS.normalSample}, found ${count}`);
  return /* glsl */ `
	#ifdef USE_NORMALMAP
		vec2 pgNdx = dFdx( vNormalMapUv );
		vec2 pgNdy = dFdy( vNormalMapUv );
		vec4 pgNorA = textureGrad( normalMap, vNormalMapUv + pgOffA * ( 1.0 - pgFar ), pgNdx, pgNdy );
		vec4 pgNorB = pgNorA;
		if ( pgFar < 0.5 ) pgNorB = textureGrad( normalMap, vNormalMapUv + pgOffB, pgNdx, pgNdy );
	#endif
	${normalChunk.split(GROUND_ANCHORS.normalSample).join('mix( pgNorA, pgNorB, pgBlend )')}
	normal = normalize( mix( normal, nonPerturbedNormal, 0.85 * uPgWet * pgPuddle ) );
`;
}

export const GROUND_EMISSIVE_GLSL = /* glsl */ `
	// LOOK r5 (night: "warm lamp reflections in the wet setts near the lamp
	// posts"): the whole wet floor carries a share of the streaks, puddles all.
	if ( uPgWet > 0.0 && uPgEmitCount > 0.0 ) {
		// LOOK r6: the sett normal breaks the streaks up (static — the normal map, no clock).
		vec3 pgNd = normal - nonPerturbedNormal;
		totalEmissiveRadiance += pgReflect( pgW, uPgWet * mix( ${WET_SETT_REFLECTION.toFixed(2)}, 1.0, pgPuddle ), uPgWet * pgPuddle, vec2( pgNd.x, clamp( pgNd.y * 2.0, - 0.5, 0.5 ) ) );
	}
`;

export interface GroundUniforms {
  uPgMask: { value: THREE.Texture };
  uPgPlane: { value: THREE.Vector2 };
  uPgTint: { value: THREE.Color };
  uPgTintMix: { value: number };
  uPgValue: { value: number };
  uPgWet: { value: number };
  uPgLaneLift: { value: number };
  /** (centre x, centre z, radius, AA pixels). */
  uPgMed: { value: THREE.Vector4 };
  /** (ring width, band half-width, button outer, button inner). */
  uPgMedA: { value: THREE.Vector4 };
  uPgMedHue: { value: THREE.Color };
  /** (dark, light, tick, north value). */
  uPgMedV: { value: THREE.Vector4 };
  uPgTicks: { value: THREE.Vector2[] };
  /** (x, base y, z, lateral half-width). */
  uPgEmitA: { value: THREE.Vector4[] };
  /** (linear rgb radiance, top y). */
  uPgEmitB: { value: THREE.Vector4[] };
  uPgEmitCount: { value: number };
  uPgReflCap: { value: number };
  /** Moss hue of grimy joints (unit luminance). */
  uPgMoss: { value: THREE.Color };
  /** LOOK r6 (L6.2): wet lanes (x0, z0, x1, z1) and how many are live. */
  uPgLanes: { value: THREE.Vector4[] };
  uPgLaneCount: { value: number };
}

function requireAnchor(source: string, anchor: string): void {
  if (!source.includes(anchor)) throw new Error(`[paint-ground] three shader anchor missing: ${anchor}`);
}

/** Rewrite a Standard program's fragment source for the painted ground and bind its uniforms. */
export function patchGroundShader(shader: THREE.WebGLProgramParametersWithUniforms, uniforms: GroundUniforms): void {
  const src = shader.fragmentShader;
  requireAnchor(src, GROUND_ANCHORS.common);
  requireAnchor(src, GROUND_ANCHORS.mapFragment);
  requireAnchor(src, GROUND_ANCHORS.roughnessFragment);
  requireAnchor(src, GROUND_ANCHORS.normalMapsFragment);
  requireAnchor(src, GROUND_ANCHORS.emissiveFragment);
  shader.fragmentShader = src
    .replace(GROUND_ANCHORS.common, `${GROUND_ANCHORS.common}\n${GROUND_PARS_GLSL}`)
    .replace(GROUND_ANCHORS.mapFragment, groundMapGlsl())
    .replace(GROUND_ANCHORS.roughnessFragment, `${GROUND_ANCHORS.roughnessFragment}\n${GROUND_ROUGHNESS_GLSL}`)
    .replace(GROUND_ANCHORS.normalMapsFragment, groundNormalGlsl())
    .replace(GROUND_ANCHORS.emissiveFragment, `${GROUND_ANCHORS.emissiveFragment}\n${GROUND_EMISSIVE_GLSL}`);
  Object.assign(shader.uniforms, uniforms);
}

// ── Material ────────────────────────────────────────────────────────────────

export interface GroundTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  mask: THREE.Texture;
}

function texel(r: number, g: number, b: number, a: number, colorSpace: THREE.ColorSpace, wrap: THREE.Wrapping): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1);
  tex.colorSpace = colorSpace;
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 1×1 stand-ins with the resolved set's configuration: an sRGB diffuse at the
 * painted ground's mean albedo, a flat tangent-space normal, and a mask with
 * no lanes, no grime, no puddles and a mid macro index.
 */
export function groundPlaceholderTextures(): GroundTextures {
  return {
    map: texel(148, 140, 128, 255, THREE.SRGBColorSpace, THREE.RepeatWrapping),
    normalMap: texel(128, 128, 255, 255, THREE.NoColorSpace, THREE.RepeatWrapping),
    mask: texel(0, 0, 0, 128, THREE.NoColorSpace, THREE.ClampToEdgeWrapping),
  };
}

export interface PaintedGround {
  material: THREE.MeshStandardMaterial;
  uniforms: GroundUniforms;
  placeholders: GroundTextures;
  /** Point the material at a resolved diffuse + normal (null restores the placeholders). No program change. */
  setSurface(surface: { map: THREE.Texture; normalMap: THREE.Texture } | null): void;
  /** Point the patch at the resolved story mask (null restores the placeholder). No program change. */
  setMask(mask: THREE.Texture | null): void;
  dispose(): void;
}

/** Unit direction (x, z) from the medallion centre toward each station's forecourt. */
function tickDirections(): THREE.Vector2[] {
  const out = LANE_ANCHORS.slice(0, 5).map((lane) => {
    const v = new THREE.Vector2(lane.at[0] - MEDALLION.center[0], lane.at[1] - MEDALLION.center[1]);
    return v.lengthSq() > 0 ? v.normalize() : new THREE.Vector2(0, 1);
  });
  while (out.length < 5) out.push(new THREE.Vector2(0, 0));
  return out;
}

/**
 * The plaza floor material. Created once; every later change (palette,
 * night, rung, resolved textures) is a uniform or texture assignment.
 */
export function createPaintedGround(): PaintedGround {
  const placeholders = groundPlaceholderTextures();
  const uniforms: GroundUniforms = {
    uPgMask: { value: placeholders.mask },
    uPgPlane: { value: new THREE.Vector2(PLAZA_GROUND_PLANE.size / 2, PLAZA_GROUND_PLANE.size) },
    uPgTint: { value: new THREE.Color(1, 1, 1) },
    uPgTintMix: { value: GROUND_TINT_MIX },
    uPgValue: { value: 1 },
    uPgWet: { value: 0 },
    uPgLaneLift: { value: LANE_LIFT_MAX },
    uPgMed: {
      value: new THREE.Vector4(MEDALLION.center[0], MEDALLION.center[1], MEDALLION.radius * MEDALLION_SCALE, MEDALLION.aaPixels),
    },
    uPgMedA: {
      value: new THREE.Vector4(
        MEDALLION.ringWidth * MEDALLION_SCALE,
        MEDALLION.bandHalf * MEDALLION_SCALE,
        MEDALLION.buttonOuter * MEDALLION_SCALE,
        MEDALLION.buttonInner * MEDALLION_SCALE,
      ),
    },
    uPgMedHue: { value: new THREE.Color(1, 1, 1) },
    uPgMedV: {
      value: new THREE.Vector4(MEDALLION_VALUES.dark, MEDALLION_VALUES.light, MEDALLION_VALUES.tick, MEDALLION_VALUES.north),
    },
    uPgTicks: { value: tickDirections() },
    uPgEmitA: { value: Array.from({ length: PLAZA_EMITTER_SLOTS }, () => new THREE.Vector4()) },
    uPgEmitB: { value: Array.from({ length: PLAZA_EMITTER_SLOTS }, () => new THREE.Vector4()) },
    uPgEmitCount: { value: 0 },
    uPgReflCap: { value: REFLECTION_CAP },
    uPgMoss: { value: new THREE.Color(1, 1, 1) },
    uPgLanes: {
      value: Array.from({ length: WET_LANE_SLOTS }, (_, i) => {
        const lane = PLAZA_WET_LANES[i];
        return lane ? new THREE.Vector4(lane.from[0], lane.from[1], lane.to[0], lane.to[1]) : new THREE.Vector4();
      }),
    },
    uPgLaneCount: { value: Math.min(PLAZA_WET_LANES.length, WET_LANE_SLOTS) },
  };
  unitLuma(MEDALLION_NORTH_HUE, uniforms.uPgMedHue.value);
  unitLuma(GRIME.moss, uniforms.uPgMoss.value);

  const material = new THREE.MeshStandardMaterial({
    map: placeholders.map,
    normalMap: placeholders.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 1,
    metalness: 0,
    color: '#ffffff',
  });
  material.onBeforeCompile = (shader) => patchGroundShader(shader, uniforms);
  material.customProgramCacheKey = () => PAINT_GROUND_KEY;
  material.userData.paintGround = true;

  return {
    material,
    uniforms,
    placeholders,
    setSurface(surface) {
      material.map = surface?.map ?? placeholders.map;
      material.normalMap = surface?.normalMap ?? placeholders.normalMap;
    },
    setMask(mask) {
      uniforms.uPgMask.value = mask ?? placeholders.mask;
    },
    dispose() {
      material.dispose();
      placeholders.map.dispose();
      placeholders.normalMap.dispose();
      placeholders.mask.dispose();
    },
  };
}

/** `hex` in linear light scaled to unit luminance (a pure hue). */
export function unitLuma(hex: string | THREE.Color, out: THREE.Color = new THREE.Color()): THREE.Color {
  out.set(hex);
  const l = 0.2126 * out.r + 0.7152 * out.g + 0.0722 * out.b;
  if (l <= 1e-6) return out.setRGB(1, 1, 1);
  return out.multiplyScalar(1 / l);
}

/** Linear luminance of an sRGB byte triple. */
export function pigmentLuminance(rgb: readonly [number, number, number] | readonly number[]): number {
  const c = new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
