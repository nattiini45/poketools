import { closeSync, existsSync, openSync, readdirSync, readSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * R6-BRIEF §4 A2, in support of ENGINE E4. These are the vertex formats the
 * shipped GLBs carry, classified by ANGLE's D3D11 conversion class (from
 * `GetVertexFormatInfo` in `libANGLE/renderer/d3d/d3d11/formatutils11.cpp`):
 *
 * - NONE: a native DXGI format.
 * - CPU (`VERTEX_CONVERT_CPU`): a 3-component normalized 8- or 16-bit integer.
 *   D3D11 has no 3-channel 8/16-bit format, so the GPU process expands the
 *   buffer to 4 components at first draw.
 * - GPU (`VERTEX_CONVERT_GPU`): a non-normalized integer ("scaled") that feeds
 *   a float attribute, as three binds a u8/u16 `skinIndex` through
 *   `vertexAttribPointer`. It gets a *_UINT / *_SINT DXGI format plus a
 *   vertex-executable variant built synchronously at first draw.
 * - BOTH: a non-normalized 3-component integer.
 *
 * E4 converts exactly three cases to Float32 at load:
 * - JOINTS_n VEC4 UBYTE/USHORT (GPU);
 * - NORMAL VEC3 SHORT/BYTE normalized (CPU);
 * - POSITION VEC3 SHORT/BYTE normalized (CPU).
 *
 * The mirror checks below pin that no shipped GLB carries any OTHER
 * non-native class, so those three cases are exhaustive. A re-bake that adds
 * one (for example non-normalized SHORT texcoords, a VEC3 UBYTE colour, or u8
 * indices) fails here, before it becomes a first-draw stall.
 *
 * The GLBs are the untracked local mirror (D22); each mirror check runs only
 * when its files are present, as `plaza-bakes.test.mjs` does.
 */

const WORLD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'public', 'models', 'world');

const FLOAT = 5126;
const COMPONENT = { 5120: 'BYTE', 5121: 'UBYTE', 5122: 'SHORT', 5123: 'USHORT', 5125: 'UINT', 5126: 'FLOAT' };
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** ANGLE D3D11 conversion class of one glTF vertex accessor. */
function d3d11Class({ componentType, type, normalized = false }) {
  const n = COMPONENTS[type];
  if (componentType === FLOAT) return 'NONE';
  if (componentType === 5125) return normalized ? 'CPU' : 'GPU';
  if (normalized) return n === 3 ? 'CPU' : 'NONE';
  return n === 3 ? 'BOTH' : 'GPU';
}

/** The three cases E4 converts to Float32 at load (R6-BRIEF §3 E4). */
function isE4Converted(semantic, accessor) {
  const ct = accessor.componentType;
  if (/^JOINTS_\d+$/.test(semantic)) {
    return accessor.type === 'VEC4' && (ct === 5121 || ct === 5123) && !accessor.normalized;
  }
  if (semantic === 'NORMAL' || semantic === 'POSITION') {
    return accessor.type === 'VEC3' && (ct === 5120 || ct === 5122) && accessor.normalized === true;
  }
  return false;
}

/** Only the GLB header and JSON chunk: a store-wide pass stays cheap. */
function readGlbJson(file) {
  const fd = openSync(file, 'r');
  try {
    const header = Buffer.alloc(20);
    readSync(fd, header, 0, 20, 0);
    if (header.readUInt32LE(0) !== 0x46546c67) throw new Error(`not a GLB: ${file}`);
    if (header.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`first chunk is not JSON: ${file}`);
    const length = header.readUInt32LE(12);
    const json = Buffer.alloc(length);
    readSync(fd, json, 0, length, 20);
    return JSON.parse(json.toString('utf8'));
  } finally {
    closeSync(fd);
  }
}

/**
 * Per-primitive attribute formats of one parsed glTF document. `interleaved`
 * marks a bufferView byteStride that differs from the element size: three
 * then builds an InterleavedBufferAttribute, which E4 must read through the
 * attribute getters.
 */
function primitiveFormats(gltf) {
  const out = [];
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      const attributes = Object.entries(primitive.attributes).map(([semantic, index]) => {
        const accessor = gltf.accessors[index];
        const view = accessor.bufferView === undefined ? undefined : gltf.bufferViews[accessor.bufferView];
        const element = COMPONENT_BYTES[accessor.componentType] * COMPONENTS[accessor.type];
        return {
          semantic,
          format: `${accessor.type} ${COMPONENT[accessor.componentType]}${accessor.normalized ? ' norm' : ''}`,
          cls: d3d11Class(accessor),
          e4: isE4Converted(semantic, accessor),
          interleaved: Boolean(view?.byteStride && view.byteStride !== element),
        };
      });
      const indices = primitive.indices === undefined ? 'none' : COMPONENT[gltf.accessors[primitive.indices].componentType];
      out.push({ mode: primitive.mode ?? 4, indices, attributes });
    }
  }
  return out;
}

function listGlbs(dir) {
  const root = join(WORLD, dir);
  if (!existsSync(root)) return [];
  const files = [];
  const walk = (rel) => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(next);
      else if (next.endsWith('.glb')) files.push(`${dir}/${next}`);
    }
  };
  walk('');
  return files.sort();
}

/**
 * One GLB's problems (non-native formats E4 does not convert, u8 or missing
 * indices, non-triangle modes), plus how many attributes E4 does convert.
 */
function e4Audit(file) {
  const gaps = [];
  let converted = 0;
  for (const primitive of primitiveFormats(readGlbJson(join(WORLD, file)))) {
    if (primitive.mode !== 4) gaps.push(`mode ${primitive.mode}`);
    if (primitive.indices === 'UBYTE' || primitive.indices === 'none') gaps.push(`indices ${primitive.indices}`);
    for (const a of primitive.attributes) {
      if (a.e4) converted += 1;
      else if (a.cls !== 'NONE') gaps.push(`${a.semantic} ${a.format} -> ${a.cls}`);
    }
  }
  return { gaps, converted };
}

/** The plaza's own env + prop GLBs (figures are cast from live data, so the store check covers them). */
const PLAZA_KIT = ['env/kit/bay-balcony.glb', 'env/kit/bay-ground.glb', 'env/kit/bay-plain.glb', 'env/kit/bay-shopfront.glb', 'env/kit/dormer.glb'];
const PLAZA_PROPS = ['props/gate-crest-ornament.glb', 'props/haussmann-lamp-post.glb', 'props/led-board-cabinet.glb'];
const present = (files) => files.every((file) => existsSync(join(WORLD, file)));

describe('d3d11Class (ANGLE formatutils11 vertex table)', () => {
  it('classifies the formats the world GLBs use', () => {
    expect(d3d11Class({ componentType: 5126, type: 'VEC3' })).toBe('NONE');
    expect(d3d11Class({ componentType: 5126, type: 'VEC4' })).toBe('NONE');
    // skinIndex: u8 / u16 non-normalized feeding a float attribute.
    expect(d3d11Class({ componentType: 5121, type: 'VEC4' })).toBe('GPU');
    expect(d3d11Class({ componentType: 5123, type: 'VEC4' })).toBe('GPU');
    // KHR_mesh_quantization normals / positions: 3-component normalized ints.
    expect(d3d11Class({ componentType: 5122, type: 'VEC3', normalized: true })).toBe('CPU');
    expect(d3d11Class({ componentType: 5120, type: 'VEC3', normalized: true })).toBe('CPU');
    // 2- and 4-component normalized ints are native (R16G16_UNORM, R8G8B8A8_UNORM, ...).
    expect(d3d11Class({ componentType: 5123, type: 'VEC2', normalized: true })).toBe('NONE');
    expect(d3d11Class({ componentType: 5121, type: 'VEC4', normalized: true })).toBe('NONE');
    // A1 stretch: a scalar `_OCC` quantized to u16 (gltf-transform `quantizeGeneric`) is native R16_UNORM.
    expect(d3d11Class({ componentType: 5123, type: 'SCALAR', normalized: true })).toBe('NONE');
    // Non-normalized 3-component ints need both conversions.
    expect(d3d11Class({ componentType: 5122, type: 'VEC3' })).toBe('BOTH');
    expect(d3d11Class({ componentType: 5122, type: 'VEC2' })).toBe('GPU');
  });

  it('marks exactly the three E4 cases as converted', () => {
    expect(isE4Converted('JOINTS_0', { componentType: 5121, type: 'VEC4' })).toBe(true);
    expect(isE4Converted('JOINTS_0', { componentType: 5123, type: 'VEC4' })).toBe(true);
    expect(isE4Converted('NORMAL', { componentType: 5122, type: 'VEC3', normalized: true })).toBe(true);
    expect(isE4Converted('NORMAL', { componentType: 5120, type: 'VEC3', normalized: true })).toBe(true);
    expect(isE4Converted('POSITION', { componentType: 5122, type: 'VEC3', normalized: true })).toBe(true);
    // Non-normalized quantized positions (KHR_mesh_quantization allows them) are NOT covered.
    expect(isE4Converted('POSITION', { componentType: 5122, type: 'VEC3' })).toBe(false);
    expect(isE4Converted('TEXCOORD_0', { componentType: 5122, type: 'VEC2' })).toBe(false);
    expect(isE4Converted('COLOR_0', { componentType: 5121, type: 'VEC3', normalized: true })).toBe(false);
  });
});

describe('primitiveFormats (synthetic glTF)', () => {
  const gltf = {
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, JOINTS_0: 2, TEXCOORD_0: 3 }, indices: 4 }] }],
    bufferViews: [{ byteStride: 24 }, { byteStride: 24 }, {}, {}, {}],
    accessors: [
      { bufferView: 0, componentType: 5122, type: 'VEC3', normalized: true },
      { bufferView: 1, componentType: 5122, type: 'VEC3', normalized: true },
      { bufferView: 2, componentType: 5123, type: 'VEC4' },
      { bufferView: 3, componentType: 5122, type: 'VEC2' },
      { bufferView: 4, componentType: 5121, type: 'SCALAR' },
    ],
  };

  it('reports class, E4 coverage and interleaving per attribute', () => {
    const [primitive] = primitiveFormats(gltf);
    expect(primitive.indices).toBe('UBYTE');
    const bySemantic = Object.fromEntries(primitive.attributes.map((a) => [a.semantic, a]));
    expect(bySemantic.POSITION).toMatchObject({ format: 'VEC3 SHORT norm', cls: 'CPU', e4: true, interleaved: true });
    expect(bySemantic.NORMAL).toMatchObject({ cls: 'CPU', e4: true, interleaved: true });
    expect(bySemantic.JOINTS_0).toMatchObject({ format: 'VEC4 USHORT', cls: 'GPU', e4: true, interleaved: false });
    expect(bySemantic.TEXCOORD_0).toMatchObject({ cls: 'GPU', e4: false });
  });
});

describe('shipped mirror GLBs: E4 is exhaustive', () => {
  const store = [...listGlbs('env'), ...listGlbs('props'), ...listGlbs('models')];

  it.skipIf(store.length === 0)('no GLB carries a non-native vertex format that E4 does not convert', () => {
    const gaps = {};
    let converted = 0;
    for (const file of store) {
      const audit = e4Audit(file);
      converted += audit.converted;
      if (audit.gaps.length > 0) gaps[file] = [...new Set(audit.gaps)];
    }
    expect(gaps).toEqual({});
    // Not vacuous: the store really carries the formats E4 exists for.
    expect(converted).toBeGreaterThan(0);
  }, 60_000);

  it.skipIf(!present(PLAZA_KIT))('the façade kit: POSITION + NORMAL are quantized SHORT (CPU class), no skin', () => {
    for (const file of PLAZA_KIT) {
      const primitives = primitiveFormats(readGlbJson(join(WORLD, file)));
      expect(primitives.length).toBeGreaterThan(0);
      for (const primitive of primitives) {
        const bySemantic = Object.fromEntries(primitive.attributes.map((a) => [a.semantic, a]));
        expect(bySemantic.POSITION, file).toMatchObject({ format: 'VEC3 SHORT norm', cls: 'CPU', e4: true });
        expect(bySemantic.NORMAL, file).toMatchObject({ format: 'VEC3 SHORT norm', cls: 'CPU', e4: true });
        expect(bySemantic.JOINTS_0, file).toBeUndefined();
        expect(primitive.indices, file).toBe('USHORT');
      }
    }
  });

  it.skipIf(!present(PLAZA_PROPS))('the plaza props: quantized POSITION + NORMAL (SHORT or BYTE), no skin', () => {
    for (const file of PLAZA_PROPS) {
      for (const primitive of primitiveFormats(readGlbJson(join(WORLD, file)))) {
        const bySemantic = Object.fromEntries(primitive.attributes.map((a) => [a.semantic, a]));
        expect(bySemantic.POSITION, file).toMatchObject({ format: 'VEC3 SHORT norm', cls: 'CPU', e4: true });
        expect(bySemantic.NORMAL?.cls, file).toBe('CPU');
        expect(bySemantic.NORMAL?.e4, file).toBe(true);
        expect(bySemantic.JOINTS_0, file).toBeUndefined();
      }
    }
  });
});
