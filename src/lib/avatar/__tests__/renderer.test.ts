import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../manifest', () => ({
  findOption: vi.fn(),
  getAvatarAssetUrl: vi.fn(),
}));

vi.mock('../preloader', () => ({
  loadImage: vi.fn(),
}));

import { getLayerUrls, renderAvatar, compositeToBlob, compositeToBase64 } from '../renderer';
import { findOption, getAvatarAssetUrl } from '../manifest';
import { loadImage } from '../preloader';
import type { AvatarConfig } from '@/types/avatar';

const mockFindOption = vi.mocked(findOption);
const mockGetAvatarAssetUrl = vi.mocked(getAvatarAssetUrl);
const mockLoadImage = vi.mocked(loadImage);

function makeConfig(overrides?: Partial<AvatarConfig>): AvatarConfig {
  return {
    gender: 'male',
    base: 'base-1',
    bottoms: 'bottoms-1',
    tops: 'tops-1',
    hair: 'hair-1',
    hats: null,
    ...overrides,
  };
}

describe('getLayerUrls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns URLs for all layers that have options', () => {
    mockFindOption.mockImplementation((_gender, key, _optionId) => {
      if (key === 'hats') return undefined; // no hat selected
      return {
        style: { id: 'style-1', label: 'Style 1', variants: [] },
        variant: { color: 'default', filename: `${key}.png`, optionId: `${key}-1` },
      };
    });
    mockGetAvatarAssetUrl.mockImplementation(
      (gender, cat, filename) => `/avatar/${gender}/${cat}/${filename}`,
    );

    const config = makeConfig();
    const layers = getLayerUrls(config);

    // base, bottoms, tops, hair (4 layers, hats is null)
    expect(layers).toHaveLength(4);
    expect(layers[0]).toEqual({ key: 'base', url: '/avatar/male/base/base.png' });
    expect(layers[1]).toEqual({ key: 'bottoms', url: '/avatar/male/bottoms/bottoms.png' });
    expect(layers[2]).toEqual({ key: 'tops', url: '/avatar/male/tops/tops.png' });
    expect(layers[3]).toEqual({ key: 'hair', url: '/avatar/male/hair/hair.png' });
  });

  it('skips layers with null option IDs', () => {
    const config = makeConfig({ hats: null });
    mockFindOption.mockReturnValue(undefined);

    const layers = getLayerUrls(config);

    // findOption returns undefined for everything, so no layers
    expect(layers).toHaveLength(0);
  });

  it('skips layers where findOption returns undefined', () => {
    mockFindOption.mockReturnValue(undefined);

    const layers = getLayerUrls(makeConfig());

    expect(layers).toHaveLength(0);
  });

  it('includes hats layer when selected', () => {
    const config = makeConfig({ hats: 'hat-1' });
    mockFindOption.mockImplementation((_gender, _key, _optionId) => ({
      style: { id: 'style-1', label: 'Style', variants: [] },
      variant: { color: 'default', filename: 'hat.png', optionId: 'hat-1' },
    }));
    mockGetAvatarAssetUrl.mockReturnValue('/avatar/male/hats/hat.png');

    const layers = getLayerUrls(config);

    expect(layers.some((l) => l.key === 'hats')).toBe(true);
  });
});

describe('renderAvatar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears the canvas, disables smoothing, and draws layers in order', async () => {
    const drawImageCalls: unknown[][] = [];
    const ctx = {
      clearRect: vi.fn(),
      imageSmoothingEnabled: true,
      drawImage: vi.fn((...args: unknown[]) => { drawImageCalls.push(args); }),
    } as unknown as CanvasRenderingContext2D;

    // Set up one layer
    mockFindOption.mockImplementation((_gender, key) => {
      if (key === 'base') {
        return {
          style: { id: 's', label: 'S', variants: [] },
          variant: { color: 'c', filename: 'base.png', optionId: 'base-1' },
        };
      }
      return undefined;
    });
    mockGetAvatarAssetUrl.mockReturnValue('/avatar/male/base/base.png');

    const fakeImg = { width: 160, height: 160 } as HTMLImageElement;
    mockLoadImage.mockResolvedValue(fakeImg);

    await renderAvatar(ctx, makeConfig(), 160);

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 160, 160);
    expect(ctx.imageSmoothingEnabled).toBe(false);
    expect(ctx.drawImage).toHaveBeenCalledWith(fakeImg, 0, 0, 160, 160);
  });

  it('skips layers that fail to load and logs a warning', async () => {
    const ctx = {
      clearRect: vi.fn(),
      imageSmoothingEnabled: true,
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    mockFindOption.mockReturnValue({
      style: { id: 's', label: 'S', variants: [] },
      variant: { color: 'c', filename: 'broken.png', optionId: 'base-1' },
    });
    mockGetAvatarAssetUrl.mockReturnValue('/avatar/male/base/broken.png');
    mockLoadImage.mockRejectedValue(new Error('Load failed'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await renderAvatar(ctx, makeConfig(), 160);

    expect(warnSpy).toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('draws multiple layers in z-order', async () => {
    const ctx = {
      clearRect: vi.fn(),
      imageSmoothingEnabled: true,
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    mockFindOption.mockImplementation((_gender, key) => {
      if (key === 'hats') return undefined;
      return {
        style: { id: 's', label: 'S', variants: [] },
        variant: { color: 'c', filename: `${key}.png`, optionId: `${key}-1` },
      };
    });
    mockGetAvatarAssetUrl.mockImplementation(
      (_g, cat, fn) => `/avatar/${cat}/${fn}`,
    );

    const fakeImg = { width: 160, height: 160 } as HTMLImageElement;
    mockLoadImage.mockResolvedValue(fakeImg);

    await renderAvatar(ctx, makeConfig(), 200);

    // 4 layers: base, bottoms, tops, hair
    expect(ctx.drawImage).toHaveBeenCalledTimes(4);
    // All drawn at the given size
    for (const call of (ctx.drawImage as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call).toEqual([fakeImg, 0, 0, 200, 200]);
    }
  });
});

describe('compositeToBlob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates canvas, renders, and returns blob', async () => {
    // Mock no layers to simplify (renders empty canvas)
    mockFindOption.mockReturnValue(undefined);

    const fakeBlob = new Blob(['test'], { type: 'image/png' });
    const fakeCtx = {
      clearRect: vi.fn(),
      imageSmoothingEnabled: true,
      drawImage: vi.fn(),
    };

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(fakeCtx),
      toBlob: vi.fn((cb: (blob: Blob | null) => void) => cb(fakeBlob)),
    };

    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue(mockCanvas),
    });

    const blob = await compositeToBlob(makeConfig(), 256);

    expect(mockCanvas.width).toBe(256);
    expect(mockCanvas.height).toBe(256);
    expect(blob).toBe(fakeBlob);
  });

  it('throws when getContext returns null', async () => {
    mockFindOption.mockReturnValue(undefined);

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(null),
      toBlob: vi.fn(),
    };

    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue(mockCanvas),
    });

    await expect(compositeToBlob(makeConfig())).rejects.toThrow(
      'Could not create canvas 2D context',
    );
  });

  it('throws when toBlob returns null', async () => {
    mockFindOption.mockReturnValue(undefined);

    const fakeCtx = {
      clearRect: vi.fn(),
      imageSmoothingEnabled: true,
      drawImage: vi.fn(),
    };

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(fakeCtx),
      toBlob: vi.fn((cb: (blob: Blob | null) => void) => cb(null)),
    };

    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue(mockCanvas),
    });

    await expect(compositeToBlob(makeConfig())).rejects.toThrow(
      'Canvas toBlob returned null',
    );
  });
});

describe('compositeToBase64', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('converts blob to base64 data URL', async () => {
    mockFindOption.mockReturnValue(undefined);

    const fakeBlob = new Blob(['test'], { type: 'image/png' });
    const fakeCtx = {
      clearRect: vi.fn(),
      imageSmoothingEnabled: true,
      drawImage: vi.fn(),
    };

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(fakeCtx),
      toBlob: vi.fn((cb: (blob: Blob | null) => void) => cb(fakeBlob)),
    };

    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue(mockCanvas),
    });

    // Mock FileReader as a class for Node environment (new FileReader())
    class StubFileReader {
      result: string | ArrayBuffer | null = 'data:image/png;base64,dGVzdA==';
      onload: (() => void) | null = null;
      onerror: ((err: unknown) => void) | null = null;
      readAsDataURL(_blob: Blob) {
        if (this.onload) this.onload();
      }
    }

    vi.stubGlobal('FileReader', StubFileReader);

    const result = await compositeToBase64(makeConfig());

    expect(result).toBe('data:image/png;base64,dGVzdA==');
  });
});
