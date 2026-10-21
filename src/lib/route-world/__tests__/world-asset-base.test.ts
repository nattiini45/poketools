import { afterEach, describe, expect, it, vi } from 'vitest';
import { getWorldAssetBase, isUsableAssetBase, WORLD_MANIFEST_FILE, worldAssetUrl } from '../model-manifest';

const KEY = 'NEXT_PUBLIC_WORLD_ASSETS_URL';
const original = process.env[KEY];

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe('world asset base', () => {
  it('accepts http(s) URLs and root-relative paths', () => {
    expect(isUsableAssetBase('https://example.supabase.co/storage/v1/object/public/world-assets')).toBe(true);
    expect(isUsableAssetBase('http://localhost:3111/models/world')).toBe(true);
    expect(isUsableAssetBase('/models/world')).toBe(true);
  });

  it('rejects drive paths, protocol-relative and bare relative values', () => {
    expect(isUsableAssetBase('C:/Program Files/Git/models/world')).toBe(false);
    expect(isUsableAssetBase('//cdn.example.com/world')).toBe(false);
    expect(isUsableAssetBase('models/world')).toBe(false);
  });

  it('falls back to the local mirror when the configured base is unusable (MSYS path conversion)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env[KEY] = 'C:/Program Files/Git/models/world';
    expect(getWorldAssetBase()).toBe('/models/world');
    expect(worldAssetUrl(WORLD_MANIFEST_FILE)).toBe('/models/world/manifest.v3.json');
    warn.mockRestore();
  });

  it('keeps a valid configured base and trims trailing slashes', () => {
    process.env[KEY] = 'https://cdn.example.com/world-assets/';
    expect(getWorldAssetBase()).toBe('https://cdn.example.com/world-assets');
  });
});
