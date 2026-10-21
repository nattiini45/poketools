'use client';

import { useWorldState } from '@/components/world/route/WorldStateProvider';
import type { PlazaWorldPalette } from './theme-palette';

/**
 * The merged palette, plaza-typed. Plaza scene components read their
 * furniture roles through this instead of casting at every call site.
 *
 * The cast is sound for route worlds: the provider merges
 * `plazaTheme.paletteExtension` over the core palette whenever the plaza
 * theme resolves, so every `PlazaPaletteExt` key is present by construction.
 */
export function usePlazaPalette(): PlazaWorldPalette {
  const { palette } = useWorldState();
  return palette as PlazaWorldPalette;
}
