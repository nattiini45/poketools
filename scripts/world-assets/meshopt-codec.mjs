/**
 * The world-asset pipeline's one meshoptimizer (D42, D49).
 *
 * `meshoptimizer` 1.2.0 is a declared devDependency at the repo root (D49),
 * so a plain `import 'meshoptimizer'` resolves it; the CLI's nested copy is
 * never reached for. `@types/three` keeps its own 1.1.1 under its own
 * folder, which a bare import from here cannot see. `encoderStamp()` records
 * the resolved version, its path, the vertex codec and the filters every
 * encode used, and `scripts/world-assets/__tests__/d42-codec.test.mjs` fails
 * when the resolved version is anything but `MESHOPT_VERSION`.
 *
 * Every NodeIO that may READ a world GLB registers the decoder through
 * `registerMeshoptDecoder` (or builds its IO with `createWorldIO`): a meshopt
 * file read without `meshopt.decoder` throws (measured, plan §2.1).
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

export { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier };

const require = createRequire(import.meta.url);

/** The pinned encoder version (D49). A change is a re-encode, never silent. */
export const MESHOPT_VERSION = '1.2.0';

/**
 * The vertex codec every encode writes. `encodeGltfBuffer` defaults to v0
 * (meshoptimizer 1.x `meshopt_encoder.js`: `version === undefined ? 0`),
 * the codec three's decoder and every EXT_meshopt_compression reader take.
 */
export const MESHOPT_CODEC = { vertexVersion: 0, level: 2 };

/** Absolute path and version of the `meshoptimizer` a bare import resolves to. */
export function resolvedMeshopt() {
  const entry = require.resolve('meshoptimizer');
  const dir = dirname(entry);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  return { version: pkg.version, dir: dir.split('\\').join('/'), entry: entry.split('\\').join('/') };
}

/** The encoder stamp `d42-metrics.json` and every encode report carry. */
export function encoderStamp(extra = {}) {
  const { version, dir } = resolvedMeshopt();
  return {
    meshoptimizer: version,
    meshoptimizerPath: dir,
    pinned: MESHOPT_VERSION,
    codec: `v${MESHOPT_CODEC.vertexVersion}`,
    level: MESHOPT_CODEC.level,
    gltfTransform: gltfTransformVersion(),
    ...extra,
  };
}

function gltfTransformVersion() {
  try {
    const entry = require.resolve('@gltf-transform/core');
    let dir = dirname(entry);
    for (let i = 0; i < 4; i += 1) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        if (pkg.name === '@gltf-transform/core') return pkg.version;
      } catch {
        /* keep climbing */
      }
      dir = dirname(dir);
    }
  } catch {
    /* unresolved */
  }
  return null;
}

/** Throws unless the resolved meshoptimizer is the pinned one. */
export function assertPinnedMeshopt() {
  const { version, dir } = resolvedMeshopt();
  if (version !== MESHOPT_VERSION) {
    throw new Error(`meshoptimizer ${version} at ${dir}; the pipeline is pinned to ${MESHOPT_VERSION} (D49)`);
  }
  return version;
}

/** Register the meshopt decoder on an existing NodeIO (after `MeshoptDecoder.ready`). */
export async function registerMeshoptDecoder(io) {
  await MeshoptDecoder.ready;
  return io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
}

/**
 * A NodeIO with every extension and the meshopt decoder (and, with
 * `{ encoder: true }`, the encoder). Extra dependencies (Draco) pass through.
 */
export async function createWorldIO({ encoder = false, dependencies = {}, quiet = false } = {}) {
  await MeshoptDecoder.ready;
  const deps = { 'meshopt.decoder': MeshoptDecoder, ...dependencies };
  if (encoder) {
    await MeshoptEncoder.ready;
    deps['meshopt.encoder'] = MeshoptEncoder;
  }
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies(deps);
  if (quiet) io.setLogger(new Logger(Logger.Verbosity.ERROR));
  return io;
}

/** Whether a GLB's JSON chunk declares EXT_meshopt_compression (no decode). */
export function glbUsesMeshopt(bytes) {
  const json = glbJson(bytes);
  return Boolean(json && (json.extensionsUsed ?? []).includes('EXT_meshopt_compression'));
}

/**
 * Per-primitive accessor formats straight from a GLB's JSON (what a loader
 * will be handed, not what an option name promised): one entry per
 * mesh/primitive/semantic with componentType, normalized, type, count and the
 * EXT_meshopt_compression filter of its bufferView ('NONE' when absent).
 */
export function glbAccessorFormats(bytes) {
  const json = glbJson(bytes);
  if (!json) throw new Error('not a GLB');
  const views = json.bufferViews ?? [];
  const describe = (index) => {
    const accessor = json.accessors[index];
    const ext = views[accessor.bufferView]?.extensions?.EXT_meshopt_compression;
    return {
      componentType: accessor.componentType,
      normalized: accessor.normalized === true,
      type: accessor.type,
      count: accessor.count,
      filter: ext ? (ext.filter ?? 'NONE') : null,
      hasBufferView: accessor.bufferView !== undefined,
      mode: ext ? ext.mode : null,
    };
  };
  const out = [];
  (json.meshes ?? []).forEach((mesh, m) => {
    mesh.primitives.forEach((prim, p) => {
      for (const [semantic, index] of Object.entries(prim.attributes)) out.push({ mesh: m, prim: p, semantic, ...describe(index) });
      if (prim.indices !== undefined) out.push({ mesh: m, prim: p, semantic: 'indices', ...describe(prim.indices) });
    });
  });
  (json.animations ?? []).forEach((anim, a) => {
    anim.channels.forEach((channel) => {
      const sampler = anim.samplers[channel.sampler];
      out.push({ animation: a, semantic: `output:${channel.target.path}`, ...describe(sampler.output) });
    });
  });
  return out;
}

/** The parsed JSON chunk of a GLB, or null when the bytes are not a GLB. */
export function glbJson(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength);
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) return null;
  const length = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) return null;
  return JSON.parse(buf.subarray(20, 20 + length).toString('utf8'));
}
