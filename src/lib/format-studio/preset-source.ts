import 'server-only';
/**
 * The format presets the admin-only surfaces list, fork and create from: the public example presets merged with the
 * active pack's `formatPresets` (docs/format-packs.md, "Pack extensions"). A pack preset with the same id as a public
 * one replaces it in place; new ids append. Server only, so a pack's tournament tuning never reaches the client barrel
 * (`@/lib/format-kit/client` keeps exporting the public examples alone). Without a pack provider this is exactly the
 * public `PRESETS`, so a public checkout is unchanged.
 */
import { PRESETS } from '@/lib/format-kit/presets';
import type { FormatDefinition } from '@/lib/format-kit/types';
import { packFormatPresets } from '@/lib/pack-extensions/format-providers';
import type { Slug } from '@/lib/studio-core/keys';

export interface FormatPresetEntry {
  id: Slug;
  definition: FormatDefinition;
}

/** The merged presets in gallery order: public order kept, a pack replacement holds its public slot. */
export function serverFormatPresets(): readonly FormatPresetEntry[] {
  const merged = new Map<string, FormatPresetEntry>(PRESETS.map((preset) => [preset.id, preset]));
  for (const preset of packFormatPresets()) merged.set(preset.id, preset);
  return [...merged.values()];
}

/** One merged preset by id, or undefined. */
export function findServerFormatPreset(id: string): FormatPresetEntry | undefined {
  return serverFormatPresets().find((preset) => preset.id === id);
}
