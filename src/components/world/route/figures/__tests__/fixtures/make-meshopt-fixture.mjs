/**
 * D42 (commit G): writes `meshopt-fixture.glb`, the committed meshopt fixture
 * the loader tests parse (`figure-loader-meshopt.test.ts`).
 *
 *   node src/components/world/route/figures/__tests__/fixtures/make-meshopt-fixture.mjs
 *
 * A small UV sphere (POSITION, NORMAL, TEXCOORD_0; 12 x 8 segments, 192
 * triangles) on one node with a one-second `idle` rotation clip, quantized at
 * scene volume (positions 14 bits, normals 10 bits, UVs 12 bits) and packed
 * with EXT_meshopt_compression (required, the QUANTIZE method). Deterministic:
 * re-running it reproduces the same bytes. meshoptimizer is the root
 * devDependency (D49, 1.2.0), imported normally.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = join(HERE, 'meshopt-fixture.glb');

const SEG_U = 12;
const SEG_V = 8;

function sphere() {
  const positions = [];
  const normals = [];
  const uvs = [];
  for (let v = 0; v <= SEG_V; v += 1) {
    const phi = (v / SEG_V) * Math.PI;
    for (let u = 0; u <= SEG_U; u += 1) {
      const theta = (u / SEG_U) * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      positions.push(x * 0.5, y * 0.5 + 0.5, z * 0.5);
      normals.push(x, y, z);
      uvs.push(u / SEG_U, v / SEG_V);
    }
  }
  const indices = [];
  const row = SEG_U + 1;
  for (let v = 0; v < SEG_V; v += 1) {
    for (let u = 0; u < SEG_U; u += 1) {
      const a = v * row + u;
      const b = a + row;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  };
}

export async function buildFixture() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const geo = sphere();
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(geo.positions).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(geo.normals).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(geo.uvs).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(geo.indices).setBuffer(buffer))
    .setMaterial(doc.createMaterial('fixture').setBaseColorFactor([0.8, 0.6, 0.4, 1]).setRoughnessFactor(0.7));
  const mesh = doc.createMesh('fixture').addPrimitive(prim);
  const node = doc.createNode('fixture').setMesh(mesh);
  doc.createScene('fixture').addChild(node);

  const times = doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 0.5, 1])).setBuffer(buffer);
  const s = Math.SQRT1_2;
  const rotations = doc
    .createAccessor()
    .setType('VEC4')
    .setArray(new Float32Array([0, 0, 0, 1, 0, s, 0, s, 0, 0, 0, 1]))
    .setBuffer(buffer);
  const sampler = doc.createAnimationSampler().setInput(times).setOutput(rotations).setInterpolation('LINEAR');
  const channel = doc.createAnimationChannel().setTargetNode(node).setTargetPath('rotation').setSampler(sampler);
  doc.createAnimation('idle').addSampler(sampler).addChannel(channel);

  await doc.transform(
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizationVolume: 'scene' }),
  );
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  return io.writeBinary(doc);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { writeFile } = await import('node:fs/promises');
  const bytes = await buildFixture();
  await writeFile(FIXTURE_PATH, bytes);
  console.log(`wrote ${FIXTURE_PATH} (${bytes.byteLength} bytes)`);
}
