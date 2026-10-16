import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { describe, expect, it } from 'vitest';
import {
  MESHOPT_CODEC,
  MESHOPT_VERSION,
  MeshoptEncoder,
  assertPinnedMeshopt,
  createWorldIO,
  encoderStamp,
  glbUsesMeshopt,
  resolvedMeshopt,
} from '../meshopt-codec.mjs';
import { figureDocument } from './d42-fixtures.mjs';

/**
 * D42 / D49: the pipeline's meshoptimizer is the declared root 1.2.0,
 * resolved by a plain import (never the CLI's nested copy, never the 1.1.1
 * that @types/three carries), and every NodeIO that reads world GLBs
 * registers the meshopt decoder (ENGINE-ASSET-PLAN §2.1: a meshopt file read
 * without it throws).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WORLD_ASSETS = join(HERE, '..');

describe('the encoder pin (D49)', () => {
  it('resolves meshoptimizer 1.2.0 from the root, not a nested copy', () => {
    const { version, dir } = resolvedMeshopt();
    expect(version).toBe('1.2.0');
    expect(MESHOPT_VERSION).toBe('1.2.0');
    expect(dir).toMatch(/node_modules\/meshoptimizer$/);
    expect(dir).not.toMatch(/@gltf-transform|@types/);
    expect(assertPinnedMeshopt()).toBe('1.2.0');
  });

  it('stamps version, codec v0 and level', () => {
    const stamp = encoderStamp({ recipe: 'hq10' });
    expect(stamp).toMatchObject({ meshoptimizer: '1.2.0', pinned: '1.2.0', codec: 'v0', level: 2, recipe: 'hq10' });
    expect(MESHOPT_CODEC.vertexVersion).toBe(0);
    expect(stamp.gltfTransform).toBe('4.5.0');
  });
});

async function meshoptGlb() {
  await MeshoptEncoder.ready;
  const io = await createWorldIO({ encoder: true });
  const document = figureDocument();
  document.createExtension(EXTMeshoptCompression).setRequired(true);
  return io.writeBinary(document);
}

describe('meshopt decoder registration', () => {
  it('a plain NodeIO cannot read a meshopt GLB; createWorldIO can', async () => {
    const bytes = await meshoptGlb();
    expect(glbUsesMeshopt(bytes)).toBe(true);
    const plain = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    await expect(plain.readBinary(bytes)).rejects.toThrow(/meshopt/i);
    const io = await createWorldIO();
    const document = await io.readBinary(bytes);
    expect(document.getRoot().listMeshes()).toHaveLength(1);
  });

  it('glbUsesMeshopt is false on a plain GLB', async () => {
    const io = await createWorldIO();
    expect(glbUsesMeshopt(await io.writeBinary(figureDocument()))).toBe(false);
  });

  // Every NodeIO reader the plan lists (§2.1) registers the decoder.
  const READERS = [
    'bake-manifest.mjs',
    'decimate-props.mjs',
    'kit-assets.mjs',
    'pool-coverage.mjs',
    'probe-props-c107.mjs',
    'props-merge-c107.mjs',
    'props.mjs',
    'transform.mjs',
  ];
  it.each(READERS)('%s registers meshopt.decoder on every NodeIO', (file) => {
    const source = readFileSync(join(WORLD_ASSETS, file), 'utf8');
    const constructions = source.match(/new NodeIO\(\)/g) ?? [];
    expect(constructions.length).toBeGreaterThan(0);
    const registered =
      (source.match(/registerMeshoptDecoder\(new NodeIO\(\)/g) ?? []).length + (source.match(/'meshopt\.decoder': MeshoptDecoder/g) ?? []).length;
    expect(registered).toBe(constructions.length);
  });
});
