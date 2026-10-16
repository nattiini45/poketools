import { toPng } from 'html-to-image';

/**
 * Convert a cross-origin image URL to a data URL via our proxy.
 */
async function toDataUrl(src: string): Promise<string> {
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
 * Proxy all cross-origin <img> elements inside a node to data URLs.
 * Returns a Map of originals so the caller can restore them.
 */
async function proxyCrossOriginImages(
  node: HTMLElement,
): Promise<Map<HTMLImageElement, string>> {
  const originals = new Map<HTMLImageElement, string>();
  const images = node.querySelectorAll('img');

  await Promise.all(
    Array.from(images).map(async (img) => {
      const src = img.src;
      if (
        src &&
        !src.startsWith(window.location.origin) &&
        !src.startsWith('data:') &&
        !src.startsWith('blob:')
      ) {
        originals.set(img, src);
        try {
          img.src = await toDataUrl(src);
        } catch {
          // Leave original — may render blank but won't block capture
        }
        img.removeAttribute('srcset');
      }
    }),
  );

  return originals;
}

/**
 * Capture a DOM node as a high-quality PNG data URL.
 *
 * Wraps the target in a padded container, proxies cross-origin images,
 * performs a double-pass toPng capture at 2x pixel ratio, then restores
 * everything. Returns the data URL string.
 */
export async function captureNodeAsDataUrl(
  targetId: string,
  options?: { pixelRatio?: number; padding?: number },
): Promise<string> {
  const node = document.getElementById(targetId);
  if (!node) throw new Error(`Element #${targetId} not found`);

  const pixelRatio = options?.pixelRatio ?? 2;
  const padding = options?.padding ?? 24;

  // Wrap node with padded container for rounded corners / shadow visibility
  const parent = node.parentNode!;
  const next = node.nextSibling;
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `padding:${padding}px;display:inline-block;`;
  parent.insertBefore(wrapper, next);
  wrapper.appendChild(node);

  let originals = new Map<HTMLImageElement, string>();

  try {
    // Proxy cross-origin images to prevent canvas tainting
    originals = await proxyCrossOriginImages(node);

    const filter = (node: Node) =>
      !(node instanceof HTMLElement && node.dataset.exportHide !== undefined);

    // Double-pass capture (first pass warms up, second at full quality)
    await toPng(wrapper, { skipAutoScale: true, filter });
    const dataUrl = await toPng(wrapper, { pixelRatio, skipAutoScale: true, filter });

    return dataUrl;
  } finally {
    // Restore originals and unwrap
    originals.forEach((src, img) => {
      img.src = src;
    });
    parent.insertBefore(node, wrapper);
    parent.removeChild(wrapper);
  }
}
