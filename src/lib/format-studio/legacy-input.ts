/**
 * Live rows to `LegacyInput` (pure). The loader reads a league, its phases and a few counts; this maps them
 * field by field onto the descriptor's input (`describeLegacy`). Nothing is spread, so a column added to a row
 * later cannot travel into the descriptor, and no `players` or `matches` data can reach it.
 */
import type { FormatPack } from '@/lib/format-pack';
import type { SeasonWithDetails } from '@/types/season';
import type { TournamentWithDetails } from '@/types/tournament';
import type { LegacyFacts, LegacyInput, LegacyPack, LegacySeasonInput, LegacyStageInput } from './legacy/types';

export interface LegacyInputSource {
  league: SeasonWithDetails;
  /** The league's phases in the order they were read. */
  stages: readonly TournamentWithDetails[];
  /** Groups per phase id (`tournament_groups`); a phase missing from the map has none. */
  stageGroupCounts: ReadonlyMap<string, number>;
  /** League groups (`season_groups`). */
  leagueGroupCount: number;
  /** Per-format extras that were read; absent parts read as "not read". */
  facts: Partial<LegacyFacts>;
  /** The active pack's Evolution Point Buy section. Only the fields the descriptor reads are copied. */
  epb: FormatPack['epb'];
}

function toStage(stage: TournamentWithDetails, groupCounts: ReadonlyMap<string, number>): LegacyStageInput {
  const source = stage.enrollment_source;
  const rule = stage.advancement_rule;
  return {
    id: stage.id,
    name: stage.name,
    bracketType: stage.bracket_type,
    stageOrder: stage.stage_order,
    bestOfDefault: stage.best_of_default,
    boOverrides: stage.bo_overrides,
    isDoubles: stage.is_doubles,
    rulesetId: stage.ruleset_id || null,
    rulesetName: stage.ruleset_name || null,
    advancementRule: rule ? { type: rule.type, count: rule.count, per_group: rule.per_group } : null,
    enrollmentSource: source ? { type: source.type, source_phase_id: source.source_phase_id } : null,
    bracketResetEnabled: stage.bracket_reset_enabled,
    groupCount: groupCounts.get(stage.id) ?? 0,
  };
}

function toSeason(league: SeasonWithDetails, leagueGroupCount: number): LegacySeasonInput {
  return {
    id: league.id,
    name: league.name,
    description: league.description,
    formatType: league.format_type,
    language: league.language,
    rulesetId: league.ruleset_id,
    rulesetName: league.ruleset_name,
    routeTheme: league.route_theme,
    participantCount: league.participant_count,
    // null (no pool configured) differs from an empty pool: the descriptor adds the Core Liga module for a pool.
    corePoolSize: league.core_pool === null ? null : league.core_pool.length,
    leagueGroupCount,
  };
}

function toPack(epb: FormatPack['epb']): LegacyPack {
  return {
    epb: {
      matchPoints: epb.matchPoints,
      tiebreakerChain: epb.tiebreakerChain,
      teraByStage: epb.teraByStage,
      defaults: epb.defaults,
      stageLock: epb.stageLock,
      participationPoints: epb.participationPoints,
      comeback: epb.comeback,
    },
  };
}

export function toLegacyInput(source: LegacyInputSource): LegacyInput {
  return {
    season: toSeason(source.league, source.leagueGroupCount),
    stages: source.stages.map((stage) => toStage(stage, source.stageGroupCounts)),
    pack: toPack(source.epb),
    facts: {
      typeAssignments: source.facts.typeAssignments ?? null,
      formatRules: source.facts.formatRules ?? null,
      draftTierLimits: source.facts.draftTierLimits ?? null,
    },
  };
}
