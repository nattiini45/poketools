import html2canvas from 'html2canvas';

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

// 1x1 transparent PNG — safe fallback for unproxyable cross-origin images
const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAA0lEQVQI12P4z8BQDwAEgAF/QualrQAAAABJRU5ErkJggg==';

/**
 * Replace all cross-origin <img> elements inside a node with proxied data URLs.
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
          img.src = TRANSPARENT_PIXEL;
        }
        img.removeAttribute('srcset');
      }
    }),
  );

  return originals;
}

/**
 * Restore images to their original sources after export.
 */
function restoreImages(originals: Map<HTMLImageElement, string>): void {
  originals.forEach((src, img) => {
    img.src = src;
  });
}

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
  let originals = new Map<HTMLImageElement, string>();

  try {
    // Hide export-only UI
    hiddenEls.forEach((el) => { el.style.display = 'none'; });

    // Proxy cross-origin images to prevent canvas tainting
    originals = await proxyCrossOriginImages(node);

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
