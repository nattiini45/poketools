/**
 * Rule presets in the format kit: what picking a preset pre-fills in a format definition. The catalog view the
 * pickers share (entries, lookup, search, grouping) lives in `@/lib/pkmn/ruleset-preset-catalog`; this module is the
 * one place that decides how a preset changes a format document. Pure and client-safe (zero zod, no `@pkmn`; the
 * client-boundary test allow-lists the catalog import).
 *
 * A rule preset is the third kind of a stage's ruleset, `{ kind: 'preset', preset: 'gen9ou' }`. Picking one only
 * PRE-PICKS settings; nothing is locked and every field stays editable. The rule, stated here once:
 *
 *  - `ruleset`           = the preset;
 *  - `doubles`           = the catalog's game type of the preset;
 *  - `players_per_match` = 2 (every catalog preset is a two-player battle, doubles included: two players bring
 *                          two Pokémon each);
 *  - `series.best_of`    = 3 for VGC on every stage, the structure's own value for every other tier (series
 *                          exceptions are never touched).
 *
 * `applyRulesetPreset` applies the whole rule to a definition (the New format start); `withRulesetPreset`
 * applies the battle settings only to one stage (the stage inspector, where the series length is the editor's own
 * choice). Neither mutates its input, and an id the catalog does not know leaves the input as it is: callers
 * validate with `isRulesetPresetId` first.
 *
 * Attaching a format to a league turns every distinct preset its stages name into a normal, editable ruleset
 * owned by the league. "Preset" also means the shipped example formats (`presets/`, `/api/formats/presets`) in the
 * kit; the interface calls those examples and these rule presets.
 */
import { getRulesetPreset, type RulesetPresetEntry } from '@/lib/pkmn/ruleset-preset-catalog';
import type { Key } from '@/lib/studio-core/keys';
import type { FormatDefinition, Stage } from './types';
import type { LText } from '@/lib/studio-core/ltext';
import type { Locale } from '@/i18n/config';

/** The best of a VGC series. */
export const PRESET_VGC_BEST_OF = 3;
/** Players in a preset's battle. */
export const PRESET_PLAYERS_PER_MATCH = 2;

/** The battle settings a preset pre-picks for a stage (everything except the series length). */
function battleSettings(preset: RulesetPresetEntry): Pick<Stage, 'ruleset' | 'doubles' | 'players_per_match'> {
  return {
    ruleset: { kind: 'preset', preset: preset.id },
    doubles: preset.doubles,
    players_per_match: PRESET_PLAYERS_PER_MATCH,
  };
}

/** One stage with the battle settings of the preset (ruleset, doubles, players per match); the same object when it already has them. */
export function withRulesetPreset(stage: Stage, presetId: string): Stage {
  const preset = getRulesetPreset(presetId);
  if (preset === undefined) return stage;
  const settings = battleSettings(preset);
  const unchanged =
    stage.ruleset?.kind === 'preset' &&
    stage.ruleset.preset === preset.id &&
    stage.doubles === settings.doubles &&
    stage.players_per_match === settings.players_per_match;
  return unchanged ? stage : { ...stage, ...settings };
}

/** The best of a stage plays under a preset: 3 for VGC, otherwise the value it already has. */
function bestOfFor(preset: RulesetPresetEntry, current: number): number {
  return preset.tier === 'vgc' ? PRESET_VGC_BEST_OF : current;
}

export interface ApplyRulesetPresetOptions {
  /**
   * Append the preset name to the identity name in every language it has ("Classic league (Gen 9 OU)"). For a
   * structure whose name the author did not choose; a name typed by the author is left alone.
   */
  retitle?: boolean;
}

function retitled(text: LText, suffix: string): LText {
  const out: LText = { ...text };
  for (const locale of ['en', 'de'] as const satisfies readonly Locale[]) {
    const value = out[locale];
    if (value !== undefined && value.v !== '') out[locale] = { ...value, v: `${value.v} (${suffix})` };
  }
  return out;
}

/** A copy of the definition with the rule preset pre-picked on EVERY stage (see the rule in the file header). */
export function applyRulesetPreset(
  definition: FormatDefinition,
  presetId: string,
  options: ApplyRulesetPresetOptions = {},
): FormatDefinition {
  const preset = getRulesetPreset(presetId);
  if (preset === undefined) return definition;
  return {
    ...definition,
    identity: options.retitle === true ? { ...definition.identity, name: retitled(definition.identity.name, preset.name) } : definition.identity,
    stages: definition.stages.map((stage) => ({
      ...stage,
      ...battleSettings(preset),
      series: { ...stage.series, best_of: bestOfFor(preset, stage.series.best_of) },
    })),
  };
}

/** The distinct rule presets the stages name, in stage order. */
export function presetsOf(definition: Pick<FormatDefinition, 'stages'>): Key[] {
  const seen = new Set<string>();
  const out: Key[] = [];
  for (const stage of definition.stages) {
    const ruleset = stage.ruleset;
    if (ruleset?.kind === 'preset' && !seen.has(ruleset.preset)) {
      seen.add(ruleset.preset);
      out.push(ruleset.preset);
    }
  }
  return out;
}

/** The ids of the stored rulesets the stages name explicitly (`kind: 'ruleset'`), in stage order. Reads defensively, so it accepts a stored spec of any shape. */
export function namedRulesetsOf(definition: Pick<FormatDefinition, 'stages'>): string[] {
  const stages: unknown = definition.stages;
  if (!Array.isArray(stages)) return [];
  const ids = new Set<string>();
  for (const stage of stages) {
    const ruleset = (stage as { ruleset?: { kind?: unknown; id?: unknown } } | null)?.ruleset;
    if (ruleset?.kind === 'ruleset' && typeof ruleset.id === 'string') ids.add(ruleset.id);
  }
  return [...ids];
}
