import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRouteAssetBaseOverrideForTests } from '@/lib/route-world/asset-base-override';
import {
  __setWorldManifestForTests,
  loadWorldManifest,
  WORLD_MANIFEST_FILE,
  worldManifestFile,
} from '@/lib/route-world/model-manifest';

/**
 * DATA-PLAN fix 7 (D37): the manifest keeps its fixed name while assets get
 * hashed names, so it must be REVALIDATED (ETag) on every page, never served
 * from a force-cache copy that pins an old publish.
 *
 * D42 commit P: on the configured base the loader reads the shipped
 * `WORLD_MANIFEST_FILE` (`manifest.v3.json`), never the published v2
 * `manifest.json` that older deployed builds read; a routeDebug mirror arm
 * reads its own frozen `manifest.json`.
 */

type WindowStub = { location: { search: string } };

function stubWindow(search: string): void {
  (globalThis as unknown as { window?: WindowStub }).window = { location: { search } };
}

function clearWindow(): void {
  delete (globalThis as unknown as { window?: WindowStub }).window;
}

const EMPTY = { version: 3, generatedAt: '', figures: [], props: [], environment: [], missingForms: [], pool: null };

async function fetchedUrl(): Promise<{ url: string; init: RequestInit }> {
  const stub = vi.fn(async () => new Response(JSON.stringify(EMPTY), { status: 200 }));
  vi.stubGlobal('fetch', stub);
  __setWorldManifestForTests(null);
  const loaded = await loadWorldManifest();
  expect(loaded.version).toBe(3);
  expect(stub).toHaveBeenCalledTimes(1);
  const [url, init] = stub.mock.calls[0] as unknown as [string, RequestInit];
  return { url, init };
}

describe('loadWorldManifest fetch', () => {
  beforeEach(() => {
    resetRouteAssetBaseOverrideForTests();
    vi.stubEnv('NEXT_PUBLIC_WORLD_ASSETS_URL', '');
  });
  afterEach(() => {
    __setWorldManifestForTests(null);
    clearWindow();
    resetRouteAssetBaseOverrideForTests();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('the shipped manifest name is manifest.v3.json', () => {
    expect(WORLD_MANIFEST_FILE).toBe('manifest.v3.json');
  });

  it("fetches the shipped manifest with cache: 'no-cache'", async () => {
    const { url, init } = await fetchedUrl();
    expect(url).toBe('/models/world/manifest.v3.json');
    expect(init).toEqual({ cache: 'no-cache' });
  });

  it('reads manifest.v3.json on the configured (env) base, the bucket included', async () => {
    vi.stubEnv('NEXT_PUBLIC_WORLD_ASSETS_URL', 'https://bucket.example/storage/v1/object/public/world-assets/');
    const { url } = await fetchedUrl();
    expect(url).toBe('https://bucket.example/storage/v1/object/public/world-assets/manifest.v3.json');
  });

  it('production reads manifest.v3.json on the env base, a routeDebug arm in the URL notwithstanding', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_WORLD_ASSETS_URL', 'https://bucket.example/world-assets');
    stubWindow('?routeDebug=1&routeAssetBase=d42m');
    expect(worldManifestFile()).toBe(WORLD_MANIFEST_FILE);
    const { url } = await fetchedUrl();
    expect(url).toBe('https://bucket.example/world-assets/manifest.v3.json');
  });

  it('the `a` arm is the env base: manifest.v3.json', async () => {
    stubWindow('?routeDebug=1&routeAssetBase=a');
    expect(worldManifestFile()).toBe(WORLD_MANIFEST_FILE);
    const { url } = await fetchedUrl();
    expect(url).toBe('/models/world/manifest.v3.json');
  });

  it('a mirror arm reads its frozen manifest.json from the arm directory', async () => {
    stubWindow('?routeDebug=1&routeAssetBase=d42m');
    expect(worldManifestFile()).toBe('manifest.json');
    const { url } = await fetchedUrl();
    expect(url).toBe('/models/world/d42m/manifest.json');
  });

  it('every mirror arm (fixed and candidate) resolves manifest.json; an ignored arm keeps the shipped name', () => {
    for (const arm of ['d42', 'd42c', 'd42m', 'cand-nq-tri']) {
      resetRouteAssetBaseOverrideForTests();
      stubWindow(`?routeDebug=1&routeAssetBase=${arm}`);
      expect(worldManifestFile(), arm).toBe('manifest.json');
    }
    resetRouteAssetBaseOverrideForTests();
    stubWindow('?routeAssetBase=d42m');
    expect(worldManifestFile()).toBe(WORLD_MANIFEST_FILE);
  });
});
