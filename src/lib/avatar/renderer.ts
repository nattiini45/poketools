/**
 * Avatar canvas renderer — composites layer images in z-order onto a canvas.
 */

import type { AvatarConfig, AvatarLayerKey } from '@/types/avatar';
import { AVATAR_LAYER_ORDER, AVATAR_BASE_SIZE } from '@/types/avatar';
import { findOption, getAvatarAssetUrl } from './manifest';
import { loadImage } from './preloader';

/** Get the ordered list of asset URLs for a given config. */
export function getLayerUrls(config: AvatarConfig): { key: AvatarLayerKey; url: string }[] {
  const layers: { key: AvatarLayerKey; url: string }[] = [];

  for (const key of AVATAR_LAYER_ORDER) {
    const optionId = config[key];
    if (!optionId) continue;

    const found = findOption(config.gender, key, optionId);
    if (!found) continue;

    layers.push({ key, url: getAvatarAssetUrl(config.gender, key, found.variant.filename) });
  }

  return layers;
}

/**
 * Render the avatar onto an existing canvas 2D context.
 * Draws layers in z-order at the given size.
 */
export async function renderAvatar(
  ctx: CanvasRenderingContext2D,
  config: AvatarConfig,
  size: number = AVATAR_BASE_SIZE
): Promise<void> {
  ctx.clearRect(0, 0, size, size);

  // Disable image smoothing for crisp pixel art scaling
  ctx.imageSmoothingEnabled = false;

  const layers = getLayerUrls(config);

  for (const layer of layers) {
    try {
      const img = await loadImage(layer.url);
      ctx.drawImage(img, 0, 0, size, size);
    } catch {
      // Skip layers that fail to load — render partial avatar rather than nothing
      console.warn(`Avatar layer failed to load: ${layer.key} (${layer.url})`);
    }
  }
}

/**
 * Composite a complete avatar to a PNG Blob.
 * Creates an offscreen canvas, renders all layers, and exports.
 */
export async function compositeToBlob(
  config: AvatarConfig,
  size: number = AVATAR_BASE_SIZE
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas 2D context');

  await renderAvatar(ctx, config, size);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas toBlob returned null'));
      },
      'image/png'
    );
  });
}

/**
 * Composite a complete avatar to a base64 data URL string.
 */
export async function compositeToBase64(
  config: AvatarConfig,
  size: number = AVATAR_BASE_SIZE
): Promise<string> {
  const blob = await compositeToBlob(config, size);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
