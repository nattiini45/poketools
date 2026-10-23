'use client';

import { useEffect, useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  bayOfX,
  blockHeight,
  blockToWorld,
  compileFacade,
  dormerSeat,
  floorOfVolume,
  HAUSSMANN,
  isShopfrontBay,
  ledSpecs,
  mansardSpecForWing,
  massWings,
  paneComponents,
  paneUvOf,
  planBlock,
  type BlockPlan,
  type LedSpec,
  type MansardSpec,
  type MassWing,
  type WindowVolume,
} from '@/lib/route-world/haussmann';
import {
  disposeStoneMaps,
  stoneMaps,
  zincMaps,
  type StoneMapSet,
} from '@/components/world/themes/plaza/stone-maps';
import { patchAshlar, writeAshlarBlock } from '@/components/world/themes/plaza/paint-ashlar';
import { plazaBlockTint } from '@/components/world/themes/plaza/theme-palette';
import KitBays, { type KitMaterials, type KitModels } from './facade-kit';
import { CREST_EMISSIVE, LedCrestWall } from './LedScreen';

const STONE_TILE = 1.55;
type Slot = 'stone' | 'zinc' | 'iron' | 'glass' | 'lamp' | 'shade';
const SLOTS: Slot[] = ['stone', 'zinc', 'iron', 'glass', 'lamp', 'shade'];

/** One PBR surface, procedural or scanned; `ao` only exists for scanned ARM packs. */
export interface SurfaceMaps {
  color: THREE.Texture;
  rough: THREE.Texture | null;
  normal: THREE.Texture;
  ao: THREE.Texture | null;
}

/** Scanned façade sets (ADR-0001) the perimeter loads once and hands to every block. */
export interface FacadeMaps {
  stone: SurfaceMaps;
  zinc: SurfaceMaps;
}

function asSurface(maps: StoneMapSet): SurfaceMaps {
  return { color: maps.color, rough: maps.rough, normal: maps.normal, ao: null };
}

/**
 * Procedural maps are only generated when no scanned set stands in for them.
 * They are generated ONCE in their day pigment: night is a colour-uniform
 * write on the material (LOOK-PLAN §2 S.3 — no night-keyed rebuild).
 */
function useProceduralSurface(factory: () => StoneMapSet, sourced: SurfaceMaps | null): SurfaceMaps {
  const maps = useMemo(() => (sourced ? null : factory()), [factory, sourced]);
  useEffect(() => () => (maps ? disposeStoneMaps(maps) : undefined), [maps]);
  return sourced ?? asSurface(maps as StoneMapSet);
}

function mappedMaterial({
  maps,
  fallback,
  metalness,
  roughness,
  emissive,
  normalScale = 1,
}: {
  maps: SurfaceMaps;
  fallback: string;
  metalness: number;
  roughness: number;
  emissive?: string;
  normalScale?: number;
}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: maps.color,
    roughnessMap: maps.rough ?? undefined,
    normalMap: maps.normal,
    normalScale: new THREE.Vector2(normalScale, normalScale),
    aoMap: maps.ao ?? undefined,
    aoMapIntensity: 0.7,
    roughness,
    metalness,
    color: fallback,
    emissive: emissive ?? '#000000',
    emissiveIntensity: 0,
  });
}

// ── Painterly windows (LOOK r4) ─────────────────────────────────────────────

/** Program-cache key of the window shader. Bump on any GLSL change. */
export const WINDOW_PROGRAM_KEY = 'plaza-window-v2';

/**
 * LOOK r6 (L6.6, night: "lit windows with depth"): each pane looks into a
 * small procedural ROOM (interior mapping — a ray-box behind the glass: back
 * wall, side walls, floor and ceiling with a lamp hot spot), its wall colour
 * hashed per pane from its world position. No textures. The room is a
 * relative shading factor ≤ 1 on the existing interior / lit colours, so the
 * interior luma never exceeds r5's `litGain`. Sizes in metres.
 */
export const WINDOW_ROOM = {
  pane: [0.8, 1.4] as const,
  /** Room box around the pane centre: half width, floor below, ceiling above, depth. */
  box: { halfW: 1.5, floor: 1.7, ceiling: 1.4, depth: 3.2 },
  /** Unlit rooms (day and night) show this much of the room shading over the flat interior. */
  unlitDepth: 0.9,
} as const;

/**
 * LOOK r4 (lead: "flat BLACK window slabs … they look unfinished"): every
 * pane is a painted window — cream frame and glazing bars, glass that
 * reflects a soft sky gradient (horizon → zenith, the street below the
 * horizon) over a dim interior with curtains at the jambs, and one soft
 * diagonal glint. At night the glass is dark blue with a moon sheen and the
 * rhythm's lit panes (static, `windowLitByRhythm`, never animated) glow warm
 * behind their curtains. Sign bands (kit fascias, `paneUv` −1) are a painted
 * signboard by day and a warm strip at night. Unlit (a `MeshBasicMaterial`
 * program): the painted light and the IBL never touch it; fog applies.
 */
export const WINDOW_LOOK = {
  day: {
    skyLo: '#dcd3c2',
    skyHi: '#7fa3cc',
    ground: '#6c6258',
    interior: '#262a33',
    curtain: '#c9bca4',
    frame: '#d8d0c2',
    band: '#6e5438',
    warm: '#ffb45e',
    gain: 0.62,
    litGain: 0.62,
  },
  night: {
    skyLo: '#243656',
    skyHi: '#101c36',
    ground: '#0b0d14',
    // LOOK r5 (night: "the warm façade window rhythm is gone"): unlit rooms
    // keep a dim lamp-warm interior behind the blue glass.
    interior: '#2a1a0c',
    curtain: '#3a2816',
    frame: '#2c2c33',
    band: '#3a2c1e',
    warm: '#ffae58',
    gain: 1,
    litGain: 2.4,
  },
} as const;

export interface WindowUniforms {
  uWinSkyLo: { value: THREE.Color };
  uWinSkyHi: { value: THREE.Color };
  uWinGround: { value: THREE.Color };
  uWinInterior: { value: THREE.Color };
  uWinCurtain: { value: THREE.Color };
  uWinFrame: { value: THREE.Color };
  uWinBand: { value: THREE.Color };
  uWinWarm: { value: THREE.Color };
  uWinGain: { value: number };
  uWinNight: { value: number };
  [uniform: string]: THREE.IUniform;
}

/** The one shared window look every block's window materials bind (by reference). */
export const WINDOW_UNIFORMS: WindowUniforms = {
  uWinSkyLo: { value: new THREE.Color() },
  uWinSkyHi: { value: new THREE.Color() },
  uWinGround: { value: new THREE.Color() },
  uWinInterior: { value: new THREE.Color() },
  uWinCurtain: { value: new THREE.Color() },
  uWinFrame: { value: new THREE.Color() },
  uWinBand: { value: new THREE.Color() },
  uWinWarm: { value: new THREE.Color() },
  uWinGain: { value: 1 },
  uWinNight: { value: 0 },
};

/** Write the palette's window look (uniform writes only — never a program change). */
export function writeWindowLook(night: boolean, uniforms: WindowUniforms = WINDOW_UNIFORMS): void {
  const look = night ? WINDOW_LOOK.night : WINDOW_LOOK.day;
  uniforms.uWinSkyLo.value.set(look.skyLo);
  uniforms.uWinSkyHi.value.set(look.skyHi);
  uniforms.uWinGround.value.set(look.ground);
  uniforms.uWinInterior.value.set(look.interior);
  uniforms.uWinCurtain.value.set(look.curtain);
  uniforms.uWinFrame.value.set(look.frame);
  uniforms.uWinBand.value.set(look.band);
  uniforms.uWinWarm.value.set(look.warm).multiplyScalar(look.litGain);
  uniforms.uWinGain.value = look.gain;
  uniforms.uWinNight.value = night ? 1 : 0;
}

export const WINDOW_VERTEX_PARS = /* glsl */ `
attribute vec2 paneUv;
varying vec2 vPaneUv;
varying vec3 vWinPos;
varying vec3 vWinN;
`;

export const WINDOW_VERTEX_MAIN = /* glsl */ `
	vec4 winLocal = vec4( transformed, 1.0 );
	mat3 winM = mat3( modelMatrix );
	#ifdef USE_INSTANCING
		winLocal = instanceMatrix * winLocal;
		winM = winM * mat3( instanceMatrix );
	#endif
	vWinPos = ( modelMatrix * winLocal ).xyz;
	vWinN = normalize( winM * normal );
	vPaneUv = paneUv;
`;

export const WINDOW_FRAGMENT_PARS = /* glsl */ `
uniform vec3 uWinSkyLo;
uniform vec3 uWinSkyHi;
uniform vec3 uWinGround;
uniform vec3 uWinInterior;
uniform vec3 uWinCurtain;
uniform vec3 uWinFrame;
uniform vec3 uWinBand;
uniform vec3 uWinWarm;
uniform float uWinGain;
uniform float uWinNight;
uniform float uWinLit;
varying vec2 vPaneUv;
varying vec3 vWinPos;
varying vec3 vWinN;
float winBar( float x, float c, float w ) {
	float aa = fwidth( x ) * 1.25 + 1e-4;
	return 1.0 - smoothstep( w - aa, w + aa, abs( x - c ) );
}
vec3 winRoom( vec2 p, vec3 N ) {
	// The pane's own frame from screen derivatives (the cotangent frame), so
	// the room parallaxes the right way on every block and kit module.
	vec3 dp1 = dFdx( vWinPos );
	vec3 dp2 = dFdy( vWinPos );
	vec2 du1 = dFdx( p );
	vec2 du2 = dFdy( p );
	vec3 dp2perp = cross( dp2, N );
	vec3 dp1perp = cross( N, dp1 );
	vec3 T = dp2perp * du1.x + dp1perp * du2.x;
	vec3 Bv = dp2perp * du1.y + dp1perp * du2.y;
	T = dot( T, T ) > 1e-16 ? normalize( T ) : vec3( 1.0, 0.0, 0.0 );
	Bv = dot( Bv, Bv ) > 1e-16 ? normalize( Bv ) : vec3( 0.0, 1.0, 0.0 );
	vec3 Vin = normalize( vWinPos - cameraPosition );
	vec3 d = vec3( dot( Vin, T ), dot( Vin, Bv ), max( dot( Vin, - N ), 0.05 ) );
	d.xy = sign( d.xy ) * max( abs( d.xy ), vec2( 1e-4 ) ) + vec2( step( 0.0, - abs( d.x ) ), step( 0.0, - abs( d.y ) ) ) * 1e-4;
	vec3 o = vec3( ( p.x - 0.5 ) * ${WINDOW_ROOM.pane[0].toFixed(2)}, ( p.y - 0.5 ) * ${WINDOW_ROOM.pane[1].toFixed(2)}, 0.0 );
	vec3 lo = vec3( - ${WINDOW_ROOM.box.halfW.toFixed(2)}, - ${WINDOW_ROOM.box.floor.toFixed(2)}, 0.0 );
	vec3 hi = vec3( ${WINDOW_ROOM.box.halfW.toFixed(2)}, ${WINDOW_ROOM.box.ceiling.toFixed(2)}, ${WINDOW_ROOM.box.depth.toFixed(2)} );
	vec3 tF = max( ( lo - o ) / d, ( hi - o ) / d );
	float t = min( min( tF.x, tF.y ), tF.z );
	vec3 h = o + d * t;
	float back = step( tF.z, min( tF.x, tF.y ) );
	float flat_ = ( 1.0 - back ) * step( tF.y, tF.x );
	float floorF = flat_ * step( d.y, 0.0 );
	float ceilF = flat_ - floorF;
	float sideF = 1.0 - back - flat_;
	// Per-pane wall colour (cream, rose, sage), hashed from the pane's world cell.
	float hsh = fract( sin( dot( floor( vWinPos.xz * 0.45 + vWinPos.y * 0.31 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
	vec3 wall = hsh < 0.34 ? vec3( 1.0, 0.88, 0.72 ) : hsh < 0.67 ? vec3( 0.98, 0.8, 0.74 ) : vec3( 0.8, 0.88, 0.8 );
	vec3 col = wall * ( back + sideF * 0.72 + ceilF * 0.86 ) + vec3( 0.62, 0.46, 0.34 ) * floorF;
	col *= mix( 1.0, 0.62, smoothstep( 0.4, ${WINDOW_ROOM.box.depth.toFixed(2)}, h.z ) );
	// A ceiling lamp: a hot spot above the room's middle and its pool below.
	float lampD2 = h.x * h.x + ( h.z - 1.5 ) * ( h.z - 1.5 );
	float hot = ceilF * exp( - lampD2 * 2.5 ) + floorF * exp( - lampD2 * 0.9 ) * 0.7 + back * exp( - ( h.x * h.x + ( h.y - 0.7 ) * ( h.y - 0.7 ) ) * 0.7 ) * 0.45;
	return min( col * ( 0.6 + 0.5 * hot ), vec3( 1.0 ) );
}
vec3 winColor() {
	vec2 p = vPaneUv;
	float lit = uWinLit * uWinNight;
	if ( p.x < -0.5 ) return mix( uWinBand * uWinGain, uWinWarm * 0.8, lit );
	vec3 V = normalize( cameraPosition - vWinPos );
	vec3 N = normalize( vWinN );
	vec3 R = reflect( - V, N );
	vec3 sky = mix( uWinSkyLo, uWinSkyHi, smoothstep( 0.0, 0.75, R.y ) );
	sky = mix( uWinGround, sky, smoothstep( - 0.3, 0.05, R.y ) );
	float fres = pow( 1.0 - clamp( abs( dot( N, V ) ), 0.0, 1.0 ), 3.0 );
	float drape = clamp( smoothstep( 0.30, 0.08, p.x ) + smoothstep( 0.70, 0.92, p.x ), 0.0, 1.0 );
	float fold = 0.78 + 0.22 * sin( p.x * 58.0 );
	vec3 room = winRoom( p, N );
	vec3 inside = mix( uWinInterior * mix( vec3( 1.0 ), room * 1.5, ${WINDOW_ROOM.unlitDepth.toFixed(2)} ), uWinCurtain * fold, drape * 0.8 );
	inside *= mix( 0.72, 1.0, smoothstep( 0.0, 0.5, p.y ) );
	vec3 glow = uWinWarm * mix( room, vec3( 0.55 * fold ), drape ) * mix( 0.85, 1.0, p.y );
	inside = mix( inside, glow, lit );
	float refl = mix( 0.58, 0.9, fres ) * ( 1.0 - 0.8 * lit );
	vec3 glass = mix( inside, sky, refl ) * mix( uWinGain, 1.0, lit );
	float streak = 1.0 - smoothstep( 0.0, 0.06, abs( fract( ( p.x * 0.7 + p.y ) * 0.85 + 0.2 ) - 0.5 ) );
	glass += uWinSkyLo * uWinGain * 0.14 * streak * ( 1.0 - lit ) * smoothstep( 0.15, 0.4, p.y );
	float bars = max( max( winBar( p.x, 0.5, 0.02 ), winBar( p.y, 0.66, 0.018 ) ), winBar( p.y, 0.33, 0.014 ) );
	float aaE = fwidth( p.x ) + fwidth( p.y ) + 1e-4;
	float edge = 1.0 - smoothstep( 0.035, 0.035 + aaE, min( min( p.x, 1.0 - p.x ), min( p.y, 1.0 - p.y ) ) );
	float frame = max( bars, edge );
	return mix( glass, uWinFrame * uWinGain * mix( 1.0, 0.55, lit ), frame );
}
`;

const windowUniformIds = new WeakMap<WindowUniforms, number>();
let nextWindowUniformId = 1;

/**
 * D42 N4: the StaticBatcher merge key of a window material — the identity of
 * its uniform set (`WINDOW_UNIFORMS` is the shared look; any other set is
 * its own family). The lit flag is keyed separately (`userData.windowLit`).
 */
export function windowMergeKey(uniforms: WindowUniforms): string {
  if (uniforms === WINDOW_UNIFORMS) return 'window:shared';
  let id = windowUniformIds.get(uniforms);
  if (id === undefined) {
    id = nextWindowUniformId;
    nextWindowUniformId += 1;
    windowUniformIds.set(uniforms, id);
  }
  return `window:${id}`;
}

/** A window material: a rhythm-lit pane or plain glass. One program for both (`uWinLit` is a uniform). */
export function createWindowMaterial(lit: boolean, uniforms: WindowUniforms = WINDOW_UNIFORMS): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const litUniform = { value: lit ? 1 : 0 };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uWinLit: litUniform });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WINDOW_VERTEX_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WINDOW_VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WINDOW_FRAGMENT_PARS}`)
      .replace('#include <opaque_fragment>', 'outgoingLight = winColor();\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => WINDOW_PROGRAM_KEY;
  material.userData.paintExempt = true;
  material.userData.windowLit = lit;
  material.userData.mergeKey = windowMergeKey(uniforms);
  return material;
}

type Vec3 = [number, number, number];

function readVertex(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number): Vec3 {
  return [attr.getX(i), attr.getY(i), attr.getZ(i)];
}

type AnyAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/**
 * A copy of a glazing geometry with its pane-space `paneUv` attribute and
 * without the kit's rustication strips (`paneKindOf` 'drop'). Null when
 * nothing is left to draw.
 */
export function withPaneUv(source: THREE.BufferGeometry): THREE.BufferGeometry | null {
  const pos = source.getAttribute('position') as AnyAttribute | undefined;
  if (!pos) return null;
  const nor = source.getAttribute('normal') as AnyAttribute | undefined;
  const uv = source.getAttribute('uv') as AnyAttribute | undefined;
  const index = source.getIndex();
  const comps = paneComponents(pos.count, (i) => readVertex(pos, i), index ? (index.array as ArrayLike<number>) : null);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const paneUvs: number[] = [];
  const indices: number[] = [];
  for (const comp of comps) {
    if (comp.kind === 'drop') continue;
    const remap = new Map<number, number>();
    for (const v of comp.triangles) {
      let at = remap.get(v);
      if (at === undefined) {
        at = positions.length / 3;
        remap.set(v, at);
        const p = readVertex(pos, v);
        positions.push(p[0], p[1], p[2]);
        if (nor) normals.push(nor.getX(v), nor.getY(v), nor.getZ(v));
        uvs.push(uv ? uv.getX(v) : 0, uv ? uv.getY(v) : 0);
        const q = paneUvOf(comp, p);
        paneUvs.push(q[0], q[1]);
      }
      indices.push(at);
    }
  }
  if (indices.length === 0) return null;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setAttribute('paneUv', new THREE.Float32BufferAttribute(paneUvs, 2));
  out.setIndex(indices);
  if (nor) out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  else out.computeVertexNormals();
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** Kit glazing re-cut once per source geometry (a module cache, like the GLTF cache it derives from). */
const kitPaneCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry | null>();

/** The kit with every glazing primitive re-cut for the window shader (strips dropped). */
export function paintedKit(kit: KitModels): KitModels {
  const out = {} as KitModels;
  for (const bay of Object.keys(kit) as (keyof KitModels)[]) {
    out[bay] = kit[bay].flatMap((primitive) => {
      if (primitive.slot !== 'glass' && primitive.slot !== 'pane') return [primitive];
      let geometry = kitPaneCache.get(primitive.geometry);
      if (geometry === undefined) {
        geometry = withPaneUv(primitive.geometry);
        kitPaneCache.set(primitive.geometry, geometry);
      }
      return geometry ? [{ ...primitive, geometry }] : [];
    });
  }
  return out;
}

type SlotMaterials = Record<Exclude<Slot, 'glass' | 'lamp'>, THREE.MeshStandardMaterial> & {
  glass: THREE.MeshBasicMaterial;
  lamp: THREE.MeshBasicMaterial;
};

/**
 * Façade stone emission (LOOK-PLAN §1.2): the painted light carries the lit
 * side now, so the day self-glow drops to 0.03 (stone) / 0.02 (shade); night
 * keeps its values. The procedural fallback keeps its authored pair.
 */
const STONE_EMISSIVE = {
  scanned: { stone: { day: 0.03, night: 0.04 }, shade: { day: 0.02, night: 0.03 } },
  procedural: { stone: { day: 0.55, night: 0.08 }, shade: { day: 0.34, night: 0.06 } },
} as const;

/**
 * LOOK r4 (lead: "ashlar reads as bumpy, noisy stucco"): the painted
 * ashlar's own normal map carries the high-frequency grain, so the façade
 * takes it at about a third of the scan's strength — calm blocks; the
 * joints and the per-block value carry the form.
 */
export const ASHLAR_NORMAL_SCALE = 0.22;

/**
 * One material per slot, shared by the writer meshes and the instanced kit
 * modules so both read as the same stone under the same light. Keyed on the
 * TEXTURE SET only (and the block's bay phase): palette and night are
 * uniform writes in `useSlotLook`, so a theme switch never rebuilds — never
 * relinks — a façade. Stone and shade carry the painted ashlar patch.
 */
function useSlotMaterials(
  stoneM: SurfaceMaps,
  zincM: SurfaceMaps,
  scanned: boolean,
  bayPhase: number,
  lotBays: number,
): SlotMaterials {
  const materials = useMemo<SlotMaterials>(() => {
    const stone = mappedMaterial({
      maps: stoneM,
      fallback: '#e9dcc2',
      metalness: 0.02,
      roughness: scanned ? 0.92 : 0.86,
      normalScale: scanned ? ASHLAR_NORMAL_SCALE : 1,
      emissive: '#d8d0c0',
    });
    patchAshlar(stone, { bayPhase, lotBays });
    const shade = mappedMaterial({
      maps: stoneM,
      fallback: '#c9bda6',
      metalness: 0.02,
      roughness: 0.88,
      normalScale: scanned ? ASHLAR_NORMAL_SCALE : 1,
      emissive: '#b4a890',
    });
    patchAshlar(shade, { bayPhase, detail: 0.6, lotBays });
    return {
      stone,
      zinc: mappedMaterial({
        maps: zincM,
        fallback: scanned ? '#5c6470' : '#6a7380',
        metalness: scanned ? 0.18 : 0.62,
        roughness: scanned ? 0.72 : 0.42,
      }),
      iron: mappedMaterial({ maps: zincM, fallback: '#2a2622', metalness: 0.48, roughness: 0.46 }),
      glass: createWindowMaterial(false),
      lamp: createWindowMaterial(true),
      shade,
    };
  }, [stoneM, zincM, scanned, bayPhase, lotBays]);
  useEffect(
    () => () => {
      for (const slot of SLOTS) materials[slot].dispose();
    },
    [materials],
  );
  return materials;
}

/**
 * LOOK r6 (L3): the block's weathering frame for the ashlar — its top (the
 * cornice line, world y), the façade axis, and the weather gain: rain-wet
 * streaks read darker at night (1.3), day 1.
 */
export const ASHLAR_WEATHER = { day: 1, night: 1.3, cool: 1 } as const;

/** The block facts the ashlar's weathering reads (static per plan). */
export interface BlockWeatherFrame {
  top: number;
  /** 0: the façade runs along world x; 1: along world z. */
  axis: 0 | 1;
}

/**
 * Palette / night look of the slot materials — value writes only (colour,
 * emissive, roughness and env intensity are uniforms; `toneMapped` changes
 * no program while the scene renders into the composer target).
 *
 * Glass and lamp are the painted windows (LOOK r4, `createWindowMaterial`):
 * one shared uniform look (`writeWindowLook`); the lamp slot glows warm at
 * night only.
 */
export function writeSlotLook(
  materials: Pick<SlotMaterials, 'stone' | 'shade' | 'lamp'>,
  night: boolean,
  scanned: boolean,
  stoneTint: string,
  shadeTint: string,
  frame: BlockWeatherFrame | null = null,
): void {
  const table = scanned ? STONE_EMISSIVE.scanned : STONE_EMISSIVE.procedural;
  const time = night ? 'night' : 'day';
  materials.stone.color.set(stoneTint);
  materials.stone.emissiveIntensity = table.stone[time];
  materials.shade.color.set(shadeTint);
  materials.shade.emissiveIntensity = table.shade[time];
  // LOOK r6 (L1): the self-glow follows the block's own swatch — the fixed
  // `#d8d0c0` emissive diluted the per-building hue split.
  materials.stone.emissive.copy(materials.stone.color);
  materials.shade.emissive.copy(materials.shade.color);
  if (frame) {
    const weather = night ? ASHLAR_WEATHER.night : ASHLAR_WEATHER.day;
    for (const material of [materials.stone, materials.shade]) {
      writeAshlarBlock(material, { top: frame.top, weather, cool: ASHLAR_WEATHER.cool, axis: frame.axis });
    }
  }

  writeWindowLook(night);
  // The shipped `toneMapped: !night` of the lit panes (read only on the post-off ACES path).
  materials.lamp.toneMapped = !night;
}

function useSlotLook(
  materials: SlotMaterials,
  night: boolean,
  scanned: boolean,
  stoneTint: string,
  shadeTint: string,
  frame: BlockWeatherFrame,
): void {
  useLayoutEffect(() => {
    writeSlotLook(materials, night, scanned, stoneTint, shadeTint, frame);
  }, [materials, night, scanned, stoneTint, shadeTint, frame]);
}

class SlotWriter {
  private readonly pos: Record<Slot, number[]> = { stone: [], zinc: [], iron: [], glass: [], lamp: [], shade: [] };
  private readonly nor: Record<Slot, number[]> = { stone: [], zinc: [], iron: [], glass: [], lamp: [], shade: [] };
  private readonly uv: Record<Slot, number[]> = { stone: [], zinc: [], iron: [], glass: [], lamp: [], shade: [] };
  private readonly idx: Record<Slot, number[]> = { stone: [], zinc: [], iron: [], glass: [], lamp: [], shade: [] };
  private readonly base: Record<Slot, number> = { stone: 0, zinc: 0, iron: 0, glass: 0, lamp: 0, shade: 0 };

  box(
    slot: Slot,
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    rx = 0,
    rz = 0,
  ): void {
    const hx = w / 2;
    const hy = h / 2;
    const hz = d / 2;
    const faces: { n: [number, number, number]; q: [number, number, number][]; uvw: number; uvh: number }[] = [
      { n: [0, 0, 1], q: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], uvw: w, uvh: h },
      { n: [0, 0, -1], q: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], uvw: w, uvh: h },
      { n: [1, 0, 0], q: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]], uvw: d, uvh: h },
      { n: [-1, 0, 0], q: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]], uvw: d, uvh: h },
      { n: [0, 1, 0], q: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]], uvw: w, uvh: d },
      { n: [0, -1, 0], q: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]], uvw: w, uvh: d },
    ];

    const crx = Math.cos(rx);
    const srx = Math.sin(rx);
    const crz = Math.cos(rz);
    const srz = Math.sin(rz);
    const rot = (x: number, y: number, z: number): [number, number, number] => {
      let yy = y * crx - z * srx;
      const zz = y * srx + z * crx;
      const xx = x * crz - yy * srz;
      yy = x * srz + yy * crz;
      return [xx, yy, zz];
    };

    for (const face of faces) {
      const [nx, ny, nz] = rot(face.n[0], face.n[1], face.n[2]);
      const start = this.base[slot];
      for (let i = 0; i < 4; i += 1) {
        const [lx, ly, lz] = face.q[i];
        const [px, py, pz] = rot(lx, ly, lz);
        this.pos[slot].push(px + cx, py + cy, pz + cz);
        this.nor[slot].push(nx, ny, nz);
        const u = (i === 1 || i === 2 ? face.uvw : 0) / STONE_TILE;
        const v = (i === 2 || i === 3 ? face.uvh : 0) / STONE_TILE;
        this.uv[slot].push(u + (cx + cz) / STONE_TILE, v + cy / STONE_TILE);
      }
      this.idx[slot].push(start, start + 1, start + 2, start, start + 2, start + 3);
      this.base[slot] += 4;
    }
  }

  /** Planar lining face — used for splayed reveals that face the walking camera. */
  quad(
    slot: Slot,
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    c: readonly [number, number, number],
    d: readonly [number, number, number],
    uvw: number,
    uvh: number,
  ): void {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const adx = d[0] - a[0];
    const ady = d[1] - a[1];
    const adz = d[2] - a[2];
    let nx = aby * adz - abz * ady;
    let ny = abz * adx - abx * adz;
    let nz = abx * ady - aby * adx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const start = this.base[slot];
    const corners = [a, b, c, d];
    const uvs: readonly [number, number][] = [
      [0, 0],
      [uvw / STONE_TILE, 0],
      [uvw / STONE_TILE, uvh / STONE_TILE],
      [0, uvh / STONE_TILE],
    ];
    for (let i = 0; i < 4; i += 1) {
      const p = corners[i];
      this.pos[slot].push(p[0], p[1], p[2]);
      this.nor[slot].push(nx, ny, nz);
      this.uv[slot].push(uvs[i][0] + (p[0] + p[2]) / STONE_TILE, uvs[i][1] + p[1] / STONE_TILE);
    }
    this.idx[slot].push(start, start + 1, start + 2, start, start + 2, start + 3);
    this.base[slot] += 4;
  }

  /**
   * Fix r7: a planar facet (quad or trapezoid, corners counter-clockwise seen
   * from outside) with PLANAR-PROJECTED UVs — u along `uAxis`, v along
   * `vAxis` (unit vectors in the facet plane), both in `STONE_TILE` metres —
   * so slate courses run level along every roof slope and meet at the hips.
   */
  facet(
    slot: Slot,
    corners: readonly [Vec3, Vec3, Vec3, Vec3],
    uAxis: Vec3,
    vAxis: Vec3,
  ): void {
    const [a, b, , d] = corners;
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ad = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let nx = ab[1] * ad[2] - ab[2] * ad[1];
    let ny = ab[2] * ad[0] - ab[0] * ad[2];
    let nz = ab[0] * ad[1] - ab[1] * ad[0];
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const start = this.base[slot];
    for (const p of corners) {
      this.pos[slot].push(p[0], p[1], p[2]);
      this.nor[slot].push(nx, ny, nz);
      this.uv[slot].push(
        (p[0] * uAxis[0] + p[1] * uAxis[1] + p[2] * uAxis[2]) / STONE_TILE,
        (p[0] * vAxis[0] + p[1] * vAxis[1] + p[2] * vAxis[2]) / STONE_TILE,
      );
    }
    this.idx[slot].push(start, start + 1, start + 2, start, start + 2, start + 3);
    this.base[slot] += 4;
  }

  build(): Partial<Record<Slot, THREE.BufferGeometry>> {
    const out: Partial<Record<Slot, THREE.BufferGeometry>> = {};
    SLOTS.forEach((slot) => {
      if (this.base[slot] === 0) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos[slot], 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor[slot], 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv[slot], 2));
      geo.setIndex(this.idx[slot]);
      out[slot] = geo;
    });
    return out;
  }
}

function emitShadeCheeks(
  writer: SlotWriter,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  axis: 'z' | 'x',
): void {
  const splay = HAUSSMANN.revealSplay;
  if (axis === 'z') {
    writer.box('shade', x - w / 2 + splay / 2, y, z, splay, h, 0.07);
    writer.box('shade', x + w / 2 - splay / 2, y, z, splay, h, 0.07);
    return;
  }
  writer.box('shade', z, y, x - w / 2 + splay / 2, 0.07, h, splay);
  writer.box('shade', z, y, x + w / 2 - splay / 2, 0.07, h, splay);
}

function emitFrontWindow(writer: SlotWriter, volume: WindowVolume, frontZ: number): void {
  const { x, y, w, h, lit } = volume;
  const j = HAUSSMANN.jambWidth;
  const splay = HAUSSMANN.revealSplay;
  const recess = HAUSSMANN.windowRecess;
  const arch = HAUSSMANN.architrave;
  const backZ = frontZ - recess;
  const paneW = Math.max(0.28, w - splay * 2);
  const paneH = Math.max(0.36, h - splay * 2);
  const slant = Math.hypot(splay, recess);

  writer.box('stone', x - w / 2 - j / 2, y, frontZ + arch / 2, j, h + j * 2, arch);
  writer.box('stone', x + w / 2 + j / 2, y, frontZ + arch / 2, j, h + j * 2, arch);
  writer.box('stone', x, y + h / 2 + j / 2, frontZ + arch / 2, w + j * 2, j, arch);
  writer.box('stone', x, y - h / 2 - j / 2, frontZ + arch / 2, w + j * 2, j, arch);

  const xL0 = x - w / 2;
  const xR0 = x + w / 2;
  const yB0 = y - h / 2;
  const yT0 = y + h / 2;
  const xL1 = xL0 + splay;
  const xR1 = xR0 - splay;
  const yB1 = yB0 + splay;
  const yT1 = yT0 - splay;
  const revealZ = frontZ - 0.07;
  writer.quad('shade', [xL0, yB0, revealZ], [xL1, yB1, backZ], [xL1, yT1, backZ], [xL0, yT0, revealZ], slant, h);
  writer.quad('shade', [xR0, yB0, revealZ], [xR0, yT0, revealZ], [xR1, yT1, backZ], [xR1, yB1, backZ], slant, h);
  writer.quad('shade', [xL0, yT0, revealZ], [xL1, yT1, backZ], [xR1, yT1, backZ], [xR0, yT0, revealZ], w, slant);
  writer.quad('shade', [xL0, yB0, revealZ], [xR0, yB0, revealZ], [xR1, yB1, backZ], [xL1, yB1, backZ], w, slant);

  writer.box('iron', x, y, backZ - 0.02, paneW, paneH, 0.06);
  writer.box(lit ? 'lamp' : 'glass', x, y, backZ + 0.06, paneW - 0.08, paneH - 0.08, 0.03);
  writer.box('iron', x, y - h / 2 - 0.05, frontZ + 0.07, w + 0.28, 0.08, 0.16);
  if (lit) {
    writer.box('iron', x, y - h / 2 + 0.04, frontZ + 0.02, w + 0.06, 0.03, 0.04);
  }
}

/**
 * Procedural ground-floor shopfront (the defensive twin of the Blender
 * `bay-shopfront` kit module — ADR-0001; same authoring contract: origin on
 * the storey floor line, bay-centred, front on the façade plane). Piers with
 * plinth and capital carry the jamb depth, the stall riser and recessed glass
 * the interior depth, the fascia a lit sign band. Coursing comes from the
 * shared stone maps the piers sample — never a flat slab.
 */
function emitShopfront(writer: SlotWriter, volume: WindowVolume, frontZ: number): void {
  const { x, lit } = volume;
  const w = HAUSSMANN.bayWidth;
  const pierW = 0.5;
  const pierH = 3.42;
  const glassW = w - pierW * 2 - 0.16;
  const riserH = 0.5;
  const glassY0 = riserH;
  const glassY1 = 2.78;
  const recess = 0.42;
  const splay = 0.1;

  for (const side of [-1, 1]) {
    const px = x + side * (w / 2 - pierW / 2 - 0.04);
    writer.box('stone', px, pierH / 2, frontZ + 0.02, pierW, pierH, 0.2);
    // Plinth and capital give the pier an entasis-less but modelled section.
    writer.box('stone', px, 0.3, frontZ + 0.04, pierW + 0.1, 0.6, 0.26);
    writer.box('stone', px, pierH - 0.09, frontZ + 0.04, pierW + 0.1, 0.18, 0.26);
  }

  // Stall riser between the piers, slightly recessed.
  writer.box('stone', x, riserH / 2, frontZ - 0.03, glassW, riserH, 0.2);

  // Splayed reveal from the opening edge back to the recessed glazing plane.
  const backZ = frontZ - recess;
  const xL0 = x - glassW / 2;
  const xR0 = x + glassW / 2;
  const yB0 = glassY0;
  const yT0 = glassY1;
  const xL1 = xL0 + splay;
  const xR1 = xR0 - splay;
  const yB1 = yB0 + splay;
  const yT1 = yT0 - splay;
  const slant = Math.hypot(splay, recess);
  writer.quad('shade', [xL0, yB0, frontZ], [xL1, yB1, backZ], [xL1, yT1, backZ], [xL0, yT0, frontZ], slant, yT0 - yB0);
  writer.quad('shade', [xR0, yB0, frontZ], [xR0, yT0, frontZ], [xR1, yT1, backZ], [xR1, yB1, backZ], slant, yT0 - yB0);
  writer.quad('shade', [xL0, yT0, frontZ], [xL1, yT1, backZ], [xR1, yT1, backZ], [xR0, yT0, frontZ], glassW, slant);
  writer.quad('shade', [xL0, yB0, frontZ], [xR0, yB0, frontZ], [xR1, yB1, backZ], [xL1, yB1, backZ], glassW, slant);

  // Iron shopfront frame: jambs, centre mullion, transom at door-head height.
  writer.box('iron', x, (glassY0 + glassY1) / 2, backZ + 0.02, glassW, glassY1 - glassY0, 0.07);
  writer.box('iron', x, (glassY0 + glassY1) / 2, backZ + 0.05, 0.06, glassY1 - glassY0, 0.05);
  writer.box('iron', x, 2.12, backZ + 0.05, glassW - 0.04, 0.07, 0.05);

  // Glowing interior: shop glass with a warm back room behind it.
  writer.box(lit ? 'lamp' : 'glass', x, (glassY0 + glassY1) / 2, backZ + 0.09, glassW - 0.1, glassY1 - glassY0 - 0.1, 0.04);

  // Fascia sign band between the pier capitals, its strip lit at night.
  writer.box('stone', x, 3.1, frontZ + 0.03, w - 0.24, 0.64, 0.18);
  writer.box(lit ? 'lamp' : 'glass', x, 3.1, frontZ + 0.13, w - 1.5, 0.34, 0.05);
  for (const side of [-1, 1]) {
    writer.box('stone', x + side * (w / 2 - pierW - 0.12), 2.66, frontZ + 0.05, 0.16, 0.24, 0.2);
  }
}

function emitVoidWindow(writer: SlotWriter, volume: WindowVolume): void {
  const sign = volume.voidSign ?? 1;
  const { x, y, w, h, lit } = volume;
  const j = HAUSSMANN.jambWidth;
  const splay = HAUSSMANN.revealSplay;
  const recess = HAUSSMANN.windowRecess;
  const arch = HAUSSMANN.architrave;
  const faceX = x;
  const backX = faceX - sign * recess;
  const paneW = Math.max(0.28, w - splay * 2);
  const paneH = Math.max(0.36, h - splay * 2);
  const slant = Math.hypot(splay, recess);

  writer.box('stone', faceX + sign * (arch / 2), y, -w / 2 - j / 2, arch, h + j * 2, j);
  writer.box('stone', faceX + sign * (arch / 2), y, w / 2 + j / 2, arch, h + j * 2, j);
  writer.box('stone', faceX + sign * (arch / 2), y + h / 2 + j / 2, 0, arch, j, w + j * 2);
  writer.box('stone', faceX + sign * (arch / 2), y - h / 2 - j / 2, 0, arch, j, w + j * 2);

  const zL0 = -w / 2;
  const zR0 = w / 2;
  const yB0 = y - h / 2;
  const yT0 = y + h / 2;
  const zL1 = zL0 + splay;
  const zR1 = zR0 - splay;
  const yB1 = yB0 + splay;
  const yT1 = yT0 - splay;
  const revealX = faceX - sign * 0.07;
  writer.quad('shade', [revealX, yB0, zL0], [backX, yB1, zL1], [backX, yT1, zL1], [revealX, yT0, zL0], slant, h);
  writer.quad('shade', [revealX, yB0, zR0], [revealX, yT0, zR0], [backX, yT1, zR1], [backX, yB1, zR1], slant, h);
  writer.quad('shade', [revealX, yT0, zL0], [backX, yT1, zL1], [backX, yT1, zR1], [revealX, yT0, zR0], w, slant);
  writer.quad('shade', [revealX, yB0, zL0], [revealX, yB0, zR0], [backX, yB1, zR1], [backX, yB1, zL1], w, slant);
  emitShadeCheeks(writer, 0, y, faceX - sign * 0.03, w, h, 'x');

  writer.box('iron', backX - sign * 0.03, y, 0, 0.06, paneH, paneW);
  writer.box(lit ? 'lamp' : 'glass', backX + sign * 0.05, y, 0, 0.03, paneH - 0.08, paneW - 0.08);
}

function emitBalcony(writer: SlotWriter, x: number, y: number, frontZ: number): void {
  const depth = HAUSSMANN.balconyDepth;
  const width = HAUSSMANN.windowW + 0.42;
  writer.box('iron', x, y, frontZ + depth, width, 0.06, depth * 2);
  writer.box('iron', x, y + 0.42, frontZ + depth * 1.6, width, 0.045, 0.045);
  for (const ox of [-width * 0.38, -width * 0.12, width * 0.12, width * 0.38]) {
    writer.box('iron', x + ox, y + 0.22, frontZ + depth * 1.65, 0.035, 0.4, 0.035);
  }
}

/** Fix r7: the deck's zinc lip past the slopes' top edge (the brisis moulding), metres per side. */
export const MANSARD_DECK_LIP = 0.1;

/**
 * Fix r7 (D31 #1): a HIPPED mansard — four slopes rising from the eave
 * rectangle inward by `inset` to a flat deck (`mansardSurfaceY`, haussmann.ts),
 * so the roof closes at the block ends. Pre-r7 the slope plates were tilted
 * the wrong way: the long slopes flared OUTWARD and the end slopes hung up to
 * 1.6 m past the block ends (the grey slabs in the rules sky gap).
 */
function emitMansard(writer: SlotWriter, spec: MansardSpec, ox: number): void {
  const { baseY, width, depth, rise, inset } = spec;
  const topY = baseY + rise;
  const slopeLen = Math.hypot(inset, rise);
  const up = rise / slopeLen;
  const run = inset / slopeLen;
  const x0 = ox - width / 2;
  const x1 = ox + width / 2;
  const z0 = -depth / 2;
  const z1 = depth / 2;
  const u0 = x0 + inset;
  const u1 = x1 - inset;
  const w0 = z0 + inset;
  const w1 = z1 - inset;
  // Front (+z), back (−z), then the two hips (−x, +x): counter-clockwise from outside.
  writer.facet('zinc', [[x0, baseY, z1], [x1, baseY, z1], [u1, topY, w1], [u0, topY, w1]], [1, 0, 0], [0, up, -run]);
  writer.facet('zinc', [[x1, baseY, z0], [x0, baseY, z0], [u0, topY, w0], [u1, topY, w0]], [-1, 0, 0], [0, up, run]);
  writer.facet('zinc', [[x0, baseY, z0], [x0, baseY, z1], [u0, topY, w1], [u0, topY, w0]], [0, 0, 1], [run, up, 0]);
  writer.facet('zinc', [[x1, baseY, z1], [x1, baseY, z0], [u1, topY, w0], [u1, topY, w1]], [0, 0, -1], [-run, up, 0]);
  // The deck, a thin zinc slab with a small lip over the break.
  const lip = MANSARD_DECK_LIP;
  writer.box('zinc', ox, topY + 0.04, 0, u1 - u0 + lip * 2, 0.08, w1 - w0 + lip * 2);
}

/**
 * The ridge stack: its top where it always was; its root (`chimneyRoot`)
 * reaches into the roof, so a stack that straddles the hip break rises out
 * of the slope instead of hanging over it (fix r7, D31 #2).
 */
function emitChimney(writer: SlotWriter, x: number, y: number, z: number): void {
  const { chimneyW: w, chimneyD: d, chimneyH: h, chimneyRoot: root } = HAUSSMANN;
  writer.box('stone', x, y - root / 2, z, w, h + root, d);
  writer.box('zinc', x, y + h / 2 + 0.1, z, w * 0.72, 0.2, d * 0.72);
}

/**
 * The lucarne (mansard dormer) — fix r7, D31 #2. The kit `dormer` module was
 * a SOLID stone block with its window buried inside it and its hood pitched
 * the wrong way (a V); on the flared pre-r7 roof it hung in front of the
 * slope as the "floating brick block" above the rules gate. The writer now
 * builds the dormer on both paths, seated by `dormerSeat` on the hipped slope:
 * a stone surround (jambs, sill, lintel, pediment) framing a recessed painted
 * window (the `glass` slot's window shader), zinc cheeks and a pitched ^ hood
 * running back into the roof (the envelope covers its whole back end).
 */
export const LUCARNE = {
  width: 0.92,
  /** Footing to the hood's eave. */
  frontH: 1.05,
  /** Cheeks and hood run this far back from the front plane (into the roof). */
  depth: 0.8,
  jamb: 0.16,
  /** Hood rise at the ridge above its eave; the hood's side / front overhangs. */
  hoodRise: 0.34,
  hoodSide: 0.06,
  hoodFront: 0.08,
} as const;

function emitDormer(writer: SlotWriter, x: number, spec: MansardSpec): void {
  const { footY, frontZ } = dormerSeat(spec);
  const { width: w, frontH, depth, jamb, hoodRise, hoodSide, hoodFront } = LUCARNE;
  const eaveY = footY + frontH;
  const surroundD = 0.14;
  const surroundZ = frontZ - surroundD / 2;
  // Stone surround: jambs, sill, lintel.
  for (const side of [-1, 1]) {
    writer.box('stone', x + side * (w / 2 - jamb / 2), footY + frontH / 2, surroundZ, jamb, frontH, surroundD);
  }
  writer.box('stone', x, footY + 0.05, surroundZ + 0.02, w + 0.04, 0.1, surroundD + 0.04);
  writer.box('stone', x, eaveY - 0.07, surroundZ, w, 0.14, surroundD);
  // The recessed window (the painted pane) and the iron frame behind it.
  const openW = w - jamb * 2;
  const openY0 = footY + 0.1;
  const openY1 = eaveY - 0.14;
  const paneZ = frontZ - 0.12;
  writer.box('iron', x, (openY0 + openY1) / 2, paneZ - 0.03, openW, openY1 - openY0, 0.03);
  writer.box('glass', x, (openY0 + openY1) / 2, paneZ, openW - 0.04, openY1 - openY0 - 0.04, 0.03);
  // Zinc cheeks back into the roof.
  for (const side of [-1, 1]) {
    writer.box('zinc', x + side * (w / 2 - 0.025), footY + frontH / 2, frontZ - surroundD - (depth - surroundD) / 2, 0.05, frontH, depth - surroundD);
  }
  // Stone pediment (the front gable under the hood).
  const ridgeY = eaveY + hoodRise;
  writer.facet(
    'stone',
    [[x - w / 2, eaveY, frontZ], [x + w / 2, eaveY, frontZ], [x, ridgeY - 0.04, frontZ], [x, ridgeY - 0.04, frontZ]],
    [1, 0, 0],
    [0, 1, 0],
  );
  // Pitched ^ hood: two zinc slabs meeting on the ridge (boxes — seen from below, their undersides draw).
  const half = w / 2 + hoodSide;
  const slab = Math.hypot(half, hoodRise);
  const pitch = Math.atan2(hoodRise, half);
  const zf = frontZ + hoodFront;
  const zb = frontZ - depth;
  for (const side of [-1, 1]) {
    writer.box('zinc', x + (side * half) / 2, eaveY + hoodRise / 2, (zf + zb) / 2, slab, 0.05, zf - zb, 0, -side * pitch);
  }
}

function emitLedJambs(writer: SlotWriter, led: LedSpec, frontZ: number): void {
  const { x, y, w, h, recess } = led;
  const j = HAUSSMANN.jambWidth * 1.4;
  const midZ = frontZ - recess / 2;
  writer.box('stone', x - w / 2 - j / 2, y, midZ, j, h + j * 2, recess);
  writer.box('stone', x + w / 2 + j / 2, y, midZ, j, h + j * 2, recess);
  writer.box('stone', x, y + h / 2 + j / 2, midZ, w, j, recess);
  writer.box('stone', x, y - h / 2 - j / 2, midZ, w, j, recess);
}

function overlapsLed(x: number, y: number, w: number, h: number, leds: LedSpec[]): boolean {
  return leds.some(
    (led) => Math.abs(x - led.x) < (w + led.w) / 2 - 0.04 && Math.abs(y - led.y) < (h + led.h) / 2 - 0.04,
  );
}

function emitBand(
  writer: SlotWriter,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  leds: LedSpec[],
): void {
  if (w < 0.08 || h < 0.08) return;
  const hit = leds.find(
    (led) => Math.abs(x - led.x) < (w + led.w) / 2 - 0.02 && Math.abs(y - led.y) < (h + led.h) / 2 - 0.02,
  );
  if (!hit) {
    writer.box('stone', x, y, z, w, h, d);
    return;
  }
  const left = x - w / 2;
  const right = x + w / 2;
  const ledL = hit.x - hit.w / 2;
  const ledR = hit.x + hit.w / 2;
  emitBand(writer, (left + ledL) / 2, y, z, ledL - left, h, d, []);
  emitBand(writer, (ledR + right) / 2, y, z, right - ledR, h, d, []);
}

function emitWingInfill(
  writer: SlotWriter,
  wing: MassWing,
  leds: LedSpec[],
  frontZ: number,
): void {
  const storeys = Math.round((wing.h - HAUSSMANN.podiumHeight) / HAUSSMANN.floorHeight) + 1;
  const d = HAUSSMANN.recessDepth * 0.7;
  const z = frontZ - d / 2;
  const left = wing.x - wing.w / 2;
  const right = wing.x + wing.w / 2;

  for (let floor = 0; floor < storeys; floor += 1) {
    const winY =
      floor === 0
        ? HAUSSMANN.sill + 0.62
        : HAUSSMANN.podiumHeight + (floor - 1) * HAUSSMANN.floorHeight + HAUSSMANN.sill;
    const winH =
      floor === 0 ? HAUSSMANN.windowH + 0.28 : floor >= 3 ? HAUSSMANN.windowH - 0.18 : HAUSSMANN.windowH;
    const winW =
      floor === 0 ? HAUSSMANN.windowW + 0.08 : floor >= 3 ? HAUSSMANN.windowW - 0.06 : HAUSSMANN.windowW;
    const floorBottom = floor === 0 ? 0 : HAUSSMANN.podiumHeight + (floor - 1) * HAUSSMANN.floorHeight;
    const floorTop = floor === 0 ? HAUSSMANN.podiumHeight : floorBottom + HAUSSMANN.floorHeight;
    const sillY = winY - winH / 2;
    const headY = winY + winH / 2;

    emitBand(writer, wing.x, (floorBottom + sillY) / 2, z, wing.w, sillY - floorBottom, d, leds);
    emitBand(writer, wing.x, (headY + floorTop) / 2, z, wing.w, floorTop - headY, d, leds);

    for (let bay = wing.startBay; bay < wing.endBay; bay += 1) {
      const local = bay - wing.startBay;
      const winX = left + (local + 0.5) * HAUSSMANN.bayWidth;
      if (overlapsLed(winX, winY, winW, winH, leds)) continue;
      const pierLeft = local === 0 ? left : winX - HAUSSMANN.bayWidth / 2;
      const pierRight = winX - winW / 2;
      emitBand(writer, (pierLeft + pierRight) / 2, winY, z, pierRight - pierLeft, winH + 0.1, d, leds);
      emitShadeCheeks(writer, winX, winY, frontZ - 0.03, winW, winH, 'z');
    }
    const lastLocal = wing.endBay - wing.startBay - 1;
    const lastX = left + (lastLocal + 0.5) * HAUSSMANN.bayWidth;
    if (!overlapsLed(lastX, winY, winW, winH, leds)) {
      emitBand(writer, (lastX + winW / 2 + right) / 2, winY, z, right - (lastX + winW / 2), winH + 0.1, d, leds);
    }
  }
}

function compileSlots(
  plan: BlockPlan,
  wings: MassWing[],
  facade: ReturnType<typeof compileFacade>,
  placements: ReturnType<typeof planBlock>,
  leds: LedSpec[],
  /** Kit modules stand in for front windows and balconies. */
  kit: boolean,
): Partial<Record<Slot, THREE.BufferGeometry>> {
  const writer = new SlotWriter();
  const frontZ = plan.depth / 2;
  const recess = HAUSSMANN.recessDepth;
  const height = blockHeight(plan);
  const storeys = plan.upperFloors + 1;

  for (const wing of wings) {
    writer.box('stone', wing.x, wing.y, -recess / 2, wing.w, wing.h, wing.d - recess);
    writer.box(
      'stone',
      wing.x,
      HAUSSMANN.sill / 2,
      frontZ - 0.08,
      wing.w + 0.12,
      HAUSSMANN.sill,
      0.28,
    );
    writer.box(
      'stone',
      wing.x,
      height + HAUSSMANN.cornice / 2,
      0,
      wing.w + 0.32,
      HAUSSMANN.cornice,
      wing.d + 0.3,
    );

    emitWingInfill(writer, wing, leds, frontZ);

    for (let floor = 0; floor < storeys; floor += 1) {
      const bandY =
        floor === 0
          ? HAUSSMANN.podiumHeight
          : HAUSSMANN.podiumHeight + floor * HAUSSMANN.floorHeight;
      emitBand(
        writer,
        wing.x,
        bandY,
        frontZ + HAUSSMANN.string / 2,
        wing.w,
        0.16,
        HAUSSMANN.string,
        leds,
      );
    }

    const roof = mansardSpecForWing(plan, wing);
    if (roof) {
      emitMansard(writer, roof, wing.x);
      // Fix r7: the writer's lucarne on both paths (the kit dormer module is no longer placed).
      emitDormer(writer, wing.x, roof);
    }
  }

  for (const volume of facade.windows) {
    if (volume.face === 'void') emitVoidWindow(writer, volume);
    else if (!kit) {
      // Ground bays the grammar routes to shopfronts get the authored
      // procedural twin of the `bay-shopfront` kit module (defensive path —
      // the kit may be absent from the manifest).
      const floor = floorOfVolume(volume);
      if (floor === 0 && isShopfrontBay(plan, bayOfX(plan, volume.x))) {
        emitShopfront(writer, volume, frontZ);
      } else {
        emitFrontWindow(writer, volume, frontZ);
      }
    }
  }

  for (const placement of placements) {
    if (placement.module === 'balcony' && !kit) {
      emitBalcony(writer, placement.x, placement.y, frontZ);
    }
    if (placement.module === 'chimney') {
      emitChimney(writer, placement.x, placement.y, placement.z ?? 0);
    }
  }

  for (let bay = 0; bay < plan.widthBays; bay += 2) {
    const wing = wings.find((item) => bay >= item.startBay && bay < item.endBay);
    if (!wing) continue;
    const x = wing.x - wing.w / 2 + (bay - wing.startBay + 0.08) * HAUSSMANN.bayWidth;
    if (overlapsLed(x, height / 2, 0.22, height - 0.4, leds)) continue;
    writer.box('stone', x, height / 2, frontZ + HAUSSMANN.pilaster / 2, 0.22, height - 0.4, HAUSSMANN.pilaster);
  }

  for (const led of leds) {
    emitLedJambs(writer, led, frontZ);
  }

  const built = writer.build();
  // LOOK r4: the writer's glazing carries pane-space UVs for the window shader.
  for (const slot of ['glass', 'lamp'] as const) {
    const geo = built[slot];
    if (!geo) continue;
    const cut = withPaneUv(geo);
    geo.dispose();
    if (cut) built[slot] = cut;
    else delete built[slot];
  }
  return built;
}

/**
 * The block's material-slot geometry as the component compiles it (block-local
 * frame) — for the roof-closure and no-floating-geometry laws
 * (`__tests__/mansard-closure.test.ts`). `kit` true is the shipped path.
 */
export function compileBlockSlots(plan: BlockPlan, kit: boolean): Partial<Record<Slot, THREE.BufferGeometry>> {
  return compileSlots(plan, massWings(plan), compileFacade(plan), planBlock(plan), ledSpecs(plan), kit);
}

/**
 * The façade LED's wash on the stone at full crest-wall emission. Fidelity
 * wave 2 r2 (2F LUMA, WAVE-PLAN §1 plaza teams): the wall now shows the
 * league's ace crests at `CREST_EMISSIVE` (40 %) instead of the mascot
 * silhouette at 2.0–2.2, so its light is scaled by the same ratio — the wall
 * is chrome under the boards, and so is its spill (§5.10).
 */
const CREST_LIGHT_NIGHT = (4.5 * CREST_EMISSIVE) / 2.2;
const CREST_LIGHT_DAY = (1.8 * CREST_EMISSIVE) / 2.0;

/**
 * Fix r7 (D31 #3): only the east LED — the TEAMS crest wall, the seat
 * `teams-formation` projects — paints the banner words. The south-west LED
 * is no station's face; seen only from the rules pose (cropped at the right
 * edge, behind the linden), it shows the crests without words.
 */
export function crestWallWords(planId: string): boolean {
  return planId === 'east';
}

/**
 * One façade LED seat. The content plane is the teams crest carousel
 * (`LedCrestWall`). (The night-keyed pictorial silhouette map the block used
 * to paint for it was never shown and is gone — LOOK-PLAN §2 S.3.)
 */
function PictorialLed({
  spec,
  frontZ,
  night,
  words,
}: {
  spec: LedSpec;
  frontZ: number;
  night: boolean;
  words: boolean;
}) {
  const backZ = frontZ - spec.recess + 0.14;
  return (
    <group>
      <group position={[spec.x, spec.y, backZ]}>
        <LedCrestWall width={spec.w - 0.12} height={spec.h - 0.12} night={night} words={words} />
      </group>
      <pointLight
        position={[spec.x, spec.y, frontZ + 0.9]}
        color="#f4f0e4"
        intensity={night ? CREST_LIGHT_NIGHT : CREST_LIGHT_DAY}
        distance={10}
      />
    </group>
  );
}

/**
 * Material-slot writer for one BlockPlan. Mass wings own the through-void;
 * window / balcony / chimney / LED modules own their depth.
 */
export default function HaussmannBlock({
  plan,
  stone,
  night,
  scanned = null,
  kit = null,
}: {
  plan: BlockPlan;
  stone: string;
  night: boolean;
  /** Scanned (painted) ashlar / slate; `null` keeps the procedural maps. */
  scanned?: FacadeMaps | null;
  /** Blender façade modules; `null` keeps the writer's procedural windows. */
  kit?: KitModels | null;
}) {
  const stoneM = useProceduralSurface(stoneFactory, scanned?.stone ?? null);
  const zincM = useProceduralSurface(zincFactory, scanned?.zinc ?? null);
  // Scanned plaster is neutral grey; the tint carries Lutetian-limestone cream.
  // LOOK r6 (L1): each block wears its own limestone swatch
  // (`PLAZA_BLOCK_TINTS`, theme-palette.ts) — ivory, grey, honey, cream —
  // instead of one honey for all five (uniform writes; unknown ids keep r5's).
  const blockTint = plazaBlockTint(plan.id, night);
  const stoneTint = scanned ? blockTint.stone : night ? stone : '#f3ead8';
  const shadeTint = scanned ? blockTint.shade : night ? '#9a8e7c' : '#d2c6b2';
  const bayPhase = useMemo(() => blockBayPhase(plan), [plan]);
  const lotBays = useMemo(() => blockLotBays(plan), [plan]);
  const frame = useMemo(() => blockWeatherFrame(plan), [plan]);
  const materials = useSlotMaterials(stoneM, zincM, scanned !== null, bayPhase, lotBays);
  useSlotLook(materials, night, scanned !== null, stoneTint, shadeTint, frame);

  const wings = useMemo(() => massWings(plan), [plan]);
  const placements = useMemo(() => planBlock(plan), [plan]);
  const facade = useMemo(() => compileFacade(plan), [plan]);
  const leds = useMemo(() => ledSpecs(plan), [plan]);
  const slots = useMemo(
    () => compileSlots(plan, wings, facade, placements, leds, kit !== null),
    [plan, wings, facade, placements, leds, kit],
  );
  const frontZ = plan.depth / 2;
  const windowKit = useMemo(() => (kit ? paintedKit(kit) : null), [kit]);

  useEffect(
    () => () => {
      slots.stone?.dispose();
      slots.zinc?.dispose();
      slots.iron?.dispose();
      slots.glass?.dispose();
      slots.lamp?.dispose();
      slots.shade?.dispose();
    },
    [slots],
  );

  return (
    <group position={[...plan.origin]} rotation={[0, plan.rotationY, 0]}>
      {slots.stone ? <mesh geometry={slots.stone} material={materials.stone} castShadow receiveShadow /> : null}
      {slots.zinc ? <mesh geometry={slots.zinc} material={materials.zinc} castShadow /> : null}
      {slots.iron ? <mesh geometry={slots.iron} material={materials.iron} /> : null}
      {slots.glass ? <mesh geometry={slots.glass} material={materials.glass} /> : null}
      {slots.lamp ? <mesh geometry={slots.lamp} material={materials.lamp} /> : null}
      {slots.shade ? <mesh geometry={slots.shade} material={materials.shade} castShadow receiveShadow /> : null}
      {windowKit ? <KitBays plan={plan} kit={windowKit} materials={materials satisfies KitMaterials} /> : null}
      {leds.map((spec) => (
        <PictorialLed key={`${plan.id}-${spec.x}`} spec={spec} frontZ={frontZ} night={night} words={crestWallWords(plan.id)} />
      ))}
    </group>
  );
}

/** Procedural fallbacks, day pigment (module-stable factories). */
const stoneFactory = () => stoneMaps(false, 1);
const zincFactory = () => zincMaps(false, 3);

/**
 * World phase (m, along the wall) of the block's window-bay centres — the
 * ashlar's sill streaks hang under the windows, not between them.
 */
export function blockBayPhase(plan: BlockPlan): number {
  const x0 = 0.5 * HAUSSMANN.bayWidth - (plan.widthBays * HAUSSMANN.bayWidth) / 2;
  const a = blockToWorld(plan, x0, 0, plan.depth / 2);
  const b = blockToWorld(plan, x0 + 1, 0, plan.depth / 2);
  return Math.abs(b[0] - a[0]) > Math.abs(b[2] - a[2]) ? a[0] : a[2];
}

/** LOOK r6 (L1): a lot every this many bays along a façade (seams on the pilasters). */
export const FACADE_LOT_BAYS = 4;

/**
 * The ashlar's signed lot width in bays: `FACADE_LOT_BAYS`, negative when the
 * world coordinate along the wall DEcreases with the block-local x (the
 * shader offsets the seams toward each bay's pilaster with this sign).
 */
export function blockLotBays(plan: BlockPlan): number {
  const a = blockToWorld(plan, 0, 0, plan.depth / 2);
  const b = blockToWorld(plan, 1, 0, plan.depth / 2);
  const alongX = Math.abs(b[0] - a[0]) > Math.abs(b[2] - a[2]);
  const d = alongX ? b[0] - a[0] : b[2] - a[2];
  return d >= 0 ? FACADE_LOT_BAYS : -FACADE_LOT_BAYS;
}

/** The block's weathering frame: its cornice line (world y) and façade axis. */
export function blockWeatherFrame(plan: BlockPlan): BlockWeatherFrame {
  const a = blockToWorld(plan, 0, 0, plan.depth / 2);
  const b = blockToWorld(plan, 1, 0, plan.depth / 2);
  return { top: plan.origin[1] + blockHeight(plan), axis: Math.abs(b[0] - a[0]) > Math.abs(b[2] - a[2]) ? 0 : 1 };
}
