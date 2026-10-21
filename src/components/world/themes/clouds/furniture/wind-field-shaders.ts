import { PARTICLE_DISCIPLINE_GLSL } from '@/lib/route-world/particle-discipline';

/**
 * The wind field's GLSL, split out of `WindField.tsx` so node tests can pin
 * the W1 contract on the shader text (pure — no client-only imports).
 *
 * W1 particle discipline, review round 2: the CONTENT CORRIDOR term is
 * evaluated PER FRAGMENT from an interpolated world position (`vWorld`),
 * not per vertex. The round-1 per-vertex form interpolated one `vFade`
 * between the streak's two ends, so a streak whose ends both lay outside
 * the wedge drew full strength straight across the data face (the clouds
 * pulse-board streak the round-1 judges cropped). World position is linear
 * along a line segment, so the per-fragment test is exact for every pixel
 * the streak covers. The near-lens fade and the station-density keep stay
 * per vertex: both vary smoothly along a ≤ 2.5 m streak and neither can
 * paint a face that the corridor term clears.
 */

export const WIND_FIELD_SPAN = 64;

export const WIND_VERTEX = /* glsl */ `
  attribute float aSeed;
  attribute vec3 aOffset;
  uniform float uTime;
  varying float vSeed;
  varying float vFade;
  varying vec3 vWorld;
  ${PARTICLE_DISCIPLINE_GLSL}

  void main() {
    vSeed = aSeed;
    // Each streak runs downwind and loops inside the field volume; the two
    // vertices of one segment share aSeed/aOffset, and the built-in
    // position attribute carries the segment's length offset (dropping it
    // collapses every streak to a point — the invisible-field first
    // capture).
    float speed = 3.4 + aSeed * 3.2;
    float x = mod(aOffset.x + uTime * speed, ${WIND_FIELD_SPAN}.0) - ${WIND_FIELD_SPAN / 2}.0;
    vec3 pos = vec3(x + position.x, aOffset.y, aOffset.z + position.z);

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * (viewMatrix * world);
    // W1 discipline (per vertex): near-lens fade × station density. The
    // corridor term runs per fragment — see WIND_FRAGMENT.
    float keep = pdNearFade(length(world.xyz - cameraPosition)) * pdDensityKeep(aSeed);
    // Fade in/out across the wrap so streaks never pop at the volume edge.
    float edge = x / ${(WIND_FIELD_SPAN / 2).toFixed(1)};
    vFade = (1.0 - smoothstep(0.72, 1.0, abs(edge))) * (0.5 + aSeed * 0.5) * keep;
  }
`;

export const WIND_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vSeed;
  varying float vFade;
  varying vec3 vWorld;
  ${PARTICLE_DISCIPLINE_GLSL}

  void main() {
    // W1 content corridor, per fragment: every pixel of a streak inside the
    // eye→face wedge is cleared, whatever its endpoints do.
    float alpha = vFade * pdCorridorKeep(vWorld) * mix(0.34, 0.62, vSeed);
    if (alpha <= 0.002) discard;
    // Readable at the standard rung's stills: the first draft's 0.16–0.3
    // alpha vanished against the bright sky (both rungs looked identical) —
    // the gate proof needs the field PRESENT, then ABSENT at rung 4.
    gl_FragColor = vec4(uColor, alpha);
  }
`;
