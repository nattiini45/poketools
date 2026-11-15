import 'server-only';
import raw from '@pack-format-providers';
import type { PackFormatPreset, PackFormatProviders, PackRulesetPresetOverride } from './types';

/**
 * The active pack's format presets and rule-preset overrides (docs/format-packs.md, "Pack extensions"), read through
 * the lightweight `@pack-format-providers` entry (`extensions/format-providers.ts`). This is the ONLY module that
 * imports `@pack-format-providers`. It is separate from `@/lib/pack-extensions` so a server module that resolves
 * presets (`preset-rules.server.ts`, the format-studio preset source) can read the pack's pure data without pulling
 * the full extension barrel — and the React server components and database providers behind it — into its import
 * graph. The example pack exports `{}`, so a public checkout resolves exactly as before.
 */
const providers: PackFormatProviders = raw;

/**
 * Format definitions the active pack ships; [] without a provider (the public examples alone). Static pack code read
 * synchronously: an error it throws propagates to the caller, never swallowed. The definitions stay server-side;
 * only the admin preset surfaces merge them, never the client barrel.
 */
export function packFormatPresets(): readonly PackFormatPreset[] {
  const provider = providers.formatPresets;
  return provider ? provider() : [];
}

/** Rule-preset overrides the active pack ships; [] without a provider (the public resolution alone). */
export function packRulesetPresetOverrides(): readonly PackRulesetPresetOverride[] {
  const provider = providers.rulesetPresetOverrides;
  return provider ? provider() : [];
}

/** The active pack's override of one catalog rule preset, or undefined when it ships none. */
export function packRulesetPresetOverride(id: string): PackRulesetPresetOverride | undefined {
  return packRulesetPresetOverrides().find((override) => override.id === id);
}