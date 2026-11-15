import 'server-only';
import type { ComponentType } from 'react';
import type { FormatDefinition } from '@/lib/format-kit/types';
import type { PresetList } from '@/lib/pkmn/preset-rules';
import type { LevelRules } from '@/lib/ruleset-kit/types';
import type { Slug } from '@/lib/studio-core/keys';
import type {
  HistoricalCompetitionOption,
  HistoricalProfileContribution,
  HistoricalStatisticsRequest,
  HistoricalStatisticsResult,
  HistoricalUsageContribution,
} from './historical-statistics-types';

export type * from './historical-statistics-types';

/**
 * A format definition a pack ships in place of (or in addition to) the public example presets. The id is the preset
 * slug; a pack preset with the same id as a public one replaces it on the admin-only surfaces that list, fork and
 * create from presets. The definition never reaches the client barrel: only the server merges it into those surfaces,
 * so a pack may keep tournament tuning (pools, levels, surprise phases) out of the public repository and the client
 * bundle. Server-only, like every extension member.
 */
export interface PackFormatPreset {
  id: Slug;
  definition: FormatDefinition;
}

/**
 * A pack's override of a catalog rule preset's resolved rules. The id is the catalog rule preset id (such as
 * `gen9natdexwichtelcup`). A category the override names replaces the preset's resolved list; `levels` becomes the
 * level rules of the ruleset the format attach materialises for the preset. This is where a pack keeps an exact
 * allowlist and per-species required levels that must not ship in the public repository. Categories left out keep the
 * public preset's resolution, so a public checkout (no override) is unchanged.
 */
export interface PackRulesetPresetOverride {
  id: string;
  pokemon?: PresetList;
  moves?: PresetList;
  items?: PresetList;
  abilities?: PresetList;
  levels?: LevelRules | null;
}

/**
 * The pack-extension contract (docs/format-packs.md, "Pack extensions").
 *
 * A format pack may ship an `extensions/index.ts` beside its `index.ts`. Its default export is a
 * `PackExtensions` object; every member is optional. The public app consults a member only when
 * it is present, through `@/lib/pack-extensions` (the only importer of `@pack-extensions`), so a
 * pack without extensions (the example pack exports `{}`) changes no behaviour and costs no
 * query.
 *
 * Unlike the pack itself, extensions are server-only: providers may read the database, and the
 * components are React server components. Nothing here is ever called inside a cached read
 * (`unstable_cache` / `publicReads`): call sites run providers after the cached read, per
 * request, because a provider may depend on the viewer.
 *
 * "Supplementary records" are results a deployment keeps outside the app's own match pipeline
 * (no matches, games, battle stats, aggregates or ratings). Public pages show them next to the
 * live statistics, labelled as such, and never mix them into the live tables.
 */

/** Who is asking. Display-grade (the session copy): authorization never rides on it. */
export interface PackRequestContext {
  /** The signed-in viewer's player id, or null when signed out. */
  viewerPlayerId: string | null;
}

/** All-time supplementary KOs of one species (English `@pkmn` name). */
export interface SupplementaryKillRow {
  pokemonName: string;
  kos: number;
}

/** A player's supplementary record: results and placings outside the live pipeline. */
export interface SupplementaryPlayerRecord {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  /** Competitions won. */
  titles: number;
  /** Competitions finished second. */
  runnerUps: number;
}

/** Supplementary meetings between two players, from the first player's side. */
export interface SupplementaryHeadToHead {
  wins: number;
  draws: number;
  losses: number;
}

/** All-time supplementary KOs of one species. */
export interface SupplementaryPokemonKos {
  kos: number;
}

/** Admin navigation groups an extension link may join (`src/components/admin/adminNav.ts`). */
export type PackAdminNavGroup = 'competitions' | 'community' | 'system';

/** One admin page an extension adds. `label` is already localized for the request. */
export interface PackAdminLink {
  href: string;
  label: string;
  group: PackAdminNavGroup;
  siteAdminOnly?: boolean;
  superadminOnly?: boolean;
}

/** One public site-navigation entry an extension adds. `label` is already localized for the request. */
export interface PackNavItem {
  href: string;
  label: string;
}

export interface PackExtensions {
  historicalScopes?: () => Promise<readonly HistoricalCompetitionOption[]>;
  historicalUsage?: (
    request: HistoricalStatisticsRequest,
    ctx: PackRequestContext,
  ) => Promise<HistoricalStatisticsResult<HistoricalUsageContribution>>;
  historicalProfile?: (
    playerId: string,
    ctx: PackRequestContext,
  ) => Promise<HistoricalStatisticsResult<HistoricalProfileContribution>>;
  /**
   * Whether supplementary records count for this request (a site default and a viewer choice,
   * for example). Without it every supplementary provider is consulted.
   */
  includeSupplementaryRecords?: (ctx: PackRequestContext) => Promise<boolean>;
  /** Extra rows for the all-time kill ranking (Insights, global scope). */
  supplementaryKillRanking?: (ctx: PackRequestContext) => Promise<readonly SupplementaryKillRow[]>;
  /** A player's supplementary record for the profile; null when the player has none. */
  supplementaryPlayerRecord?: (
    playerId: string,
    ctx: PackRequestContext,
  ) => Promise<SupplementaryPlayerRecord | null>;
  /** Supplementary meetings of two players (first player's side); null when they never met. */
  supplementaryHeadToHead?: (
    playerAId: string,
    playerBId: string,
    ctx: PackRequestContext,
  ) => Promise<SupplementaryHeadToHead | null>;
  /** A species' all-time supplementary KO total for the Pokémon page; null when there is none. */
  supplementaryPokemonKos?: (
    species: string,
    ctx: PackRequestContext,
  ) => Promise<SupplementaryPokemonKos | null>;
  /** A server component rendered as an extra section of a player's profile. */
  ProfileSection?: ComponentType<{ playerId: string }>;
  CompetitionArchiveSection?: ComponentType<{ kind: 'league' | 'tournament' }>;
  InsightsSection?: ComponentType;
  /** A server component rendered as an extra section of `/dashboard/settings` (signed-in only). */
  SettingsSection?: ComponentType;
  /** Admin pages the extension adds to the admin navigation. */
  adminLinks?: () => Promise<readonly PackAdminLink[]>;
  /** Public pages the extension adds to the site navigation. */
  siteNavItems?: () => Promise<readonly PackNavItem[]>;
  /**
   * Labels of the extension's own audit actions (`extension.<name>` -> label), localized for the
   * request, for the admin audit log and dashboard. An action it leaves out is shown humanized.
   */
  auditActionLabels?: () => Promise<Readonly<Record<string, string>>>;
  /**
   * Format definitions the pack ships (server-only). Merged over the public example presets by id on the admin-only
   * preset surfaces; absent means the public examples alone. Static pack data, read synchronously.
   */
  formatPresets?: () => readonly PackFormatPreset[];
  /**
   * Overrides of catalog rule presets' resolved rules and materialised levels (server-only). Absent means the public
   * resolution alone. Static pack data, read synchronously.
   */
  rulesetPresetOverrides?: () => readonly PackRulesetPresetOverride[];
}

/**
 * The pure-data subset of the extensions: the format presets and rule-preset overrides a pack ships. It is read
 * through its own lightweight entry (`@pack-format-providers`, `extensions/format-providers.ts`) so a server module
 * that resolves presets (`preset-rules.server.ts`) never pulls the full extension barrel and its React server
 * components into its import graph. A pack without them exports `{}`.
 */
export type PackFormatProviders = Pick<PackExtensions, 'formatPresets' | 'rulesetPresetOverrides'>;
