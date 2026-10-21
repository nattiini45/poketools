/**
 * World-space calm boxes (ROLLOUT §2.2 l): the façade half of the keep-out
 * law, moved out of the plaza's `paint-ashlar.ts` (which re-exports every
 * name with identical strings) so any painted world's stone can flatten its
 * detail behind a data face. Behind every data face, at every pose the face
 * is read from (desktop, 768, landed 390, focus and the dolly), a surface
 * that multiplies its detail by `1 − ashCalmAt(worldPos)` is flat.
 *
 * - The boxes themselves are pure maths (`calmBoxesFor`, `pointInCalmBoxes`
 *   in `data-surfaces.ts`, re-exported here).
 * - ONE shared uniform set (`CALM_BOX_UNIFORMS`, bound by reference) carries
 *   up to `CALM_BOX_MAX` boxes; `writeCalmBoxes` fills it (value writes).
 * - The GLSL keeps the pilot's names (`uAshCalm*`, `ashCalmAt`): renaming them
 *   would change the plaza's ashlar program.
 */

import * as THREE from 'three';
import { CALM_BOX_MAX, type CalmBox } from '@/lib/route-world/data-surfaces';

export { CALM_BOX_MAX, calmBoxesFor, pointInCalmBoxes, type CalmBackdrop, type CalmBox } from '@/lib/route-world/data-surfaces';

/** Calm-box feather (m): detail fades back in over this distance outside a box. */
export const CALM_BOX_FEATHER_M = 0.6;

/** The shared calm-box uniforms (the pilot's `uAshCalm*` names). */
export interface CalmBoxUniforms {
  uAshCalmMin: { value: THREE.Vector3[] };
  uAshCalmMax: { value: THREE.Vector3[] };
  uAshCalmCount: { value: number };
  uAshCalmFeather: { value: number };
}

export function createCalmBoxUniforms(): CalmBoxUniforms {
  return {
    uAshCalmMin: { value: Array.from({ length: CALM_BOX_MAX }, () => new THREE.Vector3()) },
    uAshCalmMax: { value: Array.from({ length: CALM_BOX_MAX }, () => new THREE.Vector3()) },
    uAshCalmCount: { value: 0 },
    uAshCalmFeather: { value: CALM_BOX_FEATHER_M },
  };
}

/** The one shared calm set every calm-box program binds (by reference). */
export const CALM_BOX_UNIFORMS: CalmBoxUniforms = createCalmBoxUniforms();

/** Write calm boxes into the shared slots (unused slots zeroed). */
export function writeCalmBoxes(boxes: readonly CalmBox[], shared: CalmBoxUniforms = CALM_BOX_UNIFORMS): number {
  const count = Math.min(boxes.length, CALM_BOX_MAX);
  for (let i = 0; i < CALM_BOX_MAX; i += 1) {
    const box = i < count ? boxes[i] : null;
    if (box) {
      shared.uAshCalmMin.value[i].set(box.min[0], box.min[1], box.min[2]);
      shared.uAshCalmMax.value[i].set(box.max[0], box.max[1], box.max[2]);
    } else {
      shared.uAshCalmMin.value[i].set(0, 0, 0);
      shared.uAshCalmMax.value[i].set(0, 0, 0);
    }
  }
  shared.uAshCalmCount.value = count;
  return count;
}

/** Bind the shared calm-box uniforms into a program's uniforms (by reference). */
export function bindCalmBoxUniforms(target: Record<string, THREE.IUniform>, shared: CalmBoxUniforms = CALM_BOX_UNIFORMS): void {
  target.uAshCalmMin = shared.uAshCalmMin;
  target.uAshCalmMax = shared.uAshCalmMax;
  target.uAshCalmCount = shared.uAshCalmCount;
  target.uAshCalmFeather = shared.uAshCalmFeather;
}

/** The calm-box uniform declarations (GLSL). */
export const CALM_BOX_UNIFORMS_GLSL = /* glsl */ `uniform vec3 uAshCalmMin[ ${CALM_BOX_MAX} ];
uniform vec3 uAshCalmMax[ ${CALM_BOX_MAX} ];
uniform float uAshCalmCount;
uniform float uAshCalmFeather;
`;

/** `ashCalmAt(worldPos)`: 1 inside any live box, feathered to 0 over `uAshCalmFeather` metres (GLSL). */
export const CALM_BOX_FN_GLSL = /* glsl */ `float ashCalmAt( vec3 p ) {
	float calm = 0.0;
	for ( int i = 0; i < ${CALM_BOX_MAX}; i ++ ) {
		if ( float( i ) >= uAshCalmCount ) break;
		vec3 d = max( uAshCalmMin[ i ] - p, p - uAshCalmMax[ i ] );
		float outside = max( max( d.x, d.y ), d.z );
		calm = max( calm, 1.0 - smoothstep( 0.0, max( uAshCalmFeather, 1e-3 ), outside ) );
	}
	return calm;
}
`;
