'use client';

import { useWorldState } from '@/components/world/route/WorldStateProvider';
import type { MountainWorldPalette } from './theme-palette';

/**
 * The merged palette, mountain-typed. Mountain scene components read their
 * furniture roles through this instead of casting at every call site.
 *
 * The cast is sound for route worlds: the provider merges
 * `mountainTheme.paletteExtension` over the core palette whenever the
 * mountain theme resolves, so every `MountainPaletteExt` key is present by
 * construction.
 */
export function useMountainPalette(): MountainWorldPalette {
  const { palette } = useWorldState();
  return palette as MountainWorldPalette;
}
