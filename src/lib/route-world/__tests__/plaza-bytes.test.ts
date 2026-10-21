/**
 * LOOK-PLAN §2 SEAT A / D23 — the plaza critical byte budget, proven from the
 * shipped manifest plus the files on disk in the local mirror
 * (`public/models/world`, D22).
 *
 * "Critical" = everything the wired plaza fetches before reveal, per palette:
 * the env list `plazaCriticalEnvFiles` resolves (gain-map HDRI, painted
 * sets, façade kit, story mask, skyline atlas) plus the prop GLBs the plaza
 * scene code names. The prop list is DERIVED, not restated: every manifest
 * prop whose name appears as a string literal in plaza code (comments
 * stripped). Figures are excluded (they are the roster, not the set).
 *
 * Both halves skip where the maintainer-only manifest is absent, and the on-disk
 * half also where the mirror's binaries are absent (CI has neither). It matches each file against the manifest size
 * of the encoding actually on disk: `kb` for a meshopt GLB, `castKb` (the A
 * encoding) for mirror A's originals (`expectedDiskKb`).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { castKbOf, WORLD_MANIFEST_FILE, type WorldManifest } from '../model-manifest';
import { readMirrorManifest } from './world-manifest-fixture';
import {
  envTextureSetFiles,
  hdriFileFor,
  hdriUrl,
  hdriUrlFor,
  PLAZA_HDRI_FORMAT,
  PLAZA_MASK_FILE,
  PLAZA_PAINTED_ROLES,
  PLAZA_SKYLINE_FILE,
  plazaCriticalEnvFiles,
  type HdriRole,
} from '../world-env';

const ROOT = path.resolve(__dirname, '../../../..');
const MIRROR = path.join(ROOT, 'public/models/world');
const { manifest: MANIFEST, present: HAS_MANIFEST }: { manifest: WorldManifest; present: boolean } = readMirrorManifest(WORLD_MANIFEST_FILE);
const HAS_BINARIES = existsSync(path.join(MIRROR, 'env/hdri/gold.jpg'));

/** D23 caps (decimal MB, bytes on disk): plaza critical env + props. */
const CAP_MB: Record<HdriRole, number> = { gold: 4.0, night: 4.2 };

/** Plaza scene code: every .ts/.tsx under the plaza tree plus the shared layout seats. */
function plazaSources(): string[] {
  const out: string[] = [path.join(ROOT, 'src/lib/route-world/layout.ts')];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, name.name);
      if (name.isDirectory()) {
        if (name.name !== '__tests__') walk(full);
      } else if (/\.(ts|tsx)$/.test(name.name)) out.push(full);
    }
  };
  walk(path.join(ROOT, 'src/components/world/evoliga'));
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Manifest props the plaza loads: named as a string literal in plaza code. */
function plazaPropFiles(): string[] {
  const code = plazaSources().map((file) => stripComments(readFileSync(file, 'utf8'))).join('\n');
  return MANIFEST.props
    .filter((prop) => code.includes(`'${prop.name}'`) || code.includes(`"${prop.name}"`))
    .map((prop) => prop.file);
}

function criticalFiles(role: HdriRole): string[] {
  return [...plazaCriticalEnvFiles(MANIFEST, role), ...plazaPropFiles()];
}

function diskBytes(file: string): number {
  return statSync(path.join(MIRROR, file)).size;
}

/** True when the GLB on disk declares EXT_meshopt_compression (its JSON chunk). */
function isMeshoptGlb(file: string): boolean {
  if (!file.endsWith('.glb')) return false;
  const bytes = readFileSync(path.join(MIRROR, file));
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as { extensionsUsed?: string[] };
  return (json.extensionsUsed ?? []).includes('EXT_meshopt_compression');
}

/**
 * The manifest kb the bytes on disk must match. The shipped manifest is the
 * D42 set: `kb` is the meshopt wire size, `castKb` the original (A) encoding.
 * The local mirror root is mirror A unless a meshopt arm was promoted into it
 * (scripts/world-assets/README.md, D42), so an un-encoded GLB is held to
 * `castKbOf` and an encoded one to `kb`. Env files are byte-identical in
 * every arm and carry no castKb.
 */
function expectedDiskKb(entry: { kb: number; castKb?: number }, file: string): number {
  return isMeshoptGlb(file) ? entry.kb : castKbOf(entry);
}

describe.skipIf(!HAS_MANIFEST)('plaza critical set (manifest)', () => {
  it('loads the gain map, the painted sets, the kit, the mask and the skyline — never the scans or the .hdr', () => {
    for (const role of ['gold', 'night'] as const) {
      const files = plazaCriticalEnvFiles(MANIFEST, role);
      expect(files[0]).toBe(`env/hdri/${role}.jpg`);
      expect(files).toContain(PLAZA_MASK_FILE);
      expect(files).toContain(PLAZA_SKYLINE_FILE);
      for (const painted of PLAZA_PAINTED_ROLES) {
        expect(envTextureSetFiles(MANIFEST, painted).length).toBeGreaterThanOrEqual(2);
        for (const file of envTextureSetFiles(MANIFEST, painted)) expect(files).toContain(file);
      }
      expect(files.filter((file) => file.startsWith('env/kit/'))).toHaveLength(5);
      expect(files.some((file) => /env\/tex\/(cobble|limestone|slate)\//.test(file))).toBe(false);
      expect(files.some((file) => file.endsWith('.hdr'))).toBe(false);
    }
    expect(envTextureSetFiles(MANIFEST, 'plaza-ground')).toEqual([
      'env/tex/plaza-ground/diff.webp',
      'env/tex/plaza-ground/nor.webp',
    ]);
  });

  it('derives the plaza props from scene code: crest, lamp and LED cabinet (the plinth GLB is retired)', () => {
    expect(plazaPropFiles().sort()).toEqual([
      'props/gate-crest-ornament.glb',
      'props/haussmann-lamp-post.glb',
      'props/led-board-cabinet.glb',
    ]);
  });

  it(`meets the caps from manifest kb (day ≤ ${CAP_MB.gold} MB, night ≤ ${CAP_MB.night} MB)`, () => {
    const kb = new Map<string, number>([
      ...MANIFEST.environment.map((entry) => [entry.file, entry.kb] as const),
      ...MANIFEST.props.map((entry) => [entry.file, entry.kb] as const),
    ]);
    for (const role of ['gold', 'night'] as const) {
      const total = criticalFiles(role).reduce((sum, file) => {
        const size = kb.get(file);
        expect(size, file).toBeTypeOf('number');
        return sum + (size ?? 0) * 1024;
      }, 0);
      expect(total / 1e6).toBeLessThanOrEqual(CAP_MB[role]);
    }
  });

  it('keeps the Radiance path string-identical for the worlds that do not opt in (blast radius)', () => {
    for (const role of ['gold', 'night'] as const) {
      expect(hdriUrlFor(MANIFEST, role, 'radiance')).toBe(hdriUrl(role));
      expect(hdriUrlFor(MANIFEST, role)).toBe(hdriUrl(role));
      expect(hdriFileFor(MANIFEST, role, PLAZA_HDRI_FORMAT)).toBe(`env/hdri/${role}.jpg`);
    }
  });
});

describe.skipIf(!HAS_BINARIES || !HAS_MANIFEST)('plaza critical set (files on disk)', () => {
  it('every critical file exists and its manifest kb (in the encoding on disk) matches the bytes on disk', () => {
    const entries = new Map<string, { kb: number; castKb?: number }>([
      ...MANIFEST.environment.map((entry) => [entry.file, entry] as const),
      ...MANIFEST.props.map((entry) => [entry.file, entry] as const),
    ]);
    for (const role of ['gold', 'night'] as const) {
      for (const file of criticalFiles(role)) {
        expect(existsSync(path.join(MIRROR, file)), file).toBe(true);
        const entry = entries.get(file);
        expect(entry, file).toBeDefined();
        const expected = entry ? expectedDiskKb(entry, file) : -1;
        expect(Math.abs(diskBytes(file) / 1024 - expected), file).toBeLessThanOrEqual(1);
      }
    }
  });

  it(`meets the caps in bytes on disk (day ≤ ${CAP_MB.gold} MB, night ≤ ${CAP_MB.night} MB)`, () => {
    for (const role of ['gold', 'night'] as const) {
      const total = criticalFiles(role).reduce((sum, file) => sum + diskBytes(file), 0);
      expect(total / 1e6).toBeLessThanOrEqual(CAP_MB[role]);
    }
  });

  it('ships gain-map JPEGs the HDRJPGLoader parser accepts (XMP metadata + MPF recovery image)', async () => {
    const { extractGainmapFromJPEG } = await import('@monogrid/gainmap-js');
    for (const role of ['gold', 'night'] as const) {
      const bytes = new Uint8Array(readFileSync(path.join(MIRROR, `env/hdri/${role}.jpg`)));
      const { sdr, gainMap, metadata } = await extractGainmapFromJPEG(bytes);
      expect(metadata.hdrCapacityMax).toBeGreaterThan(0);
      expect(Math.max(...metadata.gainMapMax)).toBeGreaterThan(0);
      const sdrMeta = await sharp(Buffer.from(sdr)).metadata();
      const gainMeta = await sharp(Buffer.from(gainMap)).metadata();
      // 1k equirect base; the recovery map is full or half resolution, same 2:1 aspect.
      expect(sdrMeta.width).toBe(1024);
      expect(sdrMeta.height).toBe(512);
      expect((gainMeta.width ?? 0) / (gainMeta.height ?? 1)).toBe(2);
      expect([512, 1024]).toContain(gainMeta.width);
    }
  });
});
