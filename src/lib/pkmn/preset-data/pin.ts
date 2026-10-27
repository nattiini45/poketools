/**
 * Where the preset rule data comes from, and the version of the data. Plain constants (the only import is the Champions
 * roster pin, re-exported from the generated roster module), so the tests and the publish path can read them anywhere.
 *
 * The tables in this folder are transcribed from Pokémon Showdown (MIT, see NOTICE.md): the format and ruleset
 * definitions at `PRESET_DATA_PIN`, the Champions roster (a separate, later commit: the mod moves daily) at
 * `CHAMPIONS_ROSTER_PIN`. Both shas are recorded in the data files that use them, so a reader can open the exact
 * source. Refresh procedure and the reading order of the source: docs/ruleset-presets.md.
 */
export { CHAMPIONS_ROSTER_PIN } from './champions-roster.generated';

/** The commit of smogon/pokemon-showdown the format and ruleset tables (`standard.ts`, `draft.ts`) were checked against. */
export const PRESET_DATA_PIN = {
  repo: 'smogon/pokemon-showdown',
  sha: 'f6eff35d0316454bda90b82d3782def88a5ae599',
  date: '2026-10-26',
} as const;

/**
 * The version of everything a preset resolves to, stored with a published ruleset version as `catalog_version`, so a
 * version can say which data it was computed from. `preset-data-integrity.server.test.ts` hashes the catalog (`PRESETS`
 * in ../format-catalog.ts) and the tables in this folder, and fails on an edit of those that does not bump this.
 *
 * The hash does NOT cover the resolution code in ../preset-rules.server.ts or the dex tier data that the tier-derived
 * bans are read from (`@pkmn/dex`): a change to that code, or an upgrade of `@pkmn/dex` that moves a tier, changes the
 * resolved rules under an unchanged version, so it bumps this by hand.
 */
export const PRESET_RULES_VERSION = '2026-10-27.2';
