import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORLD_MANIFEST_FILE, type WorldManifest } from '@/lib/route-world/model-manifest';
import { readMirrorManifest } from '@/lib/route-world/__tests__/world-manifest-fixture';

/**
 * D42 N7b: GLB fetches no longer wait for the canvas. A preload starts at
 * once (the KTX2 transcoder arms lazily: created only when a GLB asks for a
 * KTX2 texture, and such a request waits for the renderer), and the GLBs a
 * world's manifest alone names start when its scene generation begins
 * (`registerGenerationPrefetch`; the plaza's list is `plazaKnownGLBs`).
 */

const drei = vi.hoisted(() => ({ preloads: [] as string[] }));
const ktx = vi.hoisted(() => ({ created: 0, detect: [] as unknown[], loads: [] as string[] }));

vi.mock('@react-three/drei', () => {
  const pending = new Promise<void>(() => {});
  const useGLTF = Object.assign(
    vi.fn(() => {
      throw pending;
    }),
    {
      preload: vi.fn((url: string) => {
        drei.preloads.push(url);
      }),
    },
  );
  return { useGLTF };
});

vi.mock('three/examples/jsm/loaders/KTX2Loader.js', () => ({
  KTX2Loader: class {
    constructor() {
      ktx.created += 1;
    }
    setTranscoderPath() {
      return this;
    }
    setWorkerLimit() {
      return this;
    }
    detectSupport(gl: unknown) {
      ktx.detect.push(gl);
      return this;
    }
    load(url: string) {
      ktx.loads.push(url);
    }
  },
}));

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const { manifest: TRACKED, present: HAS_MANIFEST }: { manifest: WorldManifest; present: boolean } = readMirrorManifest(WORLD_MANIFEST_FILE);

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('N7b: preloads start at once; KTX2 arms lazily', () => {
  beforeEach(() => {
    vi.resetModules();
    drei.preloads.length = 0;
    ktx.created = 0;
    ktx.detect.length = 0;
    ktx.loads.length = 0;
  });

  it('a preload before armFigureLoader starts its fetch immediately (no queue)', async () => {
    const loader = await import('../figures/figure-loader');
    expect(loader.isFigureLoaderArmed()).toBe(false);
    loader.preloadFigure('/models/world/models/regular/1.glb');
    expect(drei.preloads).toEqual(['/models/world/models/regular/1.glb']);
    expect(loader.pendingFigureLoads()).toBe(1);
  });

  it('no transcoder exists until a KTX2 texture is asked for; an early one waits for the renderer', async () => {
    const loader = await import('../figures/figure-loader');
    let standIn: { load: (url: string, onLoad: () => void, onProgress: undefined, onError: () => void) => void } | null = null;
    const fake = {
      setMeshoptDecoder: () => fake,
      setKTX2Loader: (value: never) => {
        standIn = value;
        return fake;
      },
      register: () => fake,
    };
    loader.extendFigureLoader(fake as never);
    expect(standIn).not.toBeNull();
    expect(loader.isKtx2TranscoderCreated()).toBe(false);
    expect(ktx.created).toBe(0);
    // A KTX2 texture requested before the canvas exists: waits.
    standIn!.load('/models/world/tex/a.ktx2', () => {}, undefined, () => {});
    expect(ktx.created).toBe(0);
    const gl = { id: 'renderer' };
    loader.armFigureLoader(gl as never);
    expect(ktx.created).toBe(1);
    expect(ktx.detect).toEqual([gl]);
    expect(ktx.loads).toEqual(['/models/world/tex/a.ktx2']);
    // After the arm: straight through, one transcoder for the page.
    standIn!.load('/models/world/tex/b.ktx2', () => {}, undefined, () => {});
    expect(ktx.created).toBe(1);
    expect(ktx.loads).toEqual(['/models/world/tex/a.ktx2', '/models/world/tex/b.ktx2']);
  });

  it('arming without any KTX2 request creates no transcoder (the manifest has no KTX2 file)', async () => {
    const loader = await import('../figures/figure-loader');
    loader.armFigureLoader({} as never);
    expect(loader.isFigureLoaderArmed()).toBe(true);
    expect(loader.isKtx2TranscoderCreated()).toBe(false);
    expect(ktx.created).toBe(0);
  });
});

describe.skipIf(!HAS_MANIFEST)('N7b: manifest-known GLBs at generation begin', () => {
  beforeEach(() => {
    vi.resetModules();
    drei.preloads.length = 0;
  });
  afterEach(async () => {
    const readiness = await import('../world-readiness');
    readiness.resetSceneReadiness();
  });

  async function modules() {
    const manifest = await import('@/lib/route-world/model-manifest');
    manifest.__setWorldManifestForTests(TRACKED);
    const readiness = await import('../world-readiness');
    readiness.resetSceneReadiness();
    const prefetch = await import('../figures/generation-prefetch');
    prefetch.resetGenerationPrefetchForTests();
    return { readiness, prefetch };
  }

  it('a generation of the theme begins → its selected GLBs are fetched once the manifest resolves', async () => {
    const { readiness, prefetch } = await modules();
    const select = vi.fn(() => ['/models/world/env/kit/dormer.glb', '/models/world/props/x.glb']);
    prefetch.registerGenerationPrefetch('plaza', select);
    expect(select).not.toHaveBeenCalled();
    readiness.beginSceneGeneration('plaza:day');
    expect(prefetch.loadingThemeId()).toBe('plaza');
    await flush();
    expect(select).toHaveBeenCalledTimes(1);
    expect(drei.preloads).toEqual(['/models/world/env/kit/dormer.glb', '/models/world/props/x.glb']);
  });

  it('a late registration (the scene chunk evaluates after the begin) runs at once', async () => {
    const { readiness, prefetch } = await modules();
    readiness.beginSceneGeneration('plaza:night');
    prefetch.registerGenerationPrefetch('plaza', () => ['/models/world/env/kit/dormer.glb']);
    await flush();
    expect(drei.preloads).toEqual(['/models/world/env/kit/dormer.glb']);
  });

  it('another theme’s generation fetches nothing; an abandoned generation fetches nothing', async () => {
    const { readiness, prefetch } = await modules();
    const select = vi.fn(() => ['/models/world/env/kit/dormer.glb']);
    prefetch.registerGenerationPrefetch('plaza', select);
    readiness.beginSceneGeneration('sakura:day');
    await flush();
    expect(select).not.toHaveBeenCalled();
    readiness.beginSceneGeneration('plaza:day');
    readiness.beginSceneGeneration('sakura:night'); // abandoned before the manifest resolved
    await flush();
    expect(drei.preloads).toEqual([]);
  });

  it('a throwing selector loses only its own prefetch: the others run, nothing rejects (Kilo PR #65)', async () => {
    const { readiness, prefetch } = await modules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
      prefetch.registerGenerationPrefetch('plaza', () => {
        throw new Error('selector bug');
      });
      prefetch.registerGenerationPrefetch('plaza', () => ['/models/world/env/kit/dormer.glb']);
      readiness.beginSceneGeneration('plaza:day');
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(drei.preloads).toEqual(['/models/world/env/kit/dormer.glb']);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
      warn.mockRestore();
    }
  });

  it('each URL is fetched once per page, across generations', async () => {
    const { readiness, prefetch } = await modules();
    prefetch.registerGenerationPrefetch('plaza', () => ['/models/world/env/kit/dormer.glb']);
    readiness.beginSceneGeneration('plaza:day');
    await flush();
    readiness.resetSceneReadiness();
    readiness.beginSceneGeneration('plaza:night');
    await flush();
    expect(drei.preloads).toEqual(['/models/world/env/kit/dormer.glb']);
  });
});

describe('N7b: the plaza list (plazaKnownGLBs)', () => {
  it.skipIf(!HAS_MANIFEST)('names the kit, the lamp, the gate crest and the hero props of the mirror manifest', async () => {
    const { plazaKnownGLBs, PLAZA_GATE_CREST_PROP, PLAZA_LAMP_PROP } = await import('@/components/world/evoliga/route/plaza/plaza-prefetch');
    const urls = plazaKnownGLBs(TRACKED);
    const kit = urls.filter((url) => url.includes('/env/kit/'));
    expect(kit).toHaveLength(5);
    for (const name of [PLAZA_LAMP_PROP, PLAZA_GATE_CREST_PROP, 'led-board-cabinet']) {
      const entry = TRACKED.props.find((prop) => prop.name === name);
      expect(entry, name).toBeDefined();
      expect(urls.some((url) => url.endsWith(entry!.file))).toBe(true);
    }
    expect(urls).toHaveLength(8);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('stays in sync with the mounts it mirrors, and the plaza registers it', () => {
    const plaza = join(ROOT, 'src', 'components', 'world', 'evoliga', 'route', 'plaza');
    expect(readFileSync(join(plaza, 'ChallengeGate.tsx'), 'utf8')).toMatch(/const CREST_PROP = 'gate-crest-ornament';/);
    const hall = readFileSync(join(plaza, 'PlazaHall.tsx'), 'utf8');
    expect(hall).toMatch(/const LAMP_PROP = PLAZA_LAMP_PROP;/);
    expect(hall).toMatch(/registerGenerationPrefetch\(plazaTheme\.id, plazaKnownGLBs\)/);
  });
});
