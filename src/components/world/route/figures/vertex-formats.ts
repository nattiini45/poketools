import * as THREE from 'three';

/**
 * R6 E4 — D3D11-native vertex formats at GLB load.
 *
 * The world GLBs are quantized (KHR_mesh_quantization): 1677 of 1854
 * primitives carry `NORMAL` as SHORT x3 normalized, 1335 carry `JOINTS_0` as
 * UNSIGNED_SHORT / UNSIGNED_BYTE x4 NON-normalized, 62 carry `POSITION` as
 * SHORT x3 normalized (R6 tally, scratch `glb-formats.mjs`). WebGL on ANGLE /
 * D3D11 cannot feed either kind to a float shader input natively: D3D11 has
 * no 3-component 8/16-bit formats and no SCALED (integer read as float)
 * formats. ANGLE therefore converts — on the CPU at buffer upload
 * (`VERTEX_CONVERT_CPU`, the 3-component normals) or by declaring the input
 * as an integer and converting in the vertex shader (`VERTEX_CONVERT_GPU`,
 * the joints). The second builds a NEW vertex executable for that input
 * layout the first time each program draws it: a synchronous `D3DCompile`
 * on the GPU main thread (26-41 ms each; the R6 plaza trace counted 29 of
 * them, 750 ms, in the warm's `buffers` stage alone — every one a compositor
 * gap in the ceremony).
 *
 * Converting those attributes to Float32 once, when the GLB is parsed and
 * before anything compiles or uploads, lets every draw reuse the executable
 * the link already built (float inputs) and removes the CPU expansion.
 * Values are exactly what the GPU decoded before: normalized integers go
 * through the GL rule (`max(c / (2^(b-1) - 1), -1)` signed, `c / (2^b - 1)`
 * unsigned — three's `denormalize`), non-normalized integers are copied
 * (bone indices ≤ 65535 are exact in float32). Zero pixel change; the cost
 * is GPU memory (+6 B per normal, +8-12 B per skinned vertex).
 *
 * Left alone: Float32 (and Float16) storage, attributes flagged as integer
 * GPU inputs (`gpuType === IntType`, bound with `vertexAttribIPointer`), and
 * the formats D3D11 reads natively (8/16-bit NORMALIZED with 1, 2 or 4
 * components: UVs, vertex colours, tangents).
 */

type AnyAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

type IntegerArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array;

function storageOf(attribute: AnyAttribute): ArrayLike<number> {
  return (attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute === true
    ? (attribute as THREE.InterleavedBufferAttribute).data.array
    : (attribute as THREE.BufferAttribute).array;
}

function isIntegerArray(array: ArrayLike<number>): array is IntegerArray {
  return (
    array instanceof Int8Array ||
    array instanceof Uint8Array ||
    array instanceof Uint16Array ||
    array instanceof Int16Array ||
    array instanceof Int32Array ||
    array instanceof Uint32Array
  );
}

/**
 * Whether ANGLE / D3D11 would have to convert `attribute` for a float shader
 * input (see the module note). Pure.
 */
export function needsFloatVertexFormat(attribute: AnyAttribute): boolean {
  const a = attribute as AnyAttribute & { isFloat16BufferAttribute?: boolean; gpuType?: number };
  if (a.isFloat16BufferAttribute === true) return false;
  if (a.gpuType === THREE.IntType) return false;
  const array = storageOf(attribute);
  if (!isIntegerArray(array)) return false;
  if (!attribute.normalized) return true;
  return attribute.itemSize === 3;
}

/** The GL normalization divisor for a normalized integer storage (0 = not normalized). */
function normalizationOf(array: IntegerArray): { divisor: number; signed: boolean } {
  if (array instanceof Int8Array) return { divisor: 127, signed: true };
  if (array instanceof Uint8Array) return { divisor: 255, signed: false };
  if (array instanceof Int16Array) return { divisor: 32767, signed: true };
  if (array instanceof Uint16Array) return { divisor: 65535, signed: false };
  if (array instanceof Int32Array) return { divisor: 2147483647, signed: true };
  return { divisor: 4294967295, signed: false };
}

/**
 * A Float32 copy of `attribute` holding exactly the values the GPU decoded
 * from the integer storage (interleaved storage included). Pure: the source
 * attribute is not touched.
 */
export function toFloat32Attribute(attribute: AnyAttribute): THREE.BufferAttribute {
  const itemSize = attribute.itemSize;
  const count = attribute.count;
  const out = new Float32Array(count * itemSize);
  const interleaved = (attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute === true;
  const source = storageOf(attribute) as IntegerArray;
  const stride = interleaved ? (attribute as THREE.InterleavedBufferAttribute).data.stride : itemSize;
  const offset = interleaved ? (attribute as THREE.InterleavedBufferAttribute).offset : 0;
  const norm = attribute.normalized ? normalizationOf(source) : null;
  for (let vertex = 0; vertex < count; vertex += 1) {
    const from = vertex * stride + offset;
    const to = vertex * itemSize;
    for (let component = 0; component < itemSize; component += 1) {
      const value = source[from + component];
      out[to + component] =
        norm === null ? value : norm.signed ? Math.max(value / norm.divisor, -1) : value / norm.divisor;
    }
  }
  const result = new THREE.BufferAttribute(out, itemSize, false);
  result.name = attribute.name;
  const usage = (attribute as THREE.BufferAttribute).usage ?? (attribute as THREE.InterleavedBufferAttribute).data?.usage;
  if (usage !== undefined) result.setUsage(usage);
  return result;
}

/** What one promotion pass converted (trace). */
export interface VertexPromotion {
  geometries: number;
  attributes: number;
  /** Source bytes the converted attributes occupied / bytes after (GPU memory delta). */
  bytesBefore: number;
  bytesAfter: number;
}

export function emptyVertexPromotion(): VertexPromotion {
  return { geometries: 0, attributes: 0, bytesBefore: 0, bytesAfter: 0 };
}

/**
 * Promote every attribute of `geometry` that needs it (see
 * `needsFloatVertexFormat`) to Float32, in place. Morph attributes are left
 * alone (WebGL2 three packs them into a float texture, never a vertex
 * input). Returns what it converted, accumulated into `into`.
 */
export function promoteVertexFormats(
  geometry: THREE.BufferGeometry,
  into: VertexPromotion = emptyVertexPromotion(),
): VertexPromotion {
  let touched = false;
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.attributes[name] as AnyAttribute;
    if (!needsFloatVertexFormat(attribute)) continue;
    const converted = toFloat32Attribute(attribute);
    const source = storageOf(attribute) as IntegerArray;
    into.bytesBefore += attribute.count * attribute.itemSize * source.BYTES_PER_ELEMENT;
    into.bytesAfter += converted.array.byteLength;
    into.attributes += 1;
    geometry.setAttribute(name, converted);
    touched = true;
  }
  if (touched) into.geometries += 1;
  return into;
}

/**
 * Promote every mesh geometry under `root` once (geometries shared between
 * meshes are converted once). Returns what it converted.
 */
export function promoteSceneVertexFormats(
  root: THREE.Object3D,
  into: VertexPromotion = emptyVertexPromotion(),
): VertexPromotion {
  const seen = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (geometry === undefined || geometry.isBufferGeometry !== true || seen.has(geometry)) return;
    seen.add(geometry);
    promoteVertexFormats(geometry, into);
  });
  return into;
}
