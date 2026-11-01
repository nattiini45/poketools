/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRANSPARENT_PIXEL, proxyCrossOriginImages, restoreImages, toDataUrl } from '../node-image';

const PROXIED = 'data:image/png;base64,UFJPWElFRA==';

function mockProxy(handler: (url: string) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => handler(String(input)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// A Response-shaped stub: the global Response builds its Blob from Node's realm, which jsdom's FileReader cannot read.
function pngResponse(): Response {
  return { ok: true, status: 200, blob: async () => new Blob(['PROXIED'], { type: 'image/png' }) } as Response;
}

function failedResponse(status: number): Response {
  return { ok: false, status } as Response;
}

function card(html: string): HTMLElement {
  const node = document.createElement('div');
  node.innerHTML = html;
  document.body.appendChild(node);
  return node;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toDataUrl', () => {
  it('fetches the image through the same-origin proxy and returns a data URL', async () => {
    const fetchMock = mockProxy(() => pngResponse());
    const url = 'https://play.pokemonshowdown.com/sprites/a b.png?x=1&y=2';

    const dataUrl = await toDataUrl(url);

    expect(fetchMock).toHaveBeenCalledWith(`/api/proxy-image?url=${encodeURIComponent(url)}`);
    expect(dataUrl).toBe(PROXIED);
  });

  it('rejects when the proxy answers with an error status', async () => {
    mockProxy(() => failedResponse(502));
    await expect(toDataUrl('https://example.com/a.png')).rejects.toThrow('Proxy failed for https://example.com/a.png');
  });
});

describe('proxyCrossOriginImages', () => {
  it('rewrites cross-origin images to data URLs, drops srcset, and records the originals', async () => {
    mockProxy(() => pngResponse());
    const node = card('<img id="a" src="https://img.example.com/a.png" srcset="https://img.example.com/a2.png 2x">');
    const img = node.querySelector('img')!;

    const originals = await proxyCrossOriginImages(node);

    expect(img.src).toBe(PROXIED);
    expect(img.hasAttribute('srcset')).toBe(false);
    expect(originals.get(img)).toEqual({ src: 'https://img.example.com/a.png', srcset: 'https://img.example.com/a2.png 2x' });
  });

  it('leaves same-origin, data: and blob: images alone and does not fetch for them', async () => {
    const fetchMock = mockProxy(() => pngResponse());
    const node = card(
      `<img src="${window.location.origin}/local.png"><img src="data:image/png;base64,AAAA"><img src="blob:${window.location.origin}/1234">`,
    );
    const before = Array.from(node.querySelectorAll('img')).map((i) => i.src);

    const originals = await proxyCrossOriginImages(node);

    expect(originals.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(Array.from(node.querySelectorAll('img')).map((i) => i.src)).toEqual(before);
  });

  it('keeps the original source when the proxy fails and the fallback is "keep"', async () => {
    mockProxy(() => failedResponse(500));
    const node = card('<img src="https://img.example.com/a.png">');
    const img = node.querySelector('img')!;

    const originals = await proxyCrossOriginImages(node, { onFailure: 'keep' });

    expect(img.src).toBe('https://img.example.com/a.png');
    expect(originals.has(img)).toBe(true);
  });

  it('swaps in a transparent pixel when the proxy fails and the fallback is "transparent"', async () => {
    mockProxy(() => failedResponse(500));
    const node = card('<img src="https://img.example.com/a.png">');
    const img = node.querySelector('img')!;

    await proxyCrossOriginImages(node, { onFailure: 'transparent' });

    expect(img.src).toBe(TRANSPARENT_PIXEL);
  });

  it('proxies every image of a card, so one failure does not block the others', async () => {
    mockProxy((url) => (url.includes('bad') ? failedResponse(500) : pngResponse()));
    const node = card('<img id="ok" src="https://img.example.com/ok.png"><img id="bad" src="https://img.example.com/bad.png">');

    await proxyCrossOriginImages(node, { onFailure: 'transparent' });

    expect(node.querySelector<HTMLImageElement>('#ok')!.src).toBe(PROXIED);
    expect(node.querySelector<HTMLImageElement>('#bad')!.src).toBe(TRANSPARENT_PIXEL);
  });
});

describe('restoreImages', () => {
  it('puts the original src and srcset back, and removes a srcset that was never there', async () => {
    mockProxy(() => pngResponse());
    const node = card(
      '<img id="a" src="https://img.example.com/a.png" srcset="https://img.example.com/a2.png 2x"><img id="b" src="https://img.example.com/b.png">',
    );

    const originals = await proxyCrossOriginImages(node);
    expect(node.querySelector<HTMLImageElement>('#a')!.src).toBe(PROXIED);

    restoreImages(originals);

    const a = node.querySelector<HTMLImageElement>('#a')!;
    const b = node.querySelector<HTMLImageElement>('#b')!;
    expect(a.src).toBe('https://img.example.com/a.png');
    expect(a.getAttribute('srcset')).toBe('https://img.example.com/a2.png 2x');
    expect(b.src).toBe('https://img.example.com/b.png');
    expect(b.hasAttribute('srcset')).toBe(false);
  });
});
