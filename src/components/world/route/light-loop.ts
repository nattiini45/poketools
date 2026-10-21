import * as THREE from 'three';

/**
 * Point-light loop without the unroll (ENGINE r3, D23 "complete at reveal").
 *
 * three unrolls the forward point-light loop (`#pragma unroll_loop_start`)
 * so each iteration can index the point-SHADOW sampler array with a
 * constant. A world with many unshadowed point lights (the plaza: 18-20 by
 * day, 27 at night) therefore compiles every lit program with 18-27 inlined
 * copies of the point-light BRDF. On ANGLE / D3D11 that HLSL is what the
 * shader compiler chews on: single programs took up to 2.3 s of
 * `D3DCompile`, and the night plaza's load warm spent 12 s compiling (r3
 * cold harness), a 19 s reveal against the 20 s deadline.
 *
 * When no point light casts a shadow (`NUM_POINT_LIGHT_SHADOWS == 0`) the
 * sampler array is never touched, so the loop needs no unroll: the same
 * body, in the same order (i = 0..N-1), runs as a real loop over the
 * uniform array (dynamic uniform indexing is core GLSL ES 3.00). Worlds with
 * shadowed point lights keep three's unrolled loop verbatim (the `#if`
 * below keeps the stock text for them).
 *
 * The plain loop also skips a zero-colour light (`POINT_LOOP_SKIP`: the dark
 * pads that keep the point-light count stable across a palette swap, and
 * any light dimmed to 0) — its term is exactly zero either way.
 *
 * The chunk is patched once, before the first compile (module scope of the
 * route canvas), and only when three's text matches the pinned anchors;
 * otherwise it is left untouched (a three bump falls back to stock).
 */

/** Anchors in three 0.185.1's `lights_fragment_begin` (pinned by test). */
export const POINT_LOOP_ANCHORS = {
  blockStart: '#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )',
  loopStart: '\t#pragma unroll_loop_start\n\tfor ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {',
  loopEnd: '\t#pragma unroll_loop_end',
} as const;

/** Marker so the patch is idempotent (and visible in a dumped shader). */
export const POINT_LOOP_MARKER = '// route-world: point-light loop (unshadowed)';

/**
 * ENGINE-FIX (D32): a light that adds nothing is skipped. Its term is exactly
 * zero (`irradiance = dotNL * color`), so skipping it leaves every pixel as
 * it was; what it saves is the BRDF. The route canvas pads the scene's
 * point-light count up to a stable ceiling with dark lights
 * (`POINT_LIGHT_PAD_NAME`, RouteWorldCanvas) so `NUM_POINT_LIGHTS` — a
 * program key — is the same in both palettes and a day/night swap links no
 * program; with this line a pad costs one uniform compare per fragment.
 */
export const POINT_LOOP_SKIP = 'if ( pointLight.color == vec3( 0.0 ) ) continue;';

/**
 * ENGINE-FIX (D32): the point-light count the programs are keyed on for a
 * scene with `count` real point lights — the next power of two (0 stays 0).
 * The canvas pads up to it (and never below a count it already padded to),
 * so a palette with a few more or fewer lights (the plaza: 20 by day, 27 at
 * night — both 32) keeps every program key through a day/night swap. Worlds
 * whose palettes carry the same count keep it as it is when it is already a
 * power of two (mountain, clouds: 8). Pure.
 */
export function pointLightCeiling(count: number): number {
  if (!(count > 0)) return 0;
  return 2 ** Math.ceil(Math.log2(count));
}

/**
 * Pure: the chunk with the point-light loop split into the stock unrolled
 * loop (shadowed point lights) and a plain loop (none shadowed). Returns the
 * input unchanged when the anchors are missing or it is already patched.
 */
export function buildPointLightLoopChunk(chunk: string): string {
  if (chunk.includes(POINT_LOOP_MARKER)) return chunk;
  const blockAt = chunk.indexOf(POINT_LOOP_ANCHORS.blockStart);
  if (blockAt < 0) return chunk;
  const loopAt = chunk.indexOf(POINT_LOOP_ANCHORS.loopStart, blockAt);
  if (loopAt < 0) return chunk;
  const endAt = chunk.indexOf(POINT_LOOP_ANCHORS.loopEnd, loopAt);
  if (endAt < 0) return chunk;
  const loopEnd = endAt + POINT_LOOP_ANCHORS.loopEnd.length;
  const stock = chunk.slice(loopAt, loopEnd);
  const plain = [
    `\t${POINT_LOOP_MARKER}`,
    '\tfor ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {',
    '',
    '\t\tpointLight = pointLights[ i ];',
    '',
    `\t\t${POINT_LOOP_SKIP}`,
    '',
    '\t\tgetPointLightInfo( pointLight, geometryPosition, directLight );',
    '',
    '\t\tRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );',
    '',
    '\t}',
  ].join('\n');
  const split = [
    '\t#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0',
    stock,
    '\t#else',
    plain,
    '\t#endif',
  ].join('\n');
  return chunk.slice(0, loopAt) + split + chunk.slice(loopEnd);
}

/**
 * `?routeDebug=1&routeLightLoop=0` keeps three's stock chunk for one
 * session (dev only), so a capture can A/B the patch pixel for pixel.
 */
function patchDisabledForDebug(): boolean {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('routeDebug') === '1' && params.get('routeLightLoop') === '0';
}

/** Patch three's shared chunk once (idempotent). */
export function installPointLightLoop(): void {
  if (patchDisabledForDebug()) return;
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  const current = chunks.lights_fragment_begin;
  if (typeof current !== 'string') return;
  const next = buildPointLightLoopChunk(current);
  if (next !== current) chunks.lights_fragment_begin = next;
}
