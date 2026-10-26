import {
  BLANK_FORMAT_SUMMARY,
  PRESETS,
  type FormatDefaults,
} from './format-catalog';
import { presetBanNames } from './preset-rules.server';

// Format defaults in the legacy flat shape the site catalog seed speaks (`/api/seed-rulesets`): name, clauses (names) and
// the banned Pokémon, moves, items and abilities (names). It is the legacy view of
// the preset catalog (`PRESETS` in ./format-catalog): every preset is one entry, and the bans come from
// `presetBanNames` (./preset-rules.server.ts), which resolves them per mod from the dex tier data and the tables in
// ./preset-data. The flat shape cannot hold an allowlist, so a roster preset (Champions) or a Little Cup preset shows
// only its explicit bans here; `resolvePresetRules` has the full rules.
//
// Server-side: this module reaches @pkmn/dex through ./preset-rules.server. Client code imports the dex-free catalog
// (generations, tier labels, clauses, names, presets) from ./format-catalog instead; everything there is re-exported
// here.

export {
  BLANK_FORMAT_SUMMARY,
  FORMAT_SUMMARIES,
  GENERATIONS,
  PRESETS,
  PRESET_FAMILIES,
  clausesForTier,
  formatDisplayName,
  getFallbackFormats,
  getFormatName,
  getFormatSummary,
  getPreset,
  getTierInfo,
  getTierSource,
  getTiersForGen,
  getValidFormats,
  listPresets,
} from './format-catalog';
export type {
  FormatDefaults,
  FormatSummary,
  GenerationInfo,
  PresetFacts,
  PresetFamily,
  PresetMod,
  PresetSource,
  RulesetPreset,
  RulesetUniverse,
  TierInfo,
} from './format-catalog';

// ── Generate FORMAT_DEFAULTS from the presets ───────────────────────

function buildFormatDefaults(): Record<string, FormatDefaults> {
  const defaults: Record<string, FormatDefaults> = {};

  for (const preset of PRESETS) {
    const bans = presetBanNames(preset.id);
    if (bans === null) continue;
    defaults[preset.id] = {
      name: preset.name,
      gen: preset.gen,
      tier: preset.tierLabel,
      is_doubles: preset.gameType === 'doubles',
      clauses: preset.clauses,
      banned_pokemon: [...bans.pokemon],
      banned_moves: [...bans.moves],
      banned_items: [...bans.items],
      banned_abilities: [...bans.abilities],
    };
  }

  // Custom blank template
  defaults['blank'] = {
    ...BLANK_FORMAT_SUMMARY,
    clauses: [...BLANK_FORMAT_SUMMARY.clauses],
    banned_pokemon: [],
    banned_moves: [],
    banned_items: [],
    banned_abilities: [],
  };

  return defaults;
}

export const FORMAT_DEFAULTS: Record<string, FormatDefaults> = buildFormatDefaults();
