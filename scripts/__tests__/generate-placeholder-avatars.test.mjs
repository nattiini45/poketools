/**
 * generate-placeholder-avatars.mjs: a fresh checkout (no public/avatar/) gets one
 * valid 160x160 PNG per manifest layer at the path the app requests, and real
 * files are never overwritten. Importing the module must not run the CLI.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SIZE, generatePlaceholders, listManifestLayers, renderPlaceholder } from '../generate-placeholder-avatars.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'src', 'lib', 'avatar', 'manifest-data.json'), 'utf8'));

let dirs = [];
function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'avatar-ph-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function pngSize(buf) {
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), colourType: buf[25] };
}

describe('generate-placeholder-avatars', () => {
  it('renders a 160x160 RGBA PNG for every category', () => {
    for (const category of ['base', 'bottoms', 'tops', 'hair', 'hats', 'unknown']) {
      expect(pngSize(renderPlaceholder(category, 'blue'))).toEqual({ w: SIZE, h: SIZE, colourType: 6 });
    }
    expect(SIZE).toBe(160);
  });

  it('writes every manifest layer into an empty folder at the app paths', () => {
    const out = join(tmp(), 'avatar');
    const layers = listManifestLayers(manifest);
    const { written, kept } = generatePlaceholders({ manifest, outDir: out });
    expect(written).toBe(layers.length);
    expect(kept).toBe(0);
    const first = manifest.male.base.default[0].filename;
    expect(existsSync(join(out, 'male', 'base', first))).toBe(true);
  });

  it('never overwrites existing files and is a no-op on a second run', () => {
    const out = join(tmp(), 'avatar');
    const real = join(out, 'female', 'hair', manifest.female.hair[Object.keys(manifest.female.hair)[0]][0].filename);
    mkdirSync(dirname(real), { recursive: true });
    writeFileSync(real, 'REAL');
    const first = generatePlaceholders({ manifest, outDir: out });
    expect(first.kept).toBe(1);
    expect(readFileSync(real, 'utf8')).toBe('REAL');
    const second = generatePlaceholders({ manifest, outDir: out });
    expect(second.written).toBe(0);
  });

  it('refuses a manifest filename that escapes the output folder', () => {
    const bad = { male: { base: { x: [{ color: 'red', filename: '../../evil.png', optionId: 'x' }] } } };
    expect(() => generatePlaceholders({ manifest: bad, outDir: join(tmp(), 'avatar') })).toThrow(/unsafe/);
  });
});
