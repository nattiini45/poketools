/**
 * Where the preset rule data comes from, and the version of the data. Plain constants (no imports), so the tests and
 * the publish path can read them anywhere.
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
 * The version of everything a preset resolves to: the catalog (`PRESETS` in ../format-catalog.ts), the tables in
 * this folder and the resolution rules in ../preset-rules.server.ts. Any change to those bumps it; a published
 * ruleset version stores it as `catalog_version`, so a version can say which data it was computed from.
 * `preset-data-integrity.server.test.ts` hashes the data and fails on an edit that does not bump this.
 */
export const PRESET_RULES_VERSION = '2026-10-26.1';
