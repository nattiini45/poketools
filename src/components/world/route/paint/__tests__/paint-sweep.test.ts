import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  auditPaint,
  findPaintScopeLeaks,
  isPaintScene,
  markPaintScene,
  PAINT_EXEMPT_OBJECT_NAMES,
  paintSweep,
  type PaintAuditRenderer,
} from '../paint-sweep';
import {
  acquirePaintScope,
  isPainted,
  PAINT_PROGRAM_KEY,
  paintRoleUniform,
  resetPaintScopeForTest,
} from '../painted-light';
import { applyPaintSet, resetPaintRolesForTest } from '../paint-uniforms';
import { standbyMaterialProps, createStandbyUniforms } from '@/components/world/route/useStandbyDim';
import { PLAZA_PAINT } from '@/components/world/themes/plaza/theme-palette';
import { plazaTheme } from '@/components/world/themes/plaza/theme';

function mesh(material: THREE.Material | THREE.Material[]): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(), material);
}

function plazaScene(): THREE.Scene {
  const scene = new THREE.Scene();
  markPaintScene(scene, 'plaza');
  return scene;
}

let release: () => void = () => {};

beforeEach(() => {
  resetPaintScopeForTest();
  resetPaintRolesForTest();
  applyPaintSet(PLAZA_PAINT.day, plazaTheme.lights.keyDirection);
  release = acquirePaintScope('plaza');
});

afterEach(() => {
  release();
  resetPaintScopeForTest();
});

describe('paintSweep', () => {
  it('patches Standard and Physical materials (arrays included) and nothing else', () => {
    const scene = plazaScene();
    const standard = new THREE.MeshStandardMaterial();
    const physical = new THREE.MeshPhysicalMaterial();
    const arrayA = new THREE.MeshStandardMaterial();
    const basic = new THREE.MeshBasicMaterial();
    const shaderMat = new THREE.ShaderMaterial();
    const lambert = new THREE.MeshLambertMaterial();
    scene.add(mesh(standard), mesh(physical), mesh([arrayA, basic]), mesh(shaderMat), mesh(lambert));
    const counts = paintSweep(scene);
    expect(counts).toEqual({ patched: 3, exempt: 0, unpatched: 0 });
    for (const m of [standard, physical, arrayA]) expect(isPainted(m)).toBe(true);
    for (const m of [basic, shaderMat, lambert]) expect(isPainted(m)).toBe(false);
  });

  it('respects dataFace / paintExempt on materials and on objects, and standby data faces', () => {
    const scene = plazaScene();
    const face = new THREE.MeshStandardMaterial();
    face.userData.dataFace = true;
    const exempt = new THREE.MeshStandardMaterial();
    exempt.userData.paintExempt = true;
    const shared = new THREE.MeshStandardMaterial();
    const taggedMesh = mesh(shared);
    taggedMesh.userData.dataFace = true;
    const standby = Object.assign(new THREE.MeshStandardMaterial(), standbyMaterialProps(createStandbyUniforms()));
    const lit = new THREE.MeshStandardMaterial();
    // `shared` is ALSO on an untagged mesh, visited first — the tagged mesh still wins.
    scene.add(mesh(shared), mesh(face), mesh(exempt), taggedMesh, mesh(standby), mesh(lit));
    const counts = paintSweep(scene);
    expect(counts).toEqual({ patched: 1, exempt: 4, unpatched: 0 });
    for (const m of [face, exempt, shared, standby]) expect(isPainted(m)).toBe(false);
    expect(isPainted(lit)).toBe(true);
    expect(standby.customProgramCacheKey()).not.toContain(PAINT_PROGRAM_KEY);
  });

  it('is idempotent across frames (one hook, one suffix)', () => {
    const scene = plazaScene();
    const material = new THREE.MeshStandardMaterial();
    scene.add(mesh(material));
    paintSweep(scene);
    const hook = material.onBeforeCompile;
    const key = material.customProgramCacheKey();
    for (let i = 0; i < 5; i += 1) paintSweep(scene);
    expect(material.onBeforeCompile).toBe(hook);
    expect(material.customProgramCacheKey()).toBe(key);
  });

  it('chains an existing hook (tree wind) and picks up role changes as uniform writes', () => {
    const scene = plazaScene();
    const leaf = new THREE.MeshStandardMaterial();
    let windRan = 0;
    leaf.onBeforeCompile = () => {
      windRan += 1;
    };
    const windKey = leaf.customProgramCacheKey();
    scene.add(mesh(leaf));
    paintSweep(scene);
    leaf.onBeforeCompile({ vertexShader: '', fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(windRan).toBe(1);
    expect(leaf.customProgramCacheKey()).toBe(`${windKey}|${PAINT_PROGRAM_KEY}`);
    leaf.userData.paintRole = 'foliage';
    paintSweep(scene);
    expect(paintRoleUniform(leaf)?.value.y).toBeCloseTo(0.2);
  });

  it('never paints a frame (LOOK r3: bezels and brass render as shipped)', () => {
    const scene = plazaScene();
    const bezel = new THREE.MeshStandardMaterial();
    bezel.userData.paintRole = 'frame';
    scene.add(mesh(bezel));
    const counts = paintSweep(scene);
    expect(isPainted(bezel)).toBe(false);
    expect(counts.exempt).toBe(1);
  });

  it('never paints the named ledger objects (LOOK r3 CLARITY: the slab keeps its shipped colour)', () => {
    const scene = plazaScene();
    for (const name of PAINT_EXEMPT_OBJECT_NAMES) {
      const material = new THREE.MeshStandardMaterial();
      const object = mesh(material);
      object.name = name;
      scene.add(object);
      paintSweep(scene);
      expect(isPainted(material)).toBe(false);
    }
  });

  it('paints materials that appear later (a suspended subtree resolving)', () => {
    const scene = plazaScene();
    paintSweep(scene);
    const late = new THREE.MeshStandardMaterial();
    const group = new THREE.Group();
    group.add(mesh(late));
    scene.add(group);
    expect(paintSweep(scene).patched).toBe(1);
    expect(isPainted(late)).toBe(true);
  });

  it('is a no-op on a scene without the paint marker (sakura, mountain, clouds)', () => {
    const scene = new THREE.Scene();
    const material = new THREE.MeshStandardMaterial();
    scene.add(mesh(material));
    expect(isPaintScene(scene)).toBe(false);
    expect(paintSweep(scene)).toEqual({ patched: 0, exempt: 0, unpatched: 0 });
    expect(isPainted(material)).toBe(false);
    expect(material.userData.paintScope).toBeUndefined();
  });
});

describe('paintScope leak marker', () => {
  it('a module-cached material painted in the plaza is found by the leak scan in another world', () => {
    const plaza = plazaScene();
    const cached = new THREE.MeshStandardMaterial(); // e.g. a drei GLTF material shared by a figure
    plaza.add(mesh(cached));
    paintSweep(plaza);
    expect(cached.userData.paintScope).toBe('plaza');

    const sakura = new THREE.Scene();
    const own = new THREE.MeshStandardMaterial();
    sakura.add(mesh(cached), mesh(own));
    expect(findPaintScopeLeaks(sakura)).toEqual([cached]);
    // …and once the plaza scope is released it compiles its original program there.
    const original = new THREE.MeshStandardMaterial().customProgramCacheKey();
    release();
    expect(cached.customProgramCacheKey()).toBe(original);
  });

  it('a world that never painted has no leaks', () => {
    const scene = new THREE.Scene();
    scene.add(mesh(new THREE.MeshStandardMaterial()), mesh(new THREE.MeshBasicMaterial()));
    expect(findPaintScopeLeaks(scene)).toEqual([]);
  });
});

describe('auditPaint', () => {
  it('counts unpatched lit materials and ones compiled without the paint key', () => {
    const scene = plazaScene();
    const good = new THREE.MeshStandardMaterial();
    const stale = new THREE.MeshStandardMaterial();
    scene.add(mesh(good), mesh(stale));
    paintSweep(scene);
    const face = new THREE.MeshStandardMaterial();
    face.userData.dataFace = true;
    const missed = new THREE.MeshStandardMaterial();
    scene.add(mesh(face), mesh(missed));
    const programs = new Map<object, { currentProgram?: { cacheKey?: string } }>([
      [good, { currentProgram: { cacheKey: `physical,…,x|${PAINT_PROGRAM_KEY}` } }],
      [stale, { currentProgram: { cacheKey: 'physical,…,x' } }],
    ]);
    const renderer: PaintAuditRenderer = { properties: { get: (o) => programs.get(o) } };
    expect(auditPaint(scene, renderer)).toEqual({ patched: 1, exempt: 1, unpatched: 2 });
    // Read-only: the audit never paints.
    expect(isPainted(missed)).toBe(false);
  });
});
