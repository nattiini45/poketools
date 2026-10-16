'use client';

import { useWorldState } from '@/components/world/route/WorldStateProvider';
import type { CloudsWorldPalette } from './theme-palette';

/**
 * The merged palette, clouds-typed. Skyisle scene components read their
 * furniture roles through this instead of casting at every call site.
 *
 * The cast is sound for route worlds: the provider merges
 * `cloudsTheme.paletteExtension` over the core palette whenever the
 * clouds theme resolves, so every `CloudsPaletteExt` key is present by
 * construction.
 */
export function useCloudsPalette(): CloudsWorldPalette {
  const { palette } = useWorldState();
  return palette as CloudsWorldPalette;
}
