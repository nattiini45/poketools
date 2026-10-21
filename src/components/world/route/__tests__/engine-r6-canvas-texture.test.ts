import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { boardPageTexture } from '@/components/world/evoliga/route/plaza/board/Board';
import { deskCanvasTexture } from '@/components/world/evoliga/route/plaza/CenterDesk';
import { gateCanvasTexture } from '@/components/world/evoliga/route/plaza/ChallengeGate';
import { holoCanvasTexture } from '@/components/world/evoliga/route/plaza/DeskHolo';
import { paintedCanvasTexture as sakuraTexture } from '@/components/world/themes/sakura/content/use-painted-texture';
import { paintedCanvasTexture as mountainTexture } from '@/components/world/themes/mountain/content/use-painted-texture';
import { paintedCanvasTexture as cloudsTexture } from '@/components/world/themes/clouds/content/use-painted-texture';
import { releaseDataTextureDisposals, retainDataTextureDisposals } from '../QualityGovernor';

/**
 * ENGINE r6 (R6-BRIEF §3.2, E2): the content faces no longer encode their
 * painted canvas to a PNG data URL (`toDataURL`, a synchronous main-thread
 * encode of up to 2048 px per face) and decode it again through
 * `TextureLoader`. The canvas itself is the texture's image, made inside the
 * queued paint job and disposed by the effect's cleanup.
 *
 * Pixel neutrality: WebGL uploads an image element and a canvas under the
 * same unpack state (flipY, premultiply, colour-space conversion, alignment)
 * to the same texels, and `toDataURL` stored exactly the canvas's pixels. So
 * the proof here is that every face's texture carries the loader path's GPU
 * state, field for field; the rendered-pixel proof is the capture diff
 * (`engine-e2-r6-*` stills against the same-tree before set).
 */

const SRC = join(process.cwd(), 'src');
const read = (file: string) => readFileSync(file, 'utf8');

/** Every .ts/.tsx source under `dir`, tests excluded. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__') out.push(...sources(path));
    } else if (/\.tsx?$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

const posix = (path: string) => relative(process.cwd(), path).split(sep).join('/');

/**
 * The R6-BRIEF debug bridges (the harness's canvas read-back) are the only
 * exemption: `CaptureFramebuffer`, split out of RouteWorldCanvas.tsx (M15).
 */
const DEBUG_BRIDGE = 'src/components/world/route/canvas/capture-bridges.tsx';
const DEBUG_BRIDGE_MAX = 2;
const TO_DATA_URL = /\.toDataURL\s*\(/g;

/** The eleven former `toDataURL` sites (R6-BRIEF header), by file. */
const E2_FILES = [
  'src/components/world/evoliga/route/plaza/board/Board.tsx',
  'src/components/world/evoliga/route/plaza/CenterDesk.tsx',
  'src/components/world/evoliga/route/plaza/ChallengeGate.tsx',
  'src/components/world/evoliga/route/plaza/DeskHolo.tsx',
  'src/components/world/themes/sakura/content/use-painted-texture.ts',
  'src/components/world/themes/mountain/content/use-painted-texture.ts',
  'src/components/world/themes/clouds/content/use-painted-texture.ts',
] as const;

describe('no toDataURL in world content paths (ENGINE r6, E2)', () => {
  it('no world or route-world source encodes a canvas to a data URL outside the debug bridges', () => {
    const offenders: string[] = [];
    let bridgeCalls = 0;
    for (const file of [...sources(join(SRC, 'components', 'world')), ...sources(join(SRC, 'lib', 'route-world'))]) {
      const calls = read(file).match(TO_DATA_URL)?.length ?? 0;
      if (calls === 0) continue;
      if (posix(file) === DEBUG_BRIDGE) bridgeCalls += calls;
      else offenders.push(`${posix(file)} (${calls})`);
    }
    expect(offenders).toEqual([]);
    expect(bridgeCalls).toBeLessThanOrEqual(DEBUG_BRIDGE_MAX);
  });

  it('the former sites build no TextureLoader and make their texture over the painted canvas in the queued job', () => {
    for (const file of E2_FILES) {
      const source = read(join(process.cwd(), file));
      expect(source, file).not.toMatch(/new\s+THREE\.TextureLoader\s*\(/);
      expect(source, file).not.toMatch(/Promise\.all\(/);
      // One texture per paint job: the helper wraps the canvas the job painted.
      expect(source, file).toMatch(/new THREE\.Texture\(canvas\)/);
      expect(source, file).toMatch(/queuePaint\(/);
    }
  });
});

/** Fields that decide what the GPU holds and how it is sampled. */
const GPU_STATE = [
  'flipY',
  'premultiplyAlpha',
  'unpackAlignment',
  'format',
  'type',
  'internalFormat',
  'colorSpace',
  'mapping',
  'channel',
  'wrapS',
  'wrapT',
  'magFilter',
  'minFilter',
  'generateMipmaps',
  'anisotropy',
  'matrixAutoUpdate',
] as const;

function gpuState(tex: THREE.Texture): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const key of GPU_STATE) state[key] = tex[key];
  state.offset = tex.offset.toArray();
  state.repeat = tex.repeat.toArray();
  state.center = tex.center.toArray();
  state.rotation = tex.rotation;
  return state;
}

interface LoaderSettings {
  colorSpace: THREE.ColorSpace;
  wrap: THREE.Wrapping;
  anisotropy?: number;
}

/**
 * The retired path, replayed without a network: `TextureLoader.load` made a
 * plain `Texture`, set `image` + `needsUpdate` (three.core TextureLoader),
 * then each site's onLoad callback set exactly these fields.
 */
function loaderPathTexture(image: object, settings: LoaderSettings): THREE.Texture {
  const tex = new THREE.Texture();
  tex.image = image;
  tex.needsUpdate = true;
  tex.colorSpace = settings.colorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = settings.wrap;
  tex.wrapT = settings.wrap;
  if (settings.anisotropy !== undefined) tex.anisotropy = settings.anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/** A painted canvas stand-in: three only reads the image's size and hands it to texImage2D. */
function fakeCanvas(width: number, height: number): HTMLCanvasElement {
  return { width, height } as unknown as HTMLCanvasElement;
}

const SRGB_CLAMP: LoaderSettings = { colorSpace: THREE.SRGBColorSpace, wrap: THREE.ClampToEdgeWrapping };

const SITES: { name: string; size: [number, number]; make: (canvas: HTMLCanvasElement) => THREE.Texture; settings: LoaderSettings }[] = [
  { name: 'Board page (2048×1184)', size: [2048, 1184], make: boardPageTexture, settings: { ...SRGB_CLAMP, anisotropy: 4 } },
  {
    name: 'CenterDesk roster screen',
    size: [692, 1024],
    make: (c) => deskCanvasTexture(c, THREE.ClampToEdgeWrapping, THREE.SRGBColorSpace),
    settings: SRGB_CLAMP,
  },
  {
    name: 'CenterDesk fascia (repeat)',
    size: [512, 128],
    make: (c) => deskCanvasTexture(c, THREE.RepeatWrapping, THREE.SRGBColorSpace),
    settings: { colorSpace: THREE.SRGBColorSpace, wrap: THREE.RepeatWrapping },
  },
  {
    name: 'CenterDesk apron roughness (repeat, no colour space)',
    size: [512, 512],
    make: (c) => deskCanvasTexture(c, THREE.RepeatWrapping, THREE.NoColorSpace),
    settings: { colorSpace: THREE.NoColorSpace, wrap: THREE.RepeatWrapping },
  },
  { name: 'ChallengeGate plaque / field / CTA', size: [640, 896], make: gateCanvasTexture, settings: SRGB_CLAMP },
  { name: 'DeskHolo field', size: [768, 512], make: holoCanvasTexture, settings: SRGB_CLAMP },
  { name: 'sakura content', size: [2560, 1440], make: sakuraTexture, settings: SRGB_CLAMP },
  { name: 'mountain content', size: [512, 224], make: mountainTexture, settings: SRGB_CLAMP },
  { name: 'clouds content', size: [2560, 1024], make: cloudsTexture, settings: SRGB_CLAMP },
];

describe('canvas-sourced face textures keep the loader path\'s GPU state (ENGINE r6, E2 pixel-neutral)', () => {
  it.each(SITES)('$name', ({ size, make, settings }) => {
    const canvas = fakeCanvas(size[0], size[1]);
    const made = make(canvas);
    const before = loaderPathTexture({ width: size[0], height: size[1] }, settings);
    expect(gpuState(made)).toEqual(gpuState(before));
    // The canvas the job painted is the image: same size, nothing re-encoded.
    expect(made.image).toBe(canvas);
    // Flagged for upload (the warm's initTexture skips version 0).
    expect(made.version).toBeGreaterThan(0);
    // Upload orientation and alpha of the old image path: rows flipped by the
    // unpack state (no ImageBitmap snapshot, whose flipY WebGL ignores),
    // straight (non-premultiplied) alpha as the PNG stored it.
    expect(made.flipY).toBe(true);
    expect(made.premultiplyAlpha).toBe(false);
    made.dispose();
  });

  it('each run makes its own texture (never memoized across effect runs, PB-003)', () => {
    const canvas = fakeCanvas(640, 896);
    const a = gateCanvasTexture(canvas);
    const b = gateCanvasTexture(canvas);
    expect(a).not.toBe(b);
    a.dispose();
    b.dispose();
  });
});

describe('a repainted face still frees its old upload after a governor step (ENGINE r6, E2)', () => {
  afterEach(() => releaseDataTextureDisposals());

  it('the face textures are plain Textures, so the governor\'s CanvasTexture retain never holds them', () => {
    retainDataTextureDisposals();
    // 512×128 (the desk fascia) is under RETAIN_DATA_TEXTURE_MAX_BYTES: a
    // CanvasTexture this size would be retained for the canvas's life.
    const face = deskCanvasTexture(fakeCanvas(512, 128), THREE.RepeatWrapping, THREE.SRGBColorSpace);
    expect(face).not.toBeInstanceOf(THREE.CanvasTexture);
    let freed = 0;
    face.addEventListener('dispose', () => {
      freed += 1;
    });
    face.dispose();
    expect(freed).toBe(1);

    const retained = new THREE.CanvasTexture(fakeCanvas(512, 128));
    let retainedFreed = 0;
    retained.addEventListener('dispose', () => {
      retainedFreed += 1;
    });
    retained.dispose();
    expect(retainedFreed).toBe(0);
  });
});
