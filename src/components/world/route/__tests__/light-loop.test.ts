import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildPointLightLoopChunk, POINT_LOOP_ANCHORS, POINT_LOOP_MARKER, POINT_LOOP_SKIP } from '../light-loop';

const STOCK = THREE.ShaderChunk.lights_fragment_begin;

describe('point-light loop (ENGINE r3: unshadowed point lights are not unrolled)', () => {
  it('three 0.185.1 still carries the pinned anchors', () => {
    expect(STOCK).toContain(POINT_LOOP_ANCHORS.blockStart);
    expect(STOCK).toContain(POINT_LOOP_ANCHORS.loopStart);
    expect(STOCK).toContain(POINT_LOOP_ANCHORS.loopEnd);
  });

  it('keeps the stock unrolled loop for shadowed point lights and adds a plain loop otherwise', () => {
    const patched = buildPointLightLoopChunk(STOCK);
    expect(patched).toContain(POINT_LOOP_MARKER);
    // The stock loop survives verbatim (shadowed point lights).
    const stockLoop = STOCK.slice(
      STOCK.indexOf(POINT_LOOP_ANCHORS.loopStart),
      STOCK.indexOf(POINT_LOOP_ANCHORS.loopEnd) + POINT_LOOP_ANCHORS.loopEnd.length,
    );
    expect(patched).toContain(stockLoop);
    expect(patched).toMatch(/#if defined\( USE_SHADOWMAP \) && NUM_POINT_LIGHT_SHADOWS > 0\n\t#pragma unroll_loop_start/);
    // The plain loop carries no unroll pragma and the same body order.
    const plain = patched.slice(patched.indexOf(POINT_LOOP_MARKER), patched.indexOf('#endif', patched.indexOf(POINT_LOOP_MARKER)));
    expect(plain).not.toContain('unroll_loop');
    expect(plain.indexOf('pointLight = pointLights[ i ];')).toBeLessThan(plain.indexOf('getPointLightInfo('));
    expect(plain.indexOf('getPointLightInfo(')).toBeLessThan(plain.indexOf('RE_Direct('));
    // ENGINE-FIX (D32): a zero-colour light (a pad) is skipped before its BRDF.
    expect(plain.indexOf('pointLight = pointLights[ i ];')).toBeLessThan(plain.indexOf(POINT_LOOP_SKIP));
    expect(plain.indexOf(POINT_LOOP_SKIP)).toBeLessThan(plain.indexOf('getPointLightInfo('));
    // The shadowed (stock) loop never skips.
    expect(patched.slice(0, patched.indexOf(POINT_LOOP_MARKER))).not.toContain(POINT_LOOP_SKIP);
    // Everything outside the point-light loop is byte-identical.
    const before = STOCK.slice(0, STOCK.indexOf(POINT_LOOP_ANCHORS.loopStart));
    const after = STOCK.slice(STOCK.indexOf(POINT_LOOP_ANCHORS.loopEnd) + POINT_LOOP_ANCHORS.loopEnd.length);
    expect(patched.startsWith(before)).toBe(true);
    expect(patched.endsWith(after)).toBe(true);
  });

  it('is idempotent and leaves an unknown chunk untouched', () => {
    const once = buildPointLightLoopChunk(STOCK);
    expect(buildPointLightLoopChunk(once)).toBe(once);
    expect(buildPointLightLoopChunk('void main() {}')).toBe('void main() {}');
  });
});
