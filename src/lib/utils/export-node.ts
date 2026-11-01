import html2canvas from 'html2canvas';
import { proxyCrossOriginImages, restoreImages, type OriginalImageSource } from './node-image';

export interface ExportResult {
  blobUrl: string;
  filename: string;
}

/**
 * Render a DOM node as a PNG and return a blob URL.
 *
 * Renders the LIVE node (not a clone) so all inherited styles, CSS variables,
 * and layout context are preserved. Temporarily hides [data-export-hide]
 * elements and proxies cross-origin images, then restores everything.
 *
 * Uses html2canvas (Canvas 2D) instead of html-to-image (SVG foreignObject)
 * because Firefox blocks foreignObject with cross-origin content.
 */
export async function renderNodeAsPng(
  node: HTMLElement,
  filename: string,
  options?: { padding?: number; scale?: number },
): Promise<ExportResult> {
  const scale = options?.scale ?? 2;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    throw new Error('Cannot export card: element has zero width or height');
  }

  // Collect elements to hide during export
  const hiddenEls = Array.from(node.querySelectorAll<HTMLElement>('[data-export-hide]'));
  const prevDisplay = hiddenEls.map((el) => el.style.display);
  let originals = new Map<HTMLImageElement, OriginalImageSource>();

  try {
    // Hide export-only UI
    hiddenEls.forEach((el) => { el.style.display = 'none'; });

    // Proxy cross-origin images to prevent canvas tainting
    originals = await proxyCrossOriginImages(node, { onFailure: 'transparent' });

    // Render with html2canvas (Canvas 2D approach, no foreignObject)
    const canvas = await html2canvas(node, {
      scale,
      useCORS: true,
      allowTaint: false,
      backgroundColor: null, // transparent
      logging: false,
    });

    // Convert canvas to blob URL
    const blobUrl = await new Promise<string>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(URL.createObjectURL(blob));
          } else {
            reject(new Error('canvas.toBlob returned null'));
          }
        },
        'image/png',
      );
    });

    return { blobUrl, filename };
  } finally {
    // Restore hidden elements
    hiddenEls.forEach((el, i) => { el.style.display = prevDisplay[i]; });
    restoreImages(originals);
  }
}
