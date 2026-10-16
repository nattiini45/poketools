import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WORLD_MANIFEST_FILE, type WorldManifest } from '@/lib/route-world/model-manifest';
import { readMirrorManifest } from '@/lib/route-world/__tests__/world-manifest-fixture';

/**
 * D42 N7a: the plaza façade kit's five GLBs start downloading together, beside
 * the perimeter's stone / slate texture sets, instead of one after another
 * behind them (five sequential `useFigureGLTF` suspensions, about 160 ms each).
 */

const drei = vi.hoisted(() => ({ preloads: [] as string[] }));

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
    setTranscoderPath() {
      return this;
    }
    setWorkerLimit() {
      return this;
    }
    detectSupport() {
      return this;
    }
  },
}));

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const { manifest: TRACKED, present: HAS_MANIFEST }: { manifest: WorldManifest; present: boolean } = readMirrorManifest(WORLD_MANIFEST_FILE);
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

describe('N7a: the façade kit prefetch', () => {
  beforeEach(() => {
    vi.resetModules();
    drei.preloads.length = 0;
  });

  it.skipIf(!HAS_MANIFEST)('starts every kit module once, however often it is called (the kit preload is called once)', async () => {
    const { prefetchFacadeKit } = await import('@/components/world/evoliga/route/plaza/facade-kit');
    const { kitBayUrls } = await import('@/lib/route-world/world-env');
    const urls = kitBayUrls(TRACKED);
    expect(urls).not.toBeNull();
    prefetchFacadeKit(TRACKED);
    prefetchFacadeKit(TRACKED);
    prefetchFacadeKit(TRACKED);
    expect([...drei.preloads].sort()).toEqual(Object.values(urls!).sort());
    expect(new Set(drei.preloads).size).toBe(5);
  });

  it.skipIf(!HAS_MANIFEST)('a manifest without the whole kit prefetches nothing (the procedural writer path)', async () => {
    const { prefetchFacadeKit } = await import('@/components/world/evoliga/route/plaza/facade-kit');
    prefetchFacadeKit({ ...TRACKED, environment: TRACKED.environment.filter((entry) => !entry.file.includes('bay-shopfront')) });
    expect(drei.preloads).toEqual([]);
  });

  it('a prefetch is not a residency preload (the perimeter boundary holds the reveal) and does not wait for the KTX2 arm', async () => {
    const loader = await import('@/components/world/route/figures/figure-loader');
    expect(loader.isFigureLoaderArmed()).toBe(false);
    loader.prefetchFigureGLB('/models/world/env/kit/dormer.glb');
    expect(drei.preloads).toEqual(['/models/world/env/kit/dormer.glb']);
    expect(loader.pendingFigureLoads()).toBe(0);
  });

  it('the kit hook prefetches before its first read, and the perimeter prefetches before its texture sets', () => {
    const kit = read('src', 'components', 'world', 'evoliga', 'route', 'plaza', 'facade-kit.tsx');
    const hook = kit.slice(kit.indexOf('export function useFacadeKit'));
    expect(hook.indexOf('prefetchFacadeKit(manifest)')).toBeGreaterThan(0);
    expect(hook.indexOf('prefetchFacadeKit(manifest)')).toBeLessThan(hook.indexOf('useFigureGLTF('));
    const hall = read('src', 'components', 'world', 'evoliga', 'route', 'plaza', 'PlazaHall.tsx');
    const sourced = hall.slice(hall.indexOf('function SourcedPerimeter'));
    expect(sourced.indexOf('prefetchFacadeKit(')).toBeGreaterThan(0);
    expect(sourced.indexOf('prefetchFacadeKit(')).toBeLessThan(sourced.indexOf('useThemeTextureRoleActive('));
  });

  // The mirror's GLBs are git-ignored: checked wherever the local mirror exists.
  const kitOnDisk = existsSync(join(ROOT, 'public', 'models', 'world', 'env', 'kit', 'dormer.glb'));
  it.skipIf(!kitOnDisk || !HAS_MANIFEST)('the kit GLBs carry no textures (safe to fetch before the KTX2 arm)', () => {
    const kitFiles = TRACKED.environment.filter((entry) => entry.file.startsWith('env/kit/') && entry.file.endsWith('.glb'));
    expect(kitFiles).toHaveLength(5);
    for (const entry of kitFiles) {
      const bytes = readFileSync(join(ROOT, 'public', 'models', 'world', entry.file));
      const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as { images?: unknown[]; extensionsUsed?: string[] };
      expect(json.images ?? [], entry.file).toHaveLength(0);
      expect(json.extensionsUsed ?? [], entry.file).not.toContain('KHR_texture_basisu');
    }
  });
});
