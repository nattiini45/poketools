/**
 * Synthetic glTF fixtures for the D42 asset-pipeline tests (no mirror needed).
 * Not a test file: vitest only collects `*.test.mjs`.
 */

import { Document } from '@gltf-transform/core';

/** A 2×2 RGBA PNG (opaque white unless `alpha` < 255 on one texel). */
export function tinyPng({ alpha = 255 } = {}) {
  // Pre-encoded: 2x2 RGBA, one texel with the given alpha (255 or 128).
  const opaque =
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwUMMAYAj4IP8cvlVgcAAAAASUVORK5CYII=';
  const translucent =
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQImWP4DwENDFDGfwCKjA9yRoOLqAAAAABJRU5ErkJggg==';
  return Buffer.from(alpha === 255 ? opaque : translucent, 'base64');
}

/** A UV sphere: `rings` × `segments` quads (2 triangles each), unit radius. */
export function sphereArrays(rings = 16, segments = 24, { radius = 1, offset = [0, 1, 0] } = {}) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  for (let r = 0; r <= rings; r += 1) {
    const v = r / rings;
    const theta = v * Math.PI;
    for (let s = 0; s <= segments; s += 1) {
      const u = s / segments;
      const phi = u * Math.PI * 2;
      const x = Math.sin(theta) * Math.cos(phi);
      const y = Math.cos(theta);
      const z = Math.sin(theta) * Math.sin(phi);
      positions.push(offset[0] + x * radius, offset[1] + y * radius, offset[2] + z * radius);
      normals.push(x, y, z);
      uvs.push(u, v);
      colors.push(0.5 + 0.5 * x, 0.5 + 0.5 * y, 0.5 + 0.5 * z, 1);
    }
  }
  const indices = [];
  const row = segments + 1;
  for (let r = 0; r < rings; r += 1) {
    for (let s = 0; s < segments; s += 1) {
      const a = r * row + s;
      const b = a + row;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };
}

/**
 * A figure-like document. Options:
 *  - `skinned`: two joints, JOINTS_0/WEIGHTS_0, one skin, an `idle` clip;
 *  - `color`, `uv`, `normal` (default true), `texture`, `blend`,
 *    `metallic` ('omit' | number), `twoPrims`, `quantizedNormals`.
 */
export function figureDocument(options = {}) {
  const {
    skinned = false,
    color = false,
    uv = true,
    normal = true,
    texture = false,
    blend = false,
    twoPrims = false,
    rings = 16,
    segments = 24,
  } = options;
  const document = new Document();
  const buffer = document.createBuffer();
  const scene = document.createScene('scene');
  document.getRoot().setDefaultScene(scene);
  const material = document.createMaterial('body').setBaseColorFactor([0.8, 0.6, 0.4, 1]).setDoubleSided(true);
  if (texture) {
    const image = document.createTexture('base').setImage(tinyPng()).setMimeType('image/png');
    material.setBaseColorTexture(image);
  }
  const mesh = document.createMesh('body');
  const parts = twoPrims ? [[0, 1, 0], [2.5, 1, 0]] : [[0, 1, 0]];
  parts.forEach((offset, part) => {
    const a = sphereArrays(rings, segments, { offset });
    const prim = document.createPrimitive();
    prim.setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(a.positions).setBuffer(buffer));
    if (normal) prim.setAttribute('NORMAL', document.createAccessor().setType('VEC3').setArray(a.normals).setBuffer(buffer));
    if (uv) prim.setAttribute('TEXCOORD_0', document.createAccessor().setType('VEC2').setArray(a.uvs).setBuffer(buffer));
    if (color) prim.setAttribute('COLOR_0', document.createAccessor().setType('VEC4').setArray(a.colors).setBuffer(buffer));
    if (skinned) {
      const n = a.positions.length / 3;
      const joints = new Uint16Array(n * 4);
      const weights = new Float32Array(n * 4);
      for (let i = 0; i < n; i += 1) {
        const y = a.positions[i * 3 + 1];
        const w = Math.min(1, Math.max(0, y / 2));
        joints[i * 4] = 0;
        joints[i * 4 + 1] = 1;
        weights[i * 4] = 1 - w;
        weights[i * 4 + 1] = w;
      }
      prim.setAttribute('JOINTS_0', document.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer));
      prim.setAttribute('WEIGHTS_0', document.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer));
    }
    prim.setIndices(document.createAccessor().setType('SCALAR').setArray(a.indices).setBuffer(buffer));
    const mat = part === 1 && blend ? document.createMaterial('shell').setAlphaMode('BLEND').setBaseColorFactor([1, 1, 1, 0.5]) : material;
    prim.setMaterial(mat);
    mesh.addPrimitive(prim);
  });
  if (blend && !twoPrims) material.setAlphaMode('BLEND').setBaseColorFactor([1, 1, 1, 0.5]);
  const node = document.createNode('body').setMesh(mesh);
  if (skinned) {
    const root = document.createNode('root').setTranslation([0, 0, 0]);
    const tip = document.createNode('tip').setTranslation([0, 1, 0]);
    root.addChild(tip);
    const ibm = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1]);
    const skin = document
      .createSkin('skin')
      .addJoint(root)
      .addJoint(tip)
      .setSkeleton(root)
      .setInverseBindMatrices(document.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
    node.setSkin(skin);
    const armature = document.createNode('armature').addChild(root).addChild(node);
    scene.addChild(armature);
    const times = document.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 0.5, 1])).setBuffer(buffer);
    const rots = document
      .createAccessor()
      .setType('VEC4')
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0.2588190451, 0.9659258263, 0, 0, 0, 1]))
      .setBuffer(buffer);
    const sampler = document.createAnimationSampler().setInput(times).setOutput(rots).setInterpolation('LINEAR');
    const channel = document.createAnimationChannel().setTargetNode(tip).setTargetPath('rotation').setSampler(sampler);
    document.createAnimation('idle').addSampler(sampler).addChannel(channel);
  } else {
    scene.addChild(node);
  }
  return document;
}
