/**
 * The input of `describeLegacy`: everything it knows about a live league, as plain data. The loader maps the
 * database rows into this shape (`legacy-input.ts`); tests build it by hand. Nothing here is a row type, so the
 * descriptor never depends on how a row is stored.
 *
 * Pack values (the Evolution Point Buy tuning) enter ONLY through `pack`; the descriptor never imports
 * `@/lib/format-pack`, so a test injects literals and the app project and the private-pack project agree.
 */
import type { Locale } from '@/i18n/config';
import type { FormatPack } from '@/lib/format-pack/types';
import type { FormatRules } from '@/types/format-rules';
import type { SeasonFormatType } from '@/types/season';

export interface LegacyStageInput {
  id: string;
  name: string;
  bracketType: 'single_elim' | 'double_elim' | 'round_robin' | 'swiss';
  stageOrder: number;
  bestOfDefault: number;
  /** Round name (English, as stored) to best-of. */
  boOverrides: Record<string, number>;
  isDoubles: boolean;
  rulesetId: string | null;
  rulesetName: string | null;
  advancementRule: { type: 'top_n'; count: number; per_group: boolean } | null;
  enrollmentSource: { type: 'standings' | 'roster'; source_phase_id: string | null } | null;
  /** Double elimination only; absent reads as the stored default (on). */
  bracketResetEnabled: boolean | undefined;
  /** Groups generated for this phase. */
  groupCount: number;
}

export interface LegacySeasonInput {
  id: string;
  name: string;
  description: string;
  formatType: SeasonFormatType;
  /** Content language of the league; the base language of every proper name in the descriptor. */
  language: Locale;
  rulesetId: string | null;
  rulesetName: string | null;
  routeTheme: string | undefined;
  participantCount: number;
  /** Length of the curated core pool; null when the league has none. */
  corePoolSize: number | null;
  /** Groups of the league itself (`season_groups`); phases mirror them. */
  leagueGroupCount: number;
}

/** Facts read beyond the league and its phases; each is null when it was not read. */
export interface LegacyFacts {
  typeAssignments: { gymTyped: number; cored: number } | null;
  formatRules: FormatRules | null;
  draftTierLimits: { tier: 'S' | 'A' | 'B' | 'C'; maxPicks: number }[] | null;
}

/** The part of the format pack the descriptor reads. */
export type LegacyPack = {
  epb: Pick<
    FormatPack['epb'],
    'matchPoints' | 'tiebreakerChain' | 'teraByStage' | 'defaults' | 'stageLock' | 'participationPoints' | 'comeback'
  >;
};

export interface LegacyInput {
  season: LegacySeasonInput;
  stages: LegacyStageInput[];
  pack: LegacyPack;
  facts: LegacyFacts;
}
