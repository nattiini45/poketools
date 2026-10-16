/**
 * The format-pack contract (docs/format-packs.md, design spec §B.1). Client-safe, types only.
 *
 * A format pack carries a league's TUNING (numbers, per-line rulings, taxonomies, rule prose, the
 * workbook layout); the public code keeps the MECHANICS and reads the tuning through
 * `@/lib/format-pack`. The public example pack (`src/format-packs/example`) is the contract owner:
 * its `messages/en.ts` defines the message tree every pack must match (§E).
 *
 * Stored values keep their names: `PriceGroup` keys are `point_buy_list_entries.price_group`
 * values, and the four per-line flags map onto the stored `special_rules` jsonb keys through
 * `STORED_FLAG` (`index.ts`).
 */
import type ExampleMessagesEn from '@/format-packs/example/messages/en';
import type { PluralForms } from '@/i18n/types';
import type { PowerTier } from '@/types/evolution';
import type { TiebreakerStep, TeamRoleCategory } from '@/types/format-rules';
import type { PriceGroup } from '@/types/point-buy';
import type { TierKey } from '@/types/ruleset';
import type { CoreTriple } from '@/types/season';

export type TeraEligibility = 'any' | 'stab_only' | 'none';
/** `toID(base)--toID(final stage)` (`src/lib/draft/line-identity.ts`). */
export type LineId = string;

/** Per-line ruling, keyed by the stored English base name (`point_buy_list_entries.base_pokemon`). */
export interface EpbLineRule {
  base: string;
  /** Stored flag `special_rules.cosmog`: the line earns participation tokens. */
  participationPoints?: boolean;
  /** Stored flag `special_rules.no_redraft`: excluded from redraft and trades (SQL reads this flag). */
  redraftLocked?: boolean;
  /** Stored flag `special_rules.scatterbug`: crossing stage 2 also reaches the final stage at once. */
  instantFinalStage?: boolean;
  /** Stored flag `special_rules.no_cocoon_rule`: catalog filter only (no engine effect). */
  noCocoon?: boolean;
  /** Importer sanity warning when the sheet disagrees. */
  expectedThresholds?: { killsToStage2: number; additionalKillsToStage3: number | null };
}

/** A league-level threshold override on top of the imported list (`src/lib/draft/league-overrides.ts`). */
export interface LineOverride {
  line_id: LineId;
  kills_to_stage2?: number;
  additional_kills_to_stage3?: number;
  /** Short, for the reconciliation report and the catalog hover. */
  reason: { en: string; de: string };
  source: string;
}

/** Same shape as `UtilityMember` (`src/lib/draft/utility-categories.ts`). */
export interface PackUtilityMember {
  kind: 'move' | 'ability';
  /** `@pkmn` id. */
  id: string;
  /** Whether selecting the whole category matches this member. */
  inParentMatch: boolean;
  /** `sheet` = from the league's utility sheet; `authored` = added by league ruling. */
  source: 'sheet' | 'authored';
  /** Why this member is special (reconciliation report, finder note). */
  flag?: string;
}

export interface PackUtilityCategory {
  key: string;
  members: readonly PackUtilityMember[];
}

/** 0-based column indices of the point-buy list sheet. */
export interface PointBuyColumns {
  lineNumber: number;
  startName: number;
  evolutionLine: number;
  legacyTier: number;
  price: number;
  priceGroup: number;
  killsToStage2: number;
  additionalKillsToStage3: number;
  rationale: number;
  historical: number;
  early: number;
  mid: number;
  late: number;
  specialRulesText: number;
  sources: number;
}

export interface WorkbookMap {
  pointBuy: {
    sheet: string;
    /** The list name an import uses when none is given (import script and admin import panel). */
    defaultListName: string;
    overviewSheet: string | null;
    rulesSheet: string | null;
    columns: PointBuyColumns;
    /** Lower-cased start-column values that mark a header or section row (skipped). */
    skipStartNames: readonly string[];
    /** Lower-cased sheet spelling -> `PriceGroup`. */
    priceGroupSpellings: Readonly<Record<string, PriceGroup>>;
    /** Overview-sheet labels of the per-group line counts. */
    overviewGroupLabels: Readonly<Record<PriceGroup, string>>;
    /** Overview-sheet row labels the validator reads. */
    overviewLabels: { lineCount: string; averagePrice: string };
  };
  utilitySheet: {
    sheet: string;
    /** The source block headings; the first one also locates the header row. */
    categories: readonly string[];
    /** Labels that select one branch of a branched base. */
    branchMarkers: Readonly<Record<string, { species: string; line: readonly [string, string] }>>;
    /** Labels with no exact match: reported as typos, never applied. */
    typos: Readonly<Record<string, string>>;
    /** Whole-label renames. */
    exact: Readonly<Record<string, string>>;
    /** Sheet move label -> `@pkmn` move name (case slips). */
    moveRenames: Readonly<Record<string, string>>;
  };
  teamRoles: {
    /** The two role-table sheets the importer reads, in order (shown in the import panel too). */
    sheets: readonly [string, string];
    /** Lower-cased sheet heading -> stored `TeamRoleCategory` (the DB CHECK vocabulary). */
    categoryLabels: Readonly<Record<string, TeamRoleCategory>>;
    /** One block per category: its heading and its species / move columns (0-based). */
    blocks: readonly { label: string; category: TeamRoleCategory; speciesCol: number; moveCol: number }[];
  };
}

export interface RuleConflict {
  code: string;
  severity: 'info' | 'warning';
  message: string;
}

/** What the reconciliation hook gets besides the rules-sheet rows. */
export interface RuleCheckContext {
  /** The season-default ban lists the repo applies (`epb.defaults`). */
  bannedMoves: readonly string[];
  bannedItems: readonly string[];
  /** `epb.reconciliation.knownRepoOnlyBanIds`: the repo-only bans to report when no rules sheet was given. */
  knownRepoOnlyBanIds: readonly string[];
  /** The app's one id fold (`@/lib/pkmn/i18n/id` `toID`), passed in so packs import no lib code. */
  foldId: (name: string) => string;
}

/** The message tree of every pack: the example pack's shape, with `utility` keyed by the pack's utility keys. */
type ExampleEn = typeof ExampleMessagesEn;
export type PackUtilityLabels = Readonly<Record<string, string>>;
export type PackMessagesEn = Omit<ExampleEn, 'utility'> & { readonly utility: PackUtilityLabels };
/**
 * The German twin of a contract tree: `DeShape`, except that a plural leaf keeps exactly the
 * contract's plural forms (no optional `zero`), so a namespace `de.ts` can spread a pack subtree
 * and still pass `defineDe`'s plural check.
 */
export type PackDeShape<E> = {
  readonly [K in keyof E]: E[K] extends string
    ? string
    : E[K] extends PluralForms
      ? { readonly [F in keyof E[K]]: string }
      : PackDeShape<E[K]>;
};
export type PackMessagesDe = PackDeShape<Omit<ExampleEn, 'utility'>> & { readonly utility: PackUtilityLabels };

export interface FormatPack {
  /** 'example' or the owner's pack id; also the build marker (§A.7). */
  id: string;
  epb: {
    /** `format_rules` defaults and the fallbacks of a missing row. */
    defaults: {
      draftBudget: number;
      draftPicks: number;
      tokenRatio: number;
      tokenMax: number;
      tokenMaxPerLine: number;
      redraftMaxLines: number;
      bannedMoves: readonly string[];
      bannedItems: readonly string[];
    };
    matchPoints: { win: number; draw: number };
    teraByStage: { stage1: TeraEligibility; stage2: TeraEligibility; stage3: TeraEligibility };
    tiebreakerChain: readonly TiebreakerStep[];
    /** Comeback Tokens of a shutout loss (loser 0 alive): the highest row with `winner >= minWinnerSurvivors`. */
    comeback: { table: readonly { minWinnerSurvivors: number; tokens: number }[] };
    stageLock: { enabled: boolean; stage: number; byMatchday: number; suspendMatchdays: number };
    participationPoints: {
      perMatchday: number;
      untilStage: number;
      locksRedraft: boolean;
      /** The `note` stored on each participation award's progress log row (`evolution_progress_log`). */
      awardNote: string;
    };
    priceGroups: Readonly<Record<PriceGroup, readonly [min: number, max: number]>>;
    priceGroupOrder: readonly PriceGroup[];
    priceTabs: readonly { key: string; min: number; max: number }[];
    lineRules: readonly EpbLineRule[];
    lineOverrides: readonly LineOverride[];
    specialRulesEn: Readonly<Record<LineId, { de_hash: string; en: string }>>;
    utility: {
      order: readonly string[];
      categories: readonly PackUtilityCategory[];
      dropped: readonly { id: string; reason: string }[];
    };
    workbook: WorkbookMap;
    reconciliation: {
      knownRepoOnlyBanIds: readonly string[];
      pastStatusHealingIds: readonly string[];
      /** Optional pure hook: league-specific checks over the rules-sheet rows. */
      ruleChecks?: (rulesSheetRows: readonly (readonly string[])[], context: RuleCheckContext) => RuleConflict[];
      /** Case-insensitive regex source of the rules-sheet row quoted next to the override table. */
      overrideRowPattern?: string;
    };
  };
  draftFormat: {
    tierLimitDefaults: Readonly<Record<PowerTier, number>>;
    newTier: { stage2Kos: number; stage3Kos: number; tier: PowerTier };
    newWildcard: { stage2Kos: number; stage3Kos: number };
    /** Example species of the tier editor's two search hints (canonical English names). */
    hintSpecies: readonly [base: string, other: string];
  };
  coreLiga: {
    newTripleDefault: CoreTriple;
    typeQuotaDefault: { source: 'player_core'; min: number; multiCount: boolean };
    evioliteCapTierDefault: TierKey;
  };
  messages: { en: PackMessagesEn; de: PackMessagesDe };
}
