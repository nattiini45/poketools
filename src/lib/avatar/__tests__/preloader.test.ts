import { describe, it, expect, vi, beforeEach } from 'vitest';

import { loadImage, preloadImages, clearImageCache } from '../preloader';

// Create a stub Image class that can be used with `new Image()`
function createImageStub(opts: { autoLoad?: boolean; autoError?: boolean } = {}) {
  const instances: Array<{
    img: Record<string, unknown>;
    triggerLoad: () => void;
    triggerError: () => void;
  }> = [];

  class StubImage {
    crossOrigin = '';
    src = '';
    private _onload: (() => void) | null = null;
    private _onerror: (() => void) | null = null;

    set onload(fn: (() => void) | null) { this._onload = fn; }
    get onload(): (() => void) | null { return this._onload; }
    set onerror(fn: (() => void) | null) { this._onerror = fn; }
    get onerror(): (() => void) | null { return this._onerror; }

    constructor() {
      const instance = {
        img: this as unknown as Record<string, unknown>,
        triggerLoad: () => { if (this._onload) this._onload(); },
        triggerError: () => { if (this._onerror) this._onerror(); },
      };
      instances.push(instance);

      if (opts.autoLoad) {
        const onload = () => { if (this._onload) this._onload(); };
        setTimeout(onload, 0);
      }
      if (opts.autoError) {
        const onerror = () => { if (this._onerror) this._onerror(); };
        setTimeout(onerror, 0);
      }
    }
  }

  return { StubImage, instances };
}

describe('loadImage', () => {
  beforeEach(() => {
    clearImageCache();
    vi.restoreAllMocks();
  });

  it('loads an image and caches it', async () => {
    const { StubImage, instances } = createImageStub({ autoLoad: true });
    vi.stubGlobal('Image', StubImage);

    const result = await loadImage('/avatar/male/base/skin.png');

    expect(instances).toHaveLength(1);
    expect(result).toBe(instances[0].img);
    expect(instances[0].img.crossOrigin).toBe('anonymous');
    expect(instances[0].img.src).toBe('/avatar/male/base/skin.png');
  });

  it('returns cached image on second call', async () => {
    const { StubImage, instances } = createImageStub({ autoLoad: true });
    vi.stubGlobal('Image', StubImage);

    const first = await loadImage('/cached.png');
    const second = await loadImage('/cached.png');

    expect(first).toBe(second);
    // Only one Image instance should have been created
    expect(instances).toHaveLength(1);
  });

  it('deduplicates concurrent loads for the same URL', async () => {
    const { StubImage, instances } = createImageStub({ autoLoad: true });
    vi.stubGlobal('Image', StubImage);

    const [first, second] = await Promise.all([
      loadImage('/dedup.png'),
      loadImage('/dedup.png'),
    ]);

    expect(first).toBe(second);
    expect(instances).toHaveLength(1);
  });

  it('rejects when image fails to load', async () => {
    const { StubImage } = createImageStub({ autoError: true });
    vi.stubGlobal('Image', StubImage);

    await expect(loadImage('/broken.png')).rejects.toThrow(
      'Failed to load avatar asset: /broken.png',
    );
  });

  it('allows retry after failure (removed from loading promises)', async () => {
    // First attempt: error. Second attempt: success.
    let callCount = 0;

    class RetryImage {
      crossOrigin = '';
      src = '';
      onload: (() => void) = () => {};
      onerror: (() => void) = () => {};

      constructor() {
        callCount++;
        const myCall = callCount;
        setTimeout(() => {
          if (myCall === 1) this.onerror();
          if (myCall === 2) this.onload();
        }, 0);
      }
    }

    vi.stubGlobal('Image', RetryImage);

    await expect(loadImage('/retry.png')).rejects.toThrow();

    const result = await loadImage('/retry.png');
    expect(result).toBeInstanceOf(RetryImage);
    expect(callCount).toBe(2);
  });
});

describe('preloadImages', () => {
  beforeEach(() => {
    clearImageCache();
    vi.restoreAllMocks();
  });

  it('loads multiple images in parallel', async () => {
    const { StubImage, instances } = createImageStub({ autoLoad: true });
    vi.stubGlobal('Image', StubImage);

    const results = await preloadImages(['/a.png', '/b.png', '/c.png']);

    expect(results).toHaveLength(3);
    expect(instances).toHaveLength(3);
    expect(results[0]).toBe(instances[0].img);
    expect(results[1]).toBe(instances[1].img);
    expect(results[2]).toBe(instances[2].img);
  });

  it('returns empty array for empty input', async () => {
    const results = await preloadImages([]);
    expect(results).toEqual([]);
  });
});

describe('clearImageCache', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('clears cache so images are reloaded', async () => {
    const { StubImage, instances } = createImageStub({ autoLoad: true });
    vi.stubGlobal('Image', StubImage);

    await loadImage('/clear-test.png');
    expect(instances).toHaveLength(1);

    clearImageCache();

    await loadImage('/clear-test.png');
    // A new Image should have been created after cache clear
    expect(instances).toHaveLength(2);
    expect(instances[0].img).not.toBe(instances[1].img);
  });
});
