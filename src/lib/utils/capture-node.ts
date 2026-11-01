import { toPng } from 'html-to-image';
import { proxyCrossOriginImages, restoreImages, type OriginalImageSource } from './node-image';

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

  let originals = new Map<HTMLImageElement, OriginalImageSource>();

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
    restoreImages(originals);
    parent.insertBefore(node, wrapper);
    parent.removeChild(wrapper);
  }
}
