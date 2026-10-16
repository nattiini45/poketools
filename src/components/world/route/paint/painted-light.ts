/**
 * Painted light — the in-material painterly light model (LOOK-PLAN §2 SEAT L,
 * D19). One `onBeforeCompile` patch for lit Standard / Physical materials:
 *
 * - **Directional key only.** The stock `lights_fragment_begin` is rebuilt
 *   ONCE at module init from three's own chunk: inside the directional block
 *   the `getShadow( directionalShadowMap … )` factor is captured into
 *   `paintShadow` (byte-identical expression) instead of darkening the light,
 *   and `RE_Direct_Paint` is called with it. Point and spot lights keep the
 *   stock physical path untouched.
 * - **`RE_Direct_Paint`** runs the stock `RE_Direct` on the shadowed light
 *   (so GGX specular, clearcoat and sheen are exactly physical — wet night
 *   specular is unchanged) and replaces only the diffuse with the painted
 *   term: wrapped diffuse mixed with a soft value band, a cool shadow fill
 *   (the P3 floor, a share of key luminance), a warm terminator and a
 *   fresnel rim (key side + contre-jour), all blended by the role's `k`.
 *   With `k = 0` it adds the stock diffuse verbatim — physical identity.
 * - **Aerial perspective** replaces `#include <fog_fragment>`: the stock fog
 *   lines verbatim, then a luminance-preserving chroma shift toward the air
 *   hue and a day-only value lift beyond 25 m. World position is derived in
 *   the fragment from `vViewPosition` and `viewMatrix`, so it is valid for
 *   instanced, skinned and batched geometry without a vertex patch.
 *
 * Program-cache discipline: every patched material appends `|paint-v1` to
 * its existing key (chaining any hook it already had — tree wind, standby),
 * and the role is a UNIFORM, so env, figure and frame share one program.
 *
 * Scope: the patch only takes effect while a paint scope is held (a painted
 * world's `PaintSweep`, scope = its theme id). A module-cached material (a drei GLTF shared by a figure in
 * another world) compiled while no scope is held gets its ORIGINAL program
 * and key — the other world renders exactly as before (blast radius), and
 * the event is counted as a scope leak for the audit.
 */

import * as THREE from 'three';
import { PAINT_UNIFORMS, paintRoleFor, writePaintRole } from './paint-uniforms';

/** Program-cache suffix of a painted program. Bump on any GLSL change. */
export const PAINT_PROGRAM_KEY = 'paint-v6';

/** Anchors in three 0.185.1 (pinned — `anchors.test.ts` fails on drift). */
export const ANCHORS = {
  lightsBeginInclude: '#include <lights_fragment_begin>',
  parsInclude: '#include <lights_physical_pars_fragment>',
  fogInclude: '#include <fog_fragment>',
  lightsEndInclude: '#include <lights_fragment_end>',
  dirBlockStart: '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )',
  dirBlockEnd: '#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )',
  dirDeclare: 'DirectionalLight directionalLight;',
  dirInfo: 'getDirectionalLightInfo( directionalLight, directLight );',
  dirShadowPrefix: 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]',
  reDirectCall:
    'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );',
  pointInfo: 'getPointLightInfo( pointLight, geometryPosition, directLight );',
  diffuseContribution: 'diffuseContribution',
  fogEnd: '#endif',
} as const;

/** Thrown when three's chunk layout no longer matches the pinned anchors. */
export class PaintAnchorError extends Error {
  constructor(anchor: string) {
    super(`[paint] three shader anchor missing: ${anchor} — chunk layout changed (three is pinned at 0.185.1)`);
    this.name = 'PaintAnchorError';
  }
}

function requireAnchor(source: string, anchor: string): void {
  if (!source.includes(anchor)) throw new PaintAnchorError(anchor);
}

/** The warm-practical tint statement (emitted only by the N6 dev mock). */
export const POINT_TINT_LINE = 'directLight.color *= paintPointTint( pointLight.color );';

/**
 * D42 N6: `?routeDebug=1&routePaintTint=1` — the dev-only mock of the warm
 * night tint, for one owner still per night world (Q5). Ignored in
 * production builds and on the server. Read once, when the painted chunks
 * are first built (so a session is one program set either way).
 */
export function paintTintMockRequested(): boolean {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('routeDebug') === '1' && params.get('routePaintTint') === '1';
  } catch {
    return false;
  }
}

/**
 * The stock directional shadow statement, exactly as three writes it
 * (`directLight.color *= … getShadow( directionalShadowMap[ i ] … ) : 1.0;`).
 */
export function extractDirectionalShadowStatement(chunk: string): string {
  const start = chunk.indexOf(ANCHORS.dirShadowPrefix);
  if (start < 0) throw new PaintAnchorError(ANCHORS.dirShadowPrefix);
  const end = chunk.indexOf(';', start);
  if (end < 0) throw new PaintAnchorError(`${ANCHORS.dirShadowPrefix} … ;`);
  return chunk.slice(start, end + 1);
}

/**
 * Build the painted `lights_fragment_begin` from three's chunk. Pure string
 * surgery confined to the directional block; every other byte is stock.
 *
 * D42 N6 (owner D48, keep the approved night): the LOOK r4 warm-practical
 * tint never rendered. It replaced only the FIRST `getPointLightInfo`, which
 * after the light-loop split (`light-loop.ts`) is the shadowed, unrolled
 * branch no world compiles; the live plain loop never got it. By default it
 * is not emitted at all (the shipped night is exactly what has always
 * rendered). `pointTint: true` (the dev-only `?routePaintTint=1` mock, see
 * `paintTintMockRequested`) emits the CORRECTED tint after every
 * `getPointLightInfo` (`replaceAll`), so the Q5 mock still is real.
 */
export function buildPaintedLightsChunk(
  chunk: string = THREE.ShaderChunk.lights_fragment_begin,
  options: { pointTint?: boolean } = {},
): string {
  requireAnchor(chunk, ANCHORS.dirBlockStart);
  requireAnchor(chunk, ANCHORS.dirBlockEnd);
  const startAt = chunk.indexOf(ANCHORS.dirBlockStart);
  const endAt = chunk.indexOf(ANCHORS.dirBlockEnd, startAt);
  if (endAt < 0) throw new PaintAnchorError(`${ANCHORS.dirBlockEnd} after ${ANCHORS.dirBlockStart}`);
  const before = chunk.slice(0, startAt);
  const block = chunk.slice(startAt, endAt);
  const after = chunk.slice(endAt);

  requireAnchor(block, ANCHORS.dirDeclare);
  requireAnchor(block, ANCHORS.dirInfo);
  requireAnchor(block, ANCHORS.reDirectCall);
  const statement = extractDirectionalShadowStatement(block);
  const captured = statement.replace('directLight.color *=', 'paintShadow =');

  // LOOK r4: warm practicals (r > g > b) take the painted `uPointWarm` — the
  // dev mock only (N6); every point-light loop the chunk carries.
  let warmedBefore = before;
  if (options.pointTint) {
    requireAnchor(before, ANCHORS.pointInfo);
    warmedBefore = before.replaceAll(ANCHORS.pointInfo, `${ANCHORS.pointInfo}\n\t\t${POINT_TINT_LINE}`);
  }

  // Unrolled loops are concatenated without braces, so `paintShadow` is
  // declared ONCE beside `directionalLight`, outside the loop body.
  const patched = block
    .replace(ANCHORS.dirDeclare, `${ANCHORS.dirDeclare}\n\tfloat paintShadow;`)
    .replace(ANCHORS.dirInfo, `${ANCHORS.dirInfo}\n\t\tpaintShadow = 1.0;`)
    .replace(statement, captured)
    .replace(
      ANCHORS.reDirectCall,
      'RE_Direct_Paint( directLight, paintShadow, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );',
    );
  return warmedBefore + patched + after;
}

/**
 * Declarations + `RE_Direct_Paint`, inserted right after
 * `lights_physical_pars_fragment` (where `RE_Direct`, `BRDF_Lambert`,
 * `PhysicalMaterial` and `ReflectedLight` are all in scope).
 */
export const PAINT_PARS_GLSL = /* glsl */ `
uniform vec3 uPaintBand;
uniform vec4 uPaintRole;
uniform vec3 uShadowFill;
uniform vec3 uTermWarm;
uniform vec3 uRim;
uniform vec3 uIblTint;
uniform float uPaintSat;
uniform vec3 uKeyScale;
uniform vec3 uHemiSky;
uniform vec3 uHemiGround;
uniform float uHemiOn;
uniform float uIblSpec;
uniform vec3 uBounce;
uniform vec3 uPointWarm;
uniform vec3 uShadowForm;
uniform float uShadeSat;
uniform vec4 uShadeHue;
uniform float uRimPow;
uniform vec3 uMoonCatch;
uniform float uLumaCeil;
// LOOK r5: how much of this fragment is in the key's FORM shade (written by
// RE_Direct_Paint, read by the painted chroma so form shade keeps its
// albedo's colour). LOOK r6: cast shade is excluded — it takes the cool hue.
float paintShade = 0.0;
// LOOK r6 (L2): how much of this fragment is in the key's CAST shade (read
// after the lights resolve, so the indirect diffuse takes the same hue).
float paintCast = 0.0;
#define PAINT_KEY_SCALE uKeyScale
float paintLuma( const in vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
vec3 paintPointTint( const in vec3 c ) {
	float warm = smoothstep( 0.05, 0.35, ( c.r - c.b ) / max( c.r, 1e-4 ) ) * smoothstep( 0.0, 0.12, c.g - c.b );
	return mix( vec3( 1.0 ), uPointWarm, warm );
}
void RE_Direct_Paint( const in IncidentLight directLight, const in float sh, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	IncidentLight keyLight = directLight;
	keyLight.color *= uKeyScale;
	IncidentLight physLight = keyLight;
	physLight.color *= sh;
	ReflectedLight phys = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	RE_Direct( physLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, phys );
	reflectedLight.directSpecular += phys.directSpecular;
	float k = uPaintRole.x;
	if ( k <= 0.0 ) {
		reflectedLight.directDiffuse += phys.directDiffuse;
		return;
	}
	float ndl = dot( geometryNormal, directLight.direction );
	float wrapL = saturate( ( ndl + uPaintBand.x ) / ( 1.0 + uPaintBand.x ) );
	float band = smoothstep( uPaintBand.y, uPaintBand.z, ndl );
	float lit = mix( wrapL, band, uPaintRole.z );
	float amt = lit * sh;
	vec3 albedo = BRDF_Lambert( material.diffuseContribution );
	float keyLum = paintLuma( keyLight.color );
	vec3 painted = keyLight.color * amt * albedo;
	// LOOK r5: CAST shade (a sun-facing surface under a caster) takes the cool
	// sky fill; FORM shade (facing away from the key) takes the near-neutral
	// form fill — so shade is the local albedo, darker and a little cooler,
	// never a global lilac overlay.
	float paintSunward = smoothstep( - 0.05, 0.3, ndl );
	vec3 paintFill = mix( uShadowForm, uShadowFill, paintSunward );
	painted += paintFill * ( keyLum * ( 1.0 - amt ) ) * albedo;
	// LOOK r6 (L2): CAST shade is a HUE shift at matched luminance toward the
	// cool sky (the golden-hour colour script) — never a value drop and never
	// a global overlay; form shade keeps its albedo (and the shade chroma).
	float castT = paintSunward * ( 1.0 - amt );
	painted = mix( painted, vec3( paintLuma( painted ) ) * uShadeHue.rgb * 1.08, castT * uShadeHue.w );
	paintShade = max( paintShade, ( 1.0 - amt ) - castT );
	paintCast = max( paintCast, castT * k );
	painted += uTermWarm * ( keyLum * lit * ( 1.0 - lit ) * 4.0 * sh ) * albedo;
	float paintUp = dot( geometryNormal, normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) );
	painted += uBounce * ( keyLum * ( 1.0 - amt ) * ( 0.5 - 0.5 * paintUp ) ) * albedo;
	float fres = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), uRimPow );
	float backlit = saturate( - dot( geometryViewDir, directLight.direction ) );
	// LOOK r4 (contre-jour): the backlit rim survives a third of the way into cast
	// shade — the painterly halo on edges against a low sun (rules).
	// LOOK r6 (L6.1): the rim traces SILHOUETTES — never the open ground or a
	// flat roof seen at grazing incidence (the wide night rim lit the setts blue).
	float rimFlat = 1.0 - smoothstep( 0.7, 0.95, paintUp );
	vec3 rim = min( uRim * ( fres * ( 0.9 * saturate( ndl + 0.35 ) * sh + 1.4 * backlit * backlit * mix( 0.33, 1.0, sh ) ) * uPaintRole.y * rimFlat ), vec3( 0.9 ) );
	// LOOK r6 (L6.1): moon catch — up-facing ledges above the setts (cornices,
	// sills, zinc, heads) take a cool sheen, so the big planes read moonlit.
	float paintWy = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).y;
	vec3 moon = uMoonCatch * ( smoothstep( 0.55, 0.9, paintUp ) * smoothstep( 0.25, 0.6, paintWy ) ) * material.diffuseContribution;
	reflectedLight.directDiffuse += mix( phys.directDiffuse, painted, k ) + ( rim + moon ) * k;
}
`;

/**
 * LOOK r6 (L6.4): the board-first luminance ceiling — a soft knee on the
 * painted DIFFUSE (direct + indirect), after `lights_fragment_end` and before
 * the emissive, specular and reflection terms join, so the night world stays
 * below the boards' P50 outside the lamp cores. Off (≤ 0) by day.
 */
export const PAINT_CEIL_GLSL = /* glsl */ `
	// LOOK r6 (L2): the sky light INTO cast shade takes the same cool hue at
	// matched luminance (the direct fill already did, in RE_Direct_Paint).
	if ( uShadeHue.w > 0.0 && paintCast > 0.0 ) {
		reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, vec3( paintLuma( reflectedLight.indirectDiffuse ) ) * uShadeHue.rgb * 1.08, paintCast * uShadeHue.w );
	}
	if ( uLumaCeil > 0.0 && uPaintRole.x > 0.0 ) {
		float pcL = paintLuma( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse );
		float pcOver = max( pcL - uLumaCeil, 0.0 );
		float pcS = pcL > 1e-5 ? ( pcL - pcOver + pcOver / ( 1.0 + pcOver / ( 0.5 * uLumaCeil ) ) ) / pcL : 1.0;
		reflectedLight.directDiffuse *= pcS;
		reflectedLight.indirectDiffuse *= pcS;
	}
`;

/** Aerial perspective, appended inside the stock fog block (fog-less materials never get it). */
export const PAINT_AIR_GLSL = /* glsl */ `
	{
		vec3 paintWorldPos = ( ( vec4( - vViewPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 paintRay = paintWorldPos - cameraPosition;
		float paintDist = length( paintRay );
		float paintAir = 1.0 - exp( - uAir.y * max( paintDist - uAir.x, 0.0 ) );
		float paintY = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, paintY * uAirHue, paintAir * uAir.z );
		float paintLift = ( 1.0 - exp( - uAir.y * max( paintDist - uAirLiftStart, 0.0 ) ) ) * uAir.w;
		// LOOK r4: a broad sunward lobe, so contre-jour distance glows warm (rules).
		float paintSunward = smoothstep( - 0.1, 0.75, dot( paintRay / max( paintDist, 1e-4 ), uSunDir ) );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( uAirLift, uAirSun, paintSunward ), paintLift );
	}
`;

const PAINT_AIR_PARS_GLSL = /* glsl */ `
uniform vec3 uAirHue;
uniform vec4 uAir;
uniform float uAirLiftStart;
uniform vec3 uAirLift;
uniform vec3 uAirSun;
uniform vec3 uSunDir;
`;

/**
 * Painted chroma (LOOK r2), after fog and air, fog-less materials included:
 * a luminance-preserving saturation of the painted result ahead of the post
 * stack's AgX (which pulls saturated mid-tones toward grey).
 */
export const PAINT_SAT_GLSL = /* glsl */ `
	gl_FragColor.rgb = max( mix( vec3( dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), gl_FragColor.rgb, mix( 1.0, uPaintSat * ( 1.0 + uShadeSat * paintShade ), uPaintRole.w ) ), vec3( 0.0 ) );
`;

/**
 * The stock `fog_fragment` with the aerial block appended before its closing
 * `#endif`, then the painted chroma (outside the fog branch).
 */
export function buildPaintedFogChunk(chunk: string = THREE.ShaderChunk.fog_fragment): string {
  const trimmed = chunk.trimEnd();
  if (!trimmed.endsWith(ANCHORS.fogEnd)) throw new PaintAnchorError(`fog_fragment closing ${ANCHORS.fogEnd}`);
  return `${trimmed.slice(0, -ANCHORS.fogEnd.length)}${PAINT_AIR_GLSL}\n${ANCHORS.fogEnd}\n${PAINT_SAT_GLSL}\n`;
}

/**
 * The indirect light of a painted material, before three resolves it: the
 * IBL hue (shade colour) and scale on the irradiance, the IBL specular
 * scale, and the scene hemisphere swapped for the painted pair (LOOK r3 —
 * the scene keeps the shipped lights for every unpainted material).
 */
export const PAINT_IBL_GLSL = /* glsl */ `
	iblIrradiance *= uIblTint;
	#if defined( RE_IndirectSpecular )
	radiance *= uIblSpec;
	#endif
	#if NUM_HEMI_LIGHTS > 0
	irradiance += uHemiOn * ( mix( uHemiGround, uHemiSky, 0.5 * dot( geometryNormal, hemisphereLights[ 0 ].direction ) + 0.5 ) - getHemisphereLightIrradiance( hemisphereLights[ 0 ], geometryNormal ) );
	#endif
`;

let paintedLightsChunk: string | null = null;
let paintedFogChunk: string | null = null;

/** Module-init-once patched chunks (lazy so a missing anchor throws where it is caught). */
export function paintedChunks(): { lights: string; fog: string } {
  paintedLightsChunk ??= buildPaintedLightsChunk(THREE.ShaderChunk.lights_fragment_begin, {
    pointTint: paintTintMockRequested(),
  });
  paintedFogChunk ??= buildPaintedFogChunk();
  return { lights: paintedLightsChunk, fog: paintedFogChunk };
}

/** Test seam: drop the module-cached chunks (the next `paintedChunks()` rebuilds them). */
export function resetPaintedChunksForTest(): void {
  paintedLightsChunk = null;
  paintedFogChunk = null;
}

/** Per-material role uniform `(k, rimScale, bandMix, saturation share)`. */
export type PaintRoleUniform = { value: THREE.Vector4 };

/**
 * Patch a Standard / Physical program's fragment source in place and bind the
 * shared uniforms by reference plus this material's role uniform.
 */
export function patchPaintedShader(
  shader: THREE.WebGLProgramParametersWithUniforms,
  role: PaintRoleUniform,
): void {
  const src = shader.fragmentShader;
  requireAnchor(src, ANCHORS.lightsBeginInclude);
  requireAnchor(src, ANCHORS.parsInclude);
  requireAnchor(src, ANCHORS.fogInclude);
  requireAnchor(src, ANCHORS.lightsEndInclude);
  const chunks = paintedChunks();
  shader.fragmentShader = src
    .replace(ANCHORS.parsInclude, `${ANCHORS.parsInclude}\n${PAINT_PARS_GLSL}\n${PAINT_AIR_PARS_GLSL}`)
    .replace(ANCHORS.lightsBeginInclude, chunks.lights)
    .replace(ANCHORS.lightsEndInclude, `${PAINT_IBL_GLSL}\n${ANCHORS.lightsEndInclude}\n${PAINT_CEIL_GLSL}`)
    .replace(ANCHORS.fogInclude, chunks.fog);
  const u = PAINT_UNIFORMS;
  shader.uniforms.uPaintBand = u.uPaintBand;
  shader.uniforms.uShadowFill = u.uShadowFill;
  shader.uniforms.uTermWarm = u.uTermWarm;
  shader.uniforms.uRim = u.uRim;
  shader.uniforms.uAirHue = u.uAirHue;
  shader.uniforms.uAir = u.uAir;
  shader.uniforms.uAirLiftStart = u.uAirLiftStart;
  shader.uniforms.uAirLift = u.uAirLift;
  shader.uniforms.uAirSun = u.uAirSun;
  shader.uniforms.uSunDir = u.uSunDir;
  shader.uniforms.uIblTint = u.uIblTint;
  shader.uniforms.uPaintSat = u.uPaintSat;
  shader.uniforms.uKeyScale = u.uKeyScale;
  shader.uniforms.uHemiSky = u.uHemiSky;
  shader.uniforms.uHemiGround = u.uHemiGround;
  shader.uniforms.uHemiOn = u.uHemiOn;
  shader.uniforms.uIblSpec = u.uIblSpec;
  shader.uniforms.uBounce = u.uBounce;
  shader.uniforms.uPointWarm = u.uPointWarm;
  shader.uniforms.uShadowForm = u.uShadowForm;
  shader.uniforms.uShadeSat = u.uShadeSat;
  shader.uniforms.uShadeHue = u.uShadeHue;
  shader.uniforms.uRimPow = u.uRimPow;
  shader.uniforms.uMoonCatch = u.uMoonCatch;
  shader.uniforms.uLumaCeil = u.uLumaCeil;
  shader.uniforms.uPaintRole = role;
}

// ── Scope ───────────────────────────────────────────────────────────────────

const scopes = new Map<string, number>();
let leakCount = 0;

/** Hold a paint scope (the plaza sweep); returns its release. */
export function acquirePaintScope(scope: string): () => void {
  scopes.set(scope, (scopes.get(scope) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (scopes.get(scope) ?? 1) - 1;
    if (next <= 0) scopes.delete(scope);
    else scopes.set(scope, next);
  };
}

/** Whether any paint scope is held (a painted world is mounted). */
export function paintScopeActive(): boolean {
  return scopes.size > 0;
}

/**
 * Times a paint-marked material was compiled while NO scope was held — a
 * module-cached material reaching another world. Handled (the program is the
 * original one), but counted so the audit can report it.
 */
export function paintScopeLeaks(): number {
  return leakCount;
}

/** Test seam: drop all scopes and the leak counter. */
export function resetPaintScopeForTest(): void {
  scopes.clear();
  leakCount = 0;
}

// ── Material patch ──────────────────────────────────────────────────────────

type CompileHook = THREE.Material['onBeforeCompile'];
type KeyFn = () => string;

interface PaintRecord {
  hook: CompileHook;
  key: KeyFn;
  /** The key the material had before painting (chained). */
  baseKey: KeyFn;
  role: PaintRoleUniform;
}

const records = new WeakMap<THREE.Material, PaintRecord>();

const DEFAULT_KEY_FN: KeyFn = THREE.Material.prototype.customProgramCacheKey;

/** Whether the material currently carries its painted hook (it may have been re-hooked since). */
export function isPainted(material: THREE.Material): boolean {
  const record = records.get(material);
  return record !== undefined && material.onBeforeCompile === record.hook && material.customProgramCacheKey === record.key;
}

/** The material's role uniform, if it was ever painted. */
export function paintRoleUniform(material: THREE.Material): PaintRoleUniform | null {
  return records.get(material)?.role ?? null;
}

/**
 * Paint one lit material: chain its existing `onBeforeCompile`, append
 * `|paint-v1` to its existing program key, and create its `uPaintRole`
 * uniform from `userData.paintRole`. Idempotent — a second call on an
 * already-painted material is a no-op (no double suffix). If some other code
 * re-hooked the material since, the NEW hook is chained on top.
 *
 * Sets `userData.paintScope = scope` (the leak marker; the painting world's
 * theme id — required, there is no default) and flags the material for a
 * program rebuild in case it had compiled unpainted.
 */
export function applyPaintedLight(material: THREE.Material, scope: string): PaintRoleUniform {
  const existing = records.get(material);
  if (existing && isPainted(material)) return existing.role;

  const prevHook: CompileHook = material.onBeforeCompile;
  // A key wrapper of ours still installed means only the hook was replaced:
  // chain from the ORIGINAL key, never from our own suffixed one.
  const prevKeyFn: KeyFn =
    existing && material.customProgramCacheKey === existing.key ? existing.baseKey : material.customProgramCacheKey;
  const baseKey: KeyFn =
    prevKeyFn === DEFAULT_KEY_FN
      ? // three's default key is the hook's source text — keep keying the ORIGINAL hook.
        () => prevHook.toString()
      : () => prevKeyFn.call(material);

  const role: PaintRoleUniform = existing?.role ?? { value: new THREE.Vector4() };
  writePaintRole(role.value, paintRoleFor(material.userData?.paintRole));

  const hook: CompileHook = (shader, renderer) => {
    prevHook.call(material, shader, renderer);
    if (!paintScopeActive()) {
      leakCount += 1;
      return;
    }
    patchPaintedShader(shader, role);
  };
  const key: KeyFn = () => (paintScopeActive() ? `${baseKey()}|${PAINT_PROGRAM_KEY}` : baseKey());

  material.onBeforeCompile = hook;
  material.customProgramCacheKey = key;
  material.userData.paintScope = scope;
  material.needsUpdate = true;
  records.set(material, { hook, key, baseKey, role });
  return role;
}

/** Re-read `userData.paintRole` into a painted material's role uniform (uniform write only). */
export function refreshPaintRole(material: THREE.Material): void {
  const role = records.get(material)?.role;
  if (role) writePaintRole(role.value, paintRoleFor(material.userData?.paintRole));
}

// ── Reference model (tests, tuning) ─────────────────────────────────────────

/**
 * CPU mirror of the painted diffuse's light amount for one N·L and shadow
 * factor — the `lit · sh` the GLSL multiplies the key by. With `k = 0` the
 * GLSL uses the stock Lambert `saturate(ndl) · sh` instead (physical identity).
 */
export function paintedLightAmount(
  ndl: number,
  sh: number,
  band: { wrap: number; lo: number; hi: number },
  bandMix: number,
): number {
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
  const wrapL = clamp01((ndl + band.wrap) / (1 + band.wrap));
  const t = clamp01((ndl - band.lo) / (band.hi - band.lo));
  const smooth = t * t * (3 - 2 * t);
  return (wrapL + (smooth - wrapL) * bandMix) * sh;
}
