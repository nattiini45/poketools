/**
 * Cross-origin image handling shared by the two PNG exporters: `capture-node.ts` (html-to-image) and
 * `export-node.ts` (html2canvas). Both draw the live node into a canvas, which a cross-origin `<img>`
 * would taint, so each image is swapped for a data URL fetched through our proxy before the render and
 * put back afterwards.
 */

/** 1x1 transparent PNG, the fallback for an image the proxy cannot deliver. */
export const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAA0lEQVQI12P4z8BQDwAEgAF/QualrQAAAABJRU5ErkJggg==';

export interface OriginalImageSource {
  src: string;
  /** The `srcset` attribute before the rewrite, or null when the image had none. */
  srcset: string | null;
}

export type ImageFailureFallback = 'keep' | 'transparent';

/** Convert a cross-origin image URL to a data URL via our proxy. */
export async function toDataUrl(src: string): Promise<string> {
  const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(src)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`Proxy failed for ${src}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Replace every cross-origin `<img>` inside a node with a proxied data URL and drop its `srcset` (the
 * browser would otherwise keep preferring the cross-origin candidate). Returns the originals so the
 * caller can restore them with `restoreImages`.
 *
 * `onFailure` decides what an image the proxy cannot fetch becomes: `keep` leaves its original source
 * (it may render blank but does not block the capture), `transparent` swaps in `TRANSPARENT_PIXEL`.
 */
export async function proxyCrossOriginImages(
  node: HTMLElement,
  options?: { onFailure?: ImageFailureFallback },
): Promise<Map<HTMLImageElement, OriginalImageSource>> {
  const onFailure = options?.onFailure ?? 'keep';
  const originals = new Map<HTMLImageElement, OriginalImageSource>();

  await Promise.all(
    Array.from(node.querySelectorAll('img')).map(async (img) => {
      const src = img.src;
      if (
        !src ||
        src.startsWith(window.location.origin) ||
        src.startsWith('data:') ||
        src.startsWith('blob:')
      ) {
        return;
      }
      originals.set(img, { src, srcset: img.getAttribute('srcset') });
      try {
        img.src = await toDataUrl(src);
      } catch {
        if (onFailure === 'transparent') img.src = TRANSPARENT_PIXEL;
      }
      img.removeAttribute('srcset');
    }),
  );

  return originals;
}

/** Put the sources `proxyCrossOriginImages` replaced back. */
export function restoreImages(originals: Map<HTMLImageElement, OriginalImageSource>): void {
  originals.forEach(({ src, srcset }, img) => {
    img.src = src;
    if (srcset === null) img.removeAttribute('srcset');
    else img.setAttribute('srcset', srcset);
  });
}
