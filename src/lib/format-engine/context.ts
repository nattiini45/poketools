/**
 * What the standings of a kit league need, as plain JSON (it travels through the public read cache and into client
 * components), and the table it gives for any list of completed matches. Pure and client-safe.
 *
 * `KitStandingsData` holds no secret: stage rules are public, outcomes are public (kind and faint tally; the reason
 * and the admin stay server-side), and the coin flip comes as precomputed draws, never as the season seed.
 */
import type { ExprValue } from '@/lib/format-kit/expr/ast';
import type { RankStep, Scoring, Stage } from '@/lib/format-kit/types';
import type { StandingsOptions } from '@/lib/tournament/standings';
import type { MatchRecord, Standing } from '@/lib/tournament/types';
import {
  computeStageStandings,
  type KitOutcome,
  type KitStanding,
  type StagedBye,
  type StandingsMetricDef,
  type StandingsPlacement,
} from './standings';

export type KitStageRules = Pick<Stage, 'key' | 'scoring' | 'rank'>;

/**
 * The custom metrics of one phase's stage (`metric.define` of player, `score.placement`): expressions are public rules,
 * and the refs are the players' attribute, tunable and track values, never the season seed or a hidden relation.
 */
export interface KitStageMetrics {
  defs: StandingsMetricDef[];
  placements: StandingsPlacement[];
  /** `attr.*`, `tunable.*`, `track.*` per player id. */
  playerRefs: Record<string, Record<string, ExprValue>>;
  /**
   * What `rel()` answers true for in a metric, per relation key: only links whose two sides anybody may see
   * (`publicLinkPairs`). Absent when no metric calls `rel()` or no link is public.
   */
  relations?: Record<string, [string, string][]>;
}

export interface KitStandingsData {
  /** `kit` ranks with the kit; `shadow` keeps the legacy tables and lets admins compare (`diffStandings`). */
  engine: 'kit' | 'shadow';
  /** Stage rules per phase (tournament) id. */
  stages: Record<string, KitStageRules>;
  /** The phase of every match of the phases. */
  stageOfMatch: Record<string, string>;
  outcomes: Record<string, KitOutcome>;
  /**
   * Games per completed match id (`games_played` of every table); absent until a game exists. Public like the match
   * results, and needed by every bracket type: a Swiss table counts games exactly as a round robin one does.
   */
  gameCounts?: Record<string, number>;
  /**
   * Kills per completed match id and player id (`kills` of `StageStandingsInput`): the `kill_differential` of every round
   * robin stage. Public like the match results. Carried here, not passed by the caller, so every table of the league
   * (the stage page, the hub, the league tab, profile, reports, previews, the runtime) counts the same kills.
   */
  kills?: Record<string, Record<string, number>>;
  /** Coin flip draws per phase id and player id. */
  coinFlips: Record<string, Record<string, number>>;
  /** An admin's order of the players per phase id (`rank.manual`); absent until one is set. */
  manualOrder?: Record<string, string[]>;
  /** Points added per phase id and player id (`format_adjustments`, kind `points`); absent until one exists. */
  adjustments?: Record<string, Record<string, number>>;
  /** Custom metrics per phase id; absent when the format defines none that the phase's stage uses. */
  metrics?: Record<string, KitStageMetrics>;
  /** Seed per phase id and player id (`tournament_participants.seed`); absent unless a stage ranks by or shows `seed`. */
  seeds?: Record<string, Record<string, number>>;
  /** `player_ratings.rating` per player id; absent unless a stage ranks by or shows `rating`. */
  ratings?: Record<string, number>;
}

/** Whether a standings call of a league should rank with the kit. */
export function ranksWithKit(formatType: string | null | undefined, kit: KitStandingsData | undefined): kit is KitStandingsData {
  return formatType === 'custom' && kit !== undefined && kit.engine === 'kit';
}

/**
 * The kit data narrowed to one phase, for a table that is known to be that phase's (a stage page): it then ranks by
 * that stage whatever its match records carry. Undefined when the phase is not one of the format's.
 */
export function kitForPhase(kit: KitStandingsData | null | undefined, phaseId: string): KitStandingsData | undefined {
  const stage = kit?.stages[phaseId];
  if (!kit || !stage) return undefined;
  const stageOfMatch: Record<string, string> = {};
  const outcomes: Record<string, KitOutcome> = {};
  const gameCounts: Record<string, number> = {};
  const kills: Record<string, Record<string, number>> = {};
  for (const [matchId, phase] of Object.entries(kit.stageOfMatch)) {
    if (phase !== phaseId) continue;
    stageOfMatch[matchId] = phase;
    const outcome = kit.outcomes[matchId];
    if (outcome) outcomes[matchId] = outcome;
    const games = kit.gameCounts?.[matchId];
    if (games !== undefined) gameCounts[matchId] = games;
    const matchKills = kit.kills?.[matchId];
    if (matchKills !== undefined) kills[matchId] = matchKills;
  }
  return {
    engine: kit.engine,
    stages: { [phaseId]: stage },
    stageOfMatch,
    outcomes,
    ...(Object.keys(gameCounts).length > 0 ? { gameCounts } : {}),
    ...(Object.keys(kills).length > 0 ? { kills } : {}),
    coinFlips: { [phaseId]: kit.coinFlips[phaseId] ?? {} },
    ...(kit.manualOrder?.[phaseId] ? { manualOrder: { [phaseId]: kit.manualOrder[phaseId] } } : {}),
    ...(kit.adjustments?.[phaseId] ? { adjustments: { [phaseId]: kit.adjustments[phaseId] } } : {}),
    ...(kit.metrics?.[phaseId] ? { metrics: { [phaseId]: kit.metrics[phaseId] } } : {}),
    ...(kit.seeds?.[phaseId] ? { seeds: { [phaseId]: kit.seeds[phaseId] } } : {}),
    ...(kit.ratings ? { ratings: kit.ratings } : {}),
  };
}

/** The adjustments of every phase added up per player: what a season-wide table adds to its points. */
function seasonAdjustments(kit: KitStandingsData): Record<string, number> | undefined {
  if (kit.adjustments === undefined) return undefined;
  const total: Record<string, number> = {};
  for (const byPlayer of Object.values(kit.adjustments)) {
    for (const [playerId, points] of Object.entries(byPlayer)) total[playerId] = (total[playerId] ?? 0) + points;
  }
  return total;
}

/**
 * The phase a list of matches belongs to, or null when it mixes phases (a season-wide table) or says nothing. A caller
 * that ranks ONE phase passes `kitForPhase(kit, phaseId)`: a phase with no completed match yet (or one the cached
 * `stageOfMatch` does not know) cannot be told from the season by its matches, and would fall back to the season table.
 */
export function phaseOfMatches(kit: KitStandingsData, matches: readonly MatchRecord[]): string | null {
  const phases = new Set<string>();
  for (const match of matches) {
    const phase = match.match_id === undefined ? undefined : kit.stageOfMatch[match.match_id];
    if (phase !== undefined) phases.add(phase);
  }
  if (phases.size === 1) return [...phases][0];
  if (phases.size === 0) {
    const ids = Object.keys(kit.stages);
    return ids.length === 1 ? ids[0] : null;
  }
  return null;
}

const SEASON_RANK: readonly RankStep[] = [];

/**
 * The kit table for a list of completed matches. Matches of one phase rank by that phase's scoring and chain; a
 * season-wide list scores every match by its own phase and ranks like the legacy table (points, KO differential,
 * Buchholz, wins), because a season table has no chain of its own (a `standings.view` is the kit's season table).
 */
export function kitStandings(
  kit: KitStandingsData,
  participantIds: readonly string[],
  participantNames: Readonly<Record<string, string>>,
  matches: readonly MatchRecord[],
  participantAvatars: Readonly<Record<string, string | null>> = {},
  options: StandingsOptions = {},
  participantGymTypes: Readonly<Record<string, string | null>> = {},
): KitStanding[] {
  const phase = phaseOfMatches(kit, matches);
  const common = {
    participantIds,
    participantNames,
    participantAvatars,
    participantGymTypes,
    matches,
    outcomes: kit.outcomes,
    byes: options.byes,
    // Kills come from the kit data, never from `options.battleStats` (the legacy tables' input, which counts games of open
    // and unresolved matches and is capped): every caller of a kit table sees the same kills.
    kills: kit.kills,
    gamesByMatch: options.gamesByMatch,
    gameCounts: kit.gameCounts,
    maxRound: options.maxRound,
  };
  if (phase !== null && kit.stages[phase] !== undefined) {
    const metrics = kit.metrics?.[phase];
    return computeStageStandings({
      ...common,
      stage: kit.stages[phase],
      coinFlips: kit.coinFlips[phase],
      manualOrder: kit.manualOrder?.[phase],
      pointAdjustments: kit.adjustments?.[phase],
      seeds: kit.seeds?.[phase],
      ratings: kit.ratings,
      ...(metrics
        ? { metricDefs: metrics.defs, placements: metrics.placements, playerRefs: metrics.playerRefs, relations: metrics.relations }
        : {}),
    });
  }
  const first = Object.values(kit.stages)[0];
  const fallback: Scoring = first?.scoring ?? { win: 1, loss: 0, bye: 0 };
  const scoringOf = (match: MatchRecord): Scoring => {
    const own = match.match_id === undefined ? undefined : kit.stageOfMatch[match.match_id];
    return (own === undefined ? undefined : kit.stages[own]?.scoring) ?? fallback;
  };
  // A bye carrying its phase (`stage_id`) scores that stage's `bye` points; one without (or of an unknown phase) the first stage's.
  const byePointsOf = (bye: StagedBye): number => (bye.stage_id === undefined ? undefined : kit.stages[bye.stage_id]?.scoring.bye) ?? fallback.bye;
  return computeStageStandings({
    ...common,
    stage: { key: 'season', scoring: fallback, rank: [...SEASON_RANK] },
    scoringOf,
    byePointsOf,
    pointAdjustments: seasonAdjustments(kit),
  });
}

export interface StandingsDiffRow {
  player_id: string;
  player_name: string;
  legacy_rank: number | null;
  kit_rank: number | null;
  legacy_points: number | null;
  kit_points: number | null;
}

/** Rows where the legacy and the kit table disagree on place or points (the shadow mode's comparison). */
export function diffStandings(legacy: readonly Standing[], kit: readonly Standing[]): StandingsDiffRow[] {
  const at = (rows: readonly Standing[]) => new Map(rows.map((row, i) => [row.player_id, { row, rank: i + 1 }]));
  const a = at(legacy);
  const b = at(kit);
  const ids = [...new Set([...a.keys(), ...b.keys()])];
  const out: StandingsDiffRow[] = [];
  for (const id of ids) {
    const left = a.get(id);
    const right = b.get(id);
    if (left && right && left.rank === right.rank && left.row.points === right.row.points) continue;
    out.push({
      player_id: id,
      player_name: (left ?? right)?.row.player_name ?? id,
      legacy_rank: left?.rank ?? null,
      kit_rank: right?.rank ?? null,
      legacy_points: left?.row.points ?? null,
      kit_points: right?.row.points ?? null,
    });
  }
  return out.sort((x, y) => (x.kit_rank ?? Infinity) - (y.kit_rank ?? Infinity));
}
