import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { materialSignature } from '../RouteWorldCanvas';
import {
  createWindowMaterial,
  WINDOW_UNIFORMS,
  windowMergeKey,
} from '@/components/world/evoliga/route/plaza/HaussmannBlock';
import { ashlarMergeKey, ashlarUniforms, patchAshlar, writeAshlarBlock } from '@/components/world/themes/plaza/paint-ashlar';

/**
 * D42 N4: the StaticBatcher's visual-equality signature covers the shader
 * hooks (`customProgramCacheKey()`), the painted-light role, the window
 * pane's lit flag and `userData.mergeKey` — materials that differ only there
 * render differently and must never share one merged draw.
 */

function stone(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#d8d0c0', roughness: 0.9, metalness: 0.02 });
}

describe('materialSignature (N4)', () => {
  it('two plain materials with the same parameters still share a signature', () => {
    const a = stone();
    const b = stone();
    expect(materialSignature(a)).not.toBeNull();
    expect(materialSignature(a)).toBe(materialSignature(b));
  });

  it('splits on the program key (an onBeforeCompile patch)', () => {
    const a = stone();
    const b = stone();
    b.customProgramCacheKey = () => 'tree-wind-v2';
    expect(materialSignature(a)).not.toBe(materialSignature(b));
    const c = stone();
    c.customProgramCacheKey = () => 'tree-wind-v2';
    expect(materialSignature(b)).toBe(materialSignature(c));
  });

  it('splits on the painted-light role under one shared program key', () => {
    const a = stone();
    const b = stone();
    a.userData.paintRole = 'frame';
    b.userData.paintRole = 'figure';
    expect(materialSignature(a)).not.toBe(materialSignature(b));
    b.userData.paintRole = 'frame';
    expect(materialSignature(a)).toBe(materialSignature(b));
    // Absent role and an explicit undefined read the same.
    const c = stone();
    const d = stone();
    d.userData.paintRole = undefined;
    expect(materialSignature(c)).toBe(materialSignature(d));
  });

  it('splits the glass and lamp panes (one program, the lit state is a uniform)', () => {
    const glass = createWindowMaterial(false);
    const lamp = createWindowMaterial(true);
    expect(glass.customProgramCacheKey()).toBe(lamp.customProgramCacheKey());
    expect(materialSignature(glass)).not.toBe(materialSignature(lamp));
    expect(materialSignature(glass)).toBe(materialSignature(createWindowMaterial(false)));
    expect(materialSignature(lamp)).toBe(materialSignature(createWindowMaterial(true)));
  });

  it('splits windows bound to another uniform set (the mergeKey write in HaussmannBlock)', () => {
    const other = { ...WINDOW_UNIFORMS };
    const shared = createWindowMaterial(false);
    const own = createWindowMaterial(false, other);
    expect(shared.userData.mergeKey).toBe('window:shared');
    expect(own.userData.mergeKey).toBe(windowMergeKey(other));
    expect(own.userData.mergeKey).not.toBe(shared.userData.mergeKey);
    expect(materialSignature(own)).not.toBe(materialSignature(shared));
    expect(materialSignature(own)).toBe(materialSignature(createWindowMaterial(false, other)));
  });

  it('splits ashlar materials whose per-material uniforms differ (the mergeKey write in paint-ashlar)', () => {
    const a = stone();
    const b = stone();
    const c = stone();
    patchAshlar(a, { bayPhase: 0.25, lotBays: 3 });
    patchAshlar(b, { bayPhase: 0.5, lotBays: 3 });
    patchAshlar(c, { bayPhase: 0.25, lotBays: 3 });
    expect(a.userData.mergeKey).toBe(ashlarMergeKey(ashlarUniforms(a)!));
    expect(materialSignature(a)).not.toBe(materialSignature(b));
    expect(materialSignature(a)).toBe(materialSignature(c));
  });

  it('keeps the ashlar mergeKey current through writeAshlarBlock and a re-patch', () => {
    const a = stone();
    const b = stone();
    patchAshlar(a, { courseOn: 0, detail: 0.8 });
    patchAshlar(b, { courseOn: 0, detail: 0.8 });
    expect(materialSignature(a)).toBe(materialSignature(b));
    writeAshlarBlock(a, { top: 18, weather: 1, cool: 0.3, axis: 0 });
    expect(materialSignature(a)).not.toBe(materialSignature(b));
    writeAshlarBlock(b, { top: 18, weather: 1, cool: 0.3, axis: 0 });
    expect(materialSignature(a)).toBe(materialSignature(b));
    patchAshlar(b, { courseOn: 0, detail: 0.6 });
    expect(materialSignature(a)).not.toBe(materialSignature(b));
  });

  it('splits on any other mergeKey and leaves Basic materials keyed the same way', () => {
    const a = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const b = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    expect(materialSignature(a)).toBe(materialSignature(b));
    a.userData.mergeKey = 'x';
    expect(materialSignature(a)).not.toBe(materialSignature(b));
    a.userData.mergeKey = { k: 1 };
    b.userData.mergeKey = { k: 1 };
    expect(materialSignature(a)).toBe(materialSignature(b));
  });
});
