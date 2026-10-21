import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isRouteAssetArm,
  parseRouteAssetArm,
  resetRouteAssetBaseOverrideForTests,
  routeAssetArm,
  routeAssetArmBase,
} from '../asset-base-override';
import { getWorldAssetBase, worldAssetUrl, worldManifestFile } from '../model-manifest';

/**
 * D42 commit G: `?routeDebug=1&routeAssetBase=<arm>` selects an asset mirror
 * client-side only. The server render and production always use the
 * configured base (`NEXT_PUBLIC_WORLD_ASSETS_URL`, else the local mirror).
 */

type WindowStub = { location: { search: string } };

function stubWindow(search: string): void {
  (globalThis as unknown as { window?: WindowStub }).window = { location: { search } };
}

function clearWindow(): void {
  delete (globalThis as unknown as { window?: WindowStub }).window;
}

describe('asset-arm override: the parse', () => {
  it('accepts the whitelist and the candidate pattern only', () => {
    for (const arm of ['a', 'd42', 'd42c', 'd42m', 'cand-hq10', 'cand-high8', 'cand-nq', 'cand-hq10-r2']) {
      expect(isRouteAssetArm(arm)).toBe(true);
    }
    for (const arm of ['', 'b', 'd42x', 'D42', '../d42', 'd42/..', 'cand-', 'cand-HQ', 'cand-a/b', 'https://x', '/models', `cand-${'x'.repeat(40)}`]) {
      expect(isRouteAssetArm(arm)).toBe(false);
    }
  });

  it('needs routeDebug=1 and ignores anything off the whitelist', () => {
    expect(parseRouteAssetArm('?routeDebug=1&routeAssetBase=d42')).toBe('d42');
    expect(parseRouteAssetArm('?routeDebug=1&routeAssetBase=cand-hq10')).toBe('cand-hq10');
    expect(parseRouteAssetArm('?routeAssetBase=d42')).toBeNull();
    expect(parseRouteAssetArm('?routeDebug=0&routeAssetBase=d42')).toBeNull();
    expect(parseRouteAssetArm('?routeDebug=1&routeAssetBase=..%2Fsecret')).toBeNull();
    expect(parseRouteAssetArm('?routeDebug=1')).toBeNull();
  });

  it('resolves every arm but `a` under the local mirror root', () => {
    expect(routeAssetArmBase('a', '/models/world')).toBeNull();
    expect(routeAssetArmBase('d42', '/models/world')).toBe('/models/world/d42');
    expect(routeAssetArmBase('cand-hq10', '/models/world/')).toBe('/models/world/cand-hq10');
  });
});

describe('asset-arm override: getWorldAssetBase', () => {
  beforeEach(() => {
    resetRouteAssetBaseOverrideForTests();
    vi.stubEnv('NEXT_PUBLIC_WORLD_ASSETS_URL', '');
  });
  afterEach(() => {
    clearWindow();
    resetRouteAssetBaseOverrideForTests();
    vi.unstubAllEnvs();
  });

  it('a client debug page reads the arm (manifest and every file under it)', () => {
    stubWindow('?routeDebug=1&world=gallery&routeAssetBase=d42');
    expect(getWorldAssetBase()).toBe('/models/world/d42');
    // D42 commit P: the arm directory holds the bake's manifest.json (the env base reads manifest.v3.json)
    expect(worldAssetUrl(worldManifestFile())).toBe('/models/world/d42/manifest.json');
    expect(worldAssetUrl('models/regular/907.glb')).toBe('/models/world/d42/models/regular/907.glb');
    expect(routeAssetArm()).toBe('d42');
  });

  it('`a` keeps the configured base (the env bucket included)', () => {
    vi.stubEnv('NEXT_PUBLIC_WORLD_ASSETS_URL', 'https://bucket.example/world-assets/');
    stubWindow('?routeDebug=1&routeAssetBase=a');
    expect(getWorldAssetBase()).toBe('https://bucket.example/world-assets');
    expect(routeAssetArm()).toBe('a');
  });

  it('without routeDebug, or with an unknown arm, nothing changes', () => {
    stubWindow('?routeAssetBase=d42');
    expect(getWorldAssetBase()).toBe('/models/world');
    resetRouteAssetBaseOverrideForTests();
    stubWindow('?routeDebug=1&routeAssetBase=evil');
    expect(getWorldAssetBase()).toBe('/models/world');
  });

  it('is read once per page: a later URL change cannot split one page across two mirrors', () => {
    stubWindow('?routeDebug=1&routeAssetBase=d42c');
    expect(getWorldAssetBase()).toBe('/models/world/d42c');
    stubWindow('?routeDebug=1&routeAssetBase=d42m');
    expect(getWorldAssetBase()).toBe('/models/world/d42c');
  });

  it('production ignores it (the env base only)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    stubWindow('?routeDebug=1&routeAssetBase=d42');
    expect(getWorldAssetBase()).toBe('/models/world');
    expect(worldManifestFile()).toBe('manifest.v3.json');
    expect(routeAssetArm()).toBeNull();
  });

  it('the server render ignores it (no window), and its markup carries the env base', () => {
    clearWindow();
    expect(getWorldAssetBase()).toBe('/models/world');
    const html = renderToString(createElement('a', { href: worldAssetUrl(worldManifestFile()) }, 'manifest'));
    expect(html).toContain('href="/models/world/manifest.v3.json"');
    // The server pass installed nothing: a client page of the same module reads its own URL.
    stubWindow('?routeDebug=1&routeAssetBase=d42');
    expect(getWorldAssetBase()).toBe('/models/world/d42');
  });

  it('hydration: no world root renders an asset URL on the server (the scenes are ssr:false)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(__dirname, '..', '..', '..', 'components', 'world');
    const roots = [
      ['themes', 'sakura', 'SakuraRouteWorld.tsx'],
      ['themes', 'mountain', 'MountainRouteWorld.tsx'],
      ['themes', 'clouds', 'CloudsRouteWorld.tsx'],
      ['evoliga', 'route', 'EvoligaRouteWorld.tsx'],
      ['route', 'gallery', 'GalleryWorld.tsx'],
    ];
    for (const parts of roots) {
      const source = readFileSync(join(root, ...parts), 'utf8');
      expect(source, parts.join('/')).toMatch(/dynamic\(\(\) => import\([^)]*\), \{ ssr: false \}\)/);
      expect(source, parts.join('/')).not.toMatch(/worldAssetUrl|getWorldAssetBase|figureUrl|propUrl/);
    }
  });
});
