/**
 * Avatar image preloader — caches loaded HTMLImageElement instances to avoid
 * flicker and redundant fetches during avatar editing.
 */

const imageCache = new Map<string, HTMLImageElement>();
const loadingPromises = new Map<string, Promise<HTMLImageElement>>();

/** Load a single image, returning from cache if available. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached) return Promise.resolve(cached);

  const existing = loadingPromises.get(src);
  if (existing) return existing;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageCache.set(src, img);
      loadingPromises.delete(src);
      resolve(img);
    };
    img.onerror = () => {
      loadingPromises.delete(src);
      reject(new Error(`Failed to load avatar asset: ${src}`));
    };
    img.src = src;
  });

  loadingPromises.set(src, promise);
  return promise;
}

/** Preload multiple images in parallel. */
export async function preloadImages(urls: string[]): Promise<HTMLImageElement[]> {
  return Promise.all(urls.map(loadImage));
}

/** Clear the entire cache (useful for hot-reloading assets during development). */
export function clearImageCache(): void {
  imageCache.clear();
  loadingPromises.clear();
}
