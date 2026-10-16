'use client';

import { useWorldState } from '@/components/world/route/WorldStateProvider';
import type { SakuraWorldPalette } from './theme-palette';

/**
 * The merged palette, sakura-typed. Sakura scene components read their
 * furniture roles through this instead of casting at every call site.
 *
 * The cast is sound for route worlds: the provider merges
 * `sakuraTheme.paletteExtension` over the core palette whenever the sakura
 * theme resolves, so every `SakuraPaletteExt` key is present by construction.
 */
export function useSakuraPalette(): SakuraWorldPalette {
  const { palette } = useWorldState();
  return palette as SakuraWorldPalette;
}
