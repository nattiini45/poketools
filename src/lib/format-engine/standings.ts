/**
 * Stage standings of the format kit: one stage's table from its completed matches, their `match_outcomes` and the
 * stage's `scoring` and `rank` chain. Pure and client-safe (no I/O, no clock, no unseeded randomness): the same
 * input gives the same table in Node and in a browser.
 *
 * Scoring of one completed match (two players, one winner):
 * - an `unresolved` outcome is never scored: no points, no record, no Buchholz, no faints;
 * - a `forfeit` or `no_show` outcome scores the stage's forfeit points when it has them (`forfeitScoringOf`), else
 *   the win and loss points; there is no faint tally, so the faint bonus adds nothing;
 * - a played match (an outcome row of kind `played`, or none: a match completed before outcomes were recorded)
 *   scores win and loss points plus `per_opponent_faint` times the Pokémon of the opponent that fainted. Faints are
 *   read only from the outcome row, never from `battle_stats`;
 * - a match without a winner is a draw worth `scoring.draw` (absent: 0). The compiler refuses draws today.
 * A stored bye scores `scoring.bye` and counts as a win in the record (the Swiss convention of the legacy table).
 *
 * Ranking: the rank chain splits tied blocks step by step. A block still tied after the chain is placed in a canonical
 * order (seed when the input carries seeds, then player id), never in the order the caller listed the participants, so
 * every consumer of the same stage gives the same places. An empty chain (a bracket stage) ranks like the legacy table:
 * points, KO differential, Buchholz, wins.
 */
import { PLAYER_ROW_FIELDS } from '@/lib/format-kit/engine/runtime-names';
import type { Expr, ExprValue } from '@/lib/format-kit/expr/ast';
import { evaluate } from '@/lib/format-kit/expr/eval';
import { seededRand } from '@/lib/format-kit/expr/rand';
import { forfeitScoringOf, perOpponentFaintOf } from '@/lib/format-kit/scoring';
import { mappedBracketType } from '@/lib/format-kit/engine/plan';
import type { RankStep, Scoring, Stage } from '@/lib/format-kit/types';
import type { ByeRecord, MatchRecord, Standing } from '@/lib/tournament/types';
import type { MatchOutcome } from '@/types/match-outcome';

/** The public part of a `match_outcomes` row: what standings read. */
export type KitOutcome = Pick<MatchOutcome, 'kind' | 'p1_faints' | 'p2_faints'>;

/** The standings part of an outcome row (`match_outcomes`, or any row that carries the same three columns). */
export function toKitOutcome(row: KitOutcome): KitOutcome {
  return { kind: row.kind, p1_faints: row.p1_faints, p2_faints: row.p2_faints };
}

/** Outcome rows as the by-match-id record `StageStandingsInput.outcomes` takes. */
export function kitOutcomesByMatch(rows: readonly (KitOutcome & { match_id: string })[]): Record<string, KitOutcome> {
  const out: Record<string, KitOutcome> = {};
  for (const row of rows) out[row.match_id] = toKitOutcome(row);
  return out;
}

export interface KitStanding extends Standing {
  /** Place in the table, 1-based. Rows still tied after the whole chain have different places (seed, then player id). */
  rank: number;
  /** Pokémon of the opponents that fainted (from `match_outcomes`). */
  faints_dealt: number;
  /** Own Pokémon that fainted (from `match_outcomes`). */
  faints_taken: number;
  /** Matches won or lost by forfeit or no-show. */
  forfeit_wins: number;
  forfeit_losses: number;
  /** True when the chain ends in a decision match and this row is still tied with a neighbour. */
  needs_decision_match: boolean;
  /** Rows still tied after the whole chain share an id (1, 2, ...); null for a row that is ranked alone. */
  tie_group: number | null;
  /** Custom metric values (`metric.define`, `score.placement`) by key; absent when the stage has none. */
  metrics?: Record<string, number>;
  /**
   * Place among the players of the row's own group, 1-based. Set by the runtime's stage table (`loadStageTable`) from the
   * phase's groups; absent in a table nobody grouped (the group is then the whole table).
   */
  group_rank?: number;
}

/** A stored bye, with the phase whose stage scored it when the table mixes stages (a season-wide table). */
export type StagedBye = ByeRecord & { stage_id?: string };

/** A `metric.define` of a player: an expression over the standings row (player env), evaluated once per row. */
export interface StandingsMetricDef {
  key: string;
  expr: Expr;
}

/** A `score.placement` of the stage: points by final place in this table. */
export interface StandingsPlacement {
  key: string;
  points: readonly number[];
}

export interface StageStandingsInput {
  stage: Pick<Stage, 'key' | 'scoring' | 'rank'>;
  participantIds: readonly string[];
  participantNames: Readonly<Record<string, string>>;
  participantAvatars?: Readonly<Record<string, string | null>>;
  participantGymTypes?: Readonly<Record<string, string | null>>;
  /** Completed matches of the stage. */
  matches: readonly MatchRecord[];
  /** Outcome rows by match id. */
  outcomes?: Readonly<Record<string, KitOutcome>>;
  byes?: readonly StagedBye[];
  /**
   * The kills of the completed matches' games per match id and player id: the player's `kos_dealt` minus the Pokemon of
   * theirs that fainted (`kill_differential`). Only a round robin stage has them (`stageCountsKills`); the table adds
   * them for the matches it scores, so a match that is open, unresolved, outside the table or past `maxRound` adds
   * nothing. Every kit consumer reads them with the stage's other extras (`getPhaseKillTallies`), and the public data
   * carries them (`KitStandingsData.kills`), so no caller can rank without them.
   */
  kills?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** The games of a match as its game winners' ids (the legacy tables' shape); a match listed here wins over `gameCounts`. */
  gamesByMatch?: Readonly<Record<string, readonly string[]>>;
  /**
   * How many games each match has, by match id (`getPhaseGameCounts`): what `games_played` counts. A match without an
   * entry has no games. Every kit consumer loads it with the stage's other extras, so the table agrees everywhere.
   */
  gameCounts?: Readonly<Record<string, number>>;
  /** Only matches, byes and stats up to this round. */
  maxRound?: number;
  /**
   * Seed per player in this stage (1 = first); a player without one sorts after every seeded player. The `seed` metric
   * (a rank step, a column) reads it: callers feed it from the phase's participants, or the metric ties everyone.
   */
  seeds?: Readonly<Record<string, number>>;
  /** Rating per player (`player_ratings.rating`). The `rating` metric reads it; callers feed it, else it is 0 for all. */
  ratings?: Readonly<Record<string, number>>;
  /**
   * The coin flip's draw per player (lower ranks first), precomputed on the server with `coinFlipDraws`. The season
   * seed itself never leaves the server: hidden relations are generated from it.
   */
  coinFlips?: Readonly<Record<string, number>>;
  /** The season's seed (`season_formats.seed`), server-side only: draws a player missing from `coinFlips`. */
  seed?: string | null;
  /** The scoring of one match when the table mixes stages (a season-wide table); defaults to `stage.scoring`. */
  scoringOf?: (match: MatchRecord) => Scoring;
  /** The points of one stored bye when the table mixes stages (a season-wide table); defaults to `stage.scoring.bye`. */
  byePointsOf?: (bye: StagedBye) => number;
  /** The admin's order of the players (`rank.manual`); unlisted players stay tied behind the listed ones. */
  manualOrder?: readonly string[];
  /**
   * Points an admin or an event added per player (`format_adjustments`, kind `points`). They are added to `points`
   * after the Buchholz sums (which stay the opponents' match points) and before any metric or rank step reads them.
   */
  pointAdjustments?: Readonly<Record<string, number>>;
  /** Metric values computed elsewhere, per player and metric key; a `metric.define` of the same key overrides them. */
  customMetrics?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** `metric.define` of player: evaluated per row before ranking, so a rank step or a column may name the key. */
  metricDefs?: readonly StandingsMetricDef[];
  /**
   * The refs a metric expression reads besides the row, per player: `attr.*`, `tunable.*`, `track.*`
   * (`runtime/expr-env.ts` `playerExtraRefMap`). `player` is added here. `rank` and `group_rank` read 0 while the
   * metrics are evaluated (the table is not ranked yet).
   */
  playerRefs?: Readonly<Record<string, Readonly<Record<string, ExprValue>>>>;
  /**
   * The links `rel(key, a, b)` of a metric expression answers true for, per relation key, as `[from, to]` pairs. Only
   * links a viewer without an account sees whole belong here (`publicLinkPairs`): a hidden side never reaches the
   * public table. A relation without pairs answers false.
   */
  relations?: Readonly<Record<string, readonly (readonly [string, string])[]>>;
  /** `score.placement` metrics of this stage: set on the ranked rows (a stage cannot rank by its own placement). */
  placements?: readonly StandingsPlacement[];
}

/**
 * What a phase's table reads besides its matches, byes and outcomes. Loaded on the server (`loadStageTableExtras`) and
 * handed to every consumer that ranks the stage (advancement, pairing, the runtime), so they rank like the public table.
 */
export type StageTableExtras = Pick<
  StageStandingsInput,
  'pointAdjustments' | 'manualOrder' | 'metricDefs' | 'placements' | 'playerRefs' | 'relations' | 'seeds' | 'ratings' | 'gameCounts' | 'kills'
>;

/**
 * Whether a stage's table counts kills (`kill_differential`) from `battle_stats`. Only a round robin stage does, as in the
 * public tables (a Swiss table counts none); the loaders read them for those stages alone, so a threshold, a rank step
 * or a pairing on `kill_differential` sees the value the standings page shows, and nothing is read for the rest.
 */
export function stageCountsKills(stage: Pick<Stage, 'pairing'>): boolean {
  return mappedBracketType(stage.pairing) === 'round_robin';
}

/** The order a stage without a rank chain uses: the legacy table's sort. */
export const LEGACY_RANK_CHAIN: readonly RankStep[] = [
  { kind: 'metric', metric: 'points', direction: 'desc' },
  { kind: 'metric', metric: 'kill_differential', direction: 'desc' },
  { kind: 'metric', metric: 'buchholz', direction: 'desc' },
  { kind: 'metric', metric: 'wins', direction: 'desc' },
];

const UNSEEDED = Number.MAX_SAFE_INTEGER;

interface MatchPoints {
  p1: number;
  p2: number;
}

/** What one completed match is worth to each side, or null when it is not scored. */
export function scoreMatch(match: MatchRecord, scoring: Scoring, outcome: KitOutcome | undefined): MatchPoints | null {
  if (outcome?.kind === 'unresolved') return null;
  const { player_1_id: p1, player_2_id: p2, winner_id: winner } = match;
  if (winner !== p1 && winner !== p2) {
    const draw = scoring.draw ?? 0;
    return { p1: draw, p2: draw };
  }
  const forfeit = forfeitScoringOf(scoring);
  const byForfeit = outcome !== undefined && (outcome.kind === 'forfeit' || outcome.kind === 'no_show');
  const perFaint = perOpponentFaintOf(scoring);
  const faintBonus = byForfeit ? (forfeit?.faint_bonus === true ? perFaint : 0) : perFaint;
  const winPoints = byForfeit && forfeit !== null ? forfeit.win : scoring.win;
  const lossPoints = byForfeit && forfeit !== null ? forfeit.loss : scoring.loss;
  const p1Bonus = faintBonus * (outcome?.p2_faints ?? 0);
  const p2Bonus = faintBonus * (outcome?.p1_faints ?? 0);
  return winner === p1
    ? { p1: winPoints + p1Bonus, p2: lossPoints + p2Bonus }
    : { p1: lossPoints + p1Bonus, p2: winPoints + p2Bonus };
}

function emptyRow(input: StageStandingsInput, id: string): KitStanding {
  return {
    player_id: id,
    player_name: input.participantNames[id] ?? 'Unknown',
    player_avatar_url: input.participantAvatars?.[id] ?? null,
    gym_type: input.participantGymTypes?.[id] ?? null,
    wins: 0,
    losses: 0,
    draws: 0,
    points: 0,
    buchholz: 0,
    games_played: 0,
    kill_differential: 0,
    eliminated: false,
    rank: 0,
    faints_dealt: 0,
    faints_taken: 0,
    forfeit_wins: 0,
    forfeit_losses: 0,
    needs_decision_match: false,
    tie_group: null,
  };
}

/** The value of a builtin metric for a row, or null for a metric the engine does not know. */
export function metricValue(row: KitStanding, metric: string, input: Pick<StageStandingsInput, 'seeds' | 'ratings'>): number | null {
  switch (metric) {
    case 'points':
      return row.points;
    case 'wins':
      return row.wins;
    case 'losses':
      return row.losses;
    case 'games_played':
      return row.games_played;
    case 'kill_differential':
      return row.kill_differential;
    case 'buchholz':
      return row.buchholz;
    case 'seed':
      return input.seeds?.[row.player_id] ?? UNSEEDED;
    case 'rating':
      return input.ratings?.[row.player_id] ?? 0;
    case 'faints_dealt':
      return row.faints_dealt;
    case 'faints_taken':
      return row.faints_taken;
    default:
      return row.metrics !== undefined && Object.prototype.hasOwnProperty.call(row.metrics, metric) ? row.metrics[metric] : null;
  }
}

function coinFlipDraw(seed: string, stageKey: string, playerId: string): number {
  return seededRand(seed, `coin_flip:${stageKey}`, playerId);
}

/** The coin flip draws of `playerIds` in a stage: what a client receives instead of the season seed. */
export function coinFlipDraws(seed: string, stageKey: string, playerIds: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of playerIds) out[id] = coinFlipDraw(seed, stageKey, id);
  return out;
}

/** Splits `block` into consecutive blocks of equal `value`, ordered by it (stable). */
function splitBy(block: KitStanding[], value: (row: KitStanding) => number, direction: 'asc' | 'desc'): KitStanding[][] {
  const sorted = [...block].sort((a, b) => (direction === 'desc' ? value(b) - value(a) : value(a) - value(b)));
  const out: KitStanding[][] = [];
  for (const row of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && value(last[0]) === value(row)) last.push(row);
    else out.push([row]);
  }
  return out;
}

interface RankContext {
  input: StageStandingsInput;
  scored: readonly { match: MatchRecord; points: MatchPoints }[];
}

/** Results between the players of `block` only: wins (pairwise) or points (mini table). */
function miniTable(block: KitStanding[], ctx: RankContext, field: 'wins' | 'points'): Map<string, number> {
  const members = new Set(block.map((row) => row.player_id));
  const totals = new Map<string, number>(block.map((row) => [row.player_id, 0]));
  for (const { match, points } of ctx.scored) {
    if (!members.has(match.player_1_id) || !members.has(match.player_2_id)) continue;
    if (field === 'points') {
      totals.set(match.player_1_id, (totals.get(match.player_1_id) ?? 0) + points.p1);
      totals.set(match.player_2_id, (totals.get(match.player_2_id) ?? 0) + points.p2);
    } else if (match.winner_id !== null && members.has(match.winner_id)) {
      totals.set(match.winner_id, (totals.get(match.winner_id) ?? 0) + 1);
    }
  }
  return totals;
}

function splitBlock(block: KitStanding[], step: RankStep, ctx: RankContext): KitStanding[][] {
  switch (step.kind) {
    case 'metric': {
      if (metricValue(block[0], step.metric, ctx.input) === null) return [block];
      return splitBy(block, (row) => metricValue(row, step.metric, ctx.input) ?? 0, step.direction);
    }
    case 'head_to_head': {
      // Pairwise settles only a tie of exactly two; the mini table ranks any block by the points among its players.
      if (step.scope === 'pairwise' && block.length !== 2) return [block];
      const totals = miniTable(block, ctx, step.scope === 'pairwise' ? 'wins' : 'points');
      return splitBy(block, (row) => totals.get(row.player_id) ?? 0, 'desc');
    }
    case 'coin_flip': {
      const draws = new Map(
        block.map((row) => [
          row.player_id,
          ctx.input.coinFlips?.[row.player_id] ?? coinFlipDraw(ctx.input.seed ?? '', ctx.input.stage.key, row.player_id),
        ]),
      );
      const sorted = [...block].sort(
        (a, b) => (draws.get(a.player_id) ?? 0) - (draws.get(b.player_id) ?? 0) || (a.player_id < b.player_id ? -1 : 1),
      );
      return sorted.map((row) => [row]);
    }
    case 'manual': {
      const order = ctx.input.manualOrder ?? [];
      const position = new Map(order.map((id, i) => [id, i]));
      return splitBy(block, (row) => position.get(row.player_id) ?? order.length, 'asc');
    }
    case 'decision_match':
      return [block];
  }
}

const seedOf = (row: KitStanding, input: Pick<StageStandingsInput, 'seeds'>): number => input.seeds?.[row.player_id] ?? UNSEEDED;

/** Orders `rows` by `chain` and writes rank, tie groups and the decision-match flag. */
function rankRows(rows: KitStanding[], chain: readonly RankStep[], ctx: RankContext): KitStanding[] {
  let blocks: KitStanding[][] = rows.length === 0 ? [] : [rows];
  let decision = false;
  for (const step of chain) {
    if (step.kind === 'decision_match') {
      decision = true;
      break;
    }
    blocks = blocks.flatMap((block) => (block.length < 2 ? [block] : splitBlock(block, step, ctx)));
  }
  const out: KitStanding[] = [];
  let tie = 0;
  for (const block of blocks) {
    const group = block.length > 1 ? (tie += 1) : null;
    // Rows still tied take a canonical order, not the order the caller listed the participants in.
    if (block.length > 1) block.sort((a, b) => seedOf(a, ctx.input) - seedOf(b, ctx.input) || (a.player_id < b.player_id ? -1 : a.player_id > b.player_id ? 1 : 0));
    for (const row of block) {
      row.rank = out.length + 1;
      row.tie_group = group;
      row.needs_decision_match = decision && group !== null;
      out.push(row);
    }
  }
  return out;
}

/** One stage's table. */
export function computeStageStandings(input: StageStandingsInput): KitStanding[] {
  const { stage, maxRound } = input;
  const inRound = (round: number) => maxRound === undefined || round <= maxRound;
  const rows = new Map<string, KitStanding>();
  for (const id of input.participantIds) {
    if (!rows.has(id)) rows.set(id, emptyRow(input, id));
  }

  const scored: { match: MatchRecord; points: MatchPoints }[] = [];
  for (const match of input.matches) {
    if (!inRound(match.round_number)) continue;
    const s1 = rows.get(match.player_1_id);
    const s2 = rows.get(match.player_2_id);
    if (!s1 || !s2) continue;
    const outcome = match.match_id === undefined ? undefined : input.outcomes?.[match.match_id];
    const points = scoreMatch(match, input.scoringOf?.(match) ?? stage.scoring, outcome);
    if (points === null) continue;
    scored.push({ match, points });
    s1.points += points.p1;
    s2.points += points.p2;
    const kills = match.match_id === undefined ? undefined : input.kills?.[match.match_id];
    if (kills !== undefined) {
      s1.kill_differential += kills[match.player_1_id] ?? 0;
      s2.kill_differential += kills[match.player_2_id] ?? 0;
    }
    if (match.winner_id === match.player_1_id) {
      s1.wins += 1;
      s2.losses += 1;
    } else if (match.winner_id === match.player_2_id) {
      s2.wins += 1;
      s1.losses += 1;
    } else {
      s1.draws += 1;
      s2.draws += 1;
    }
    if (outcome !== undefined && (outcome.kind === 'forfeit' || outcome.kind === 'no_show')) {
      const [winner, loser] = match.winner_id === match.player_1_id ? [s1, s2] : [s2, s1];
      winner.forfeit_wins += 1;
      loser.forfeit_losses += 1;
    }
    if (outcome !== undefined) {
      s1.faints_taken += outcome.p1_faints ?? 0;
      s1.faints_dealt += outcome.p2_faints ?? 0;
      s2.faints_taken += outcome.p2_faints ?? 0;
      s2.faints_dealt += outcome.p1_faints ?? 0;
    }
    const played = match.match_id === undefined ? undefined : (input.gamesByMatch?.[match.match_id]?.length ?? input.gameCounts?.[match.match_id]);
    if (played) {
      s1.games_played += played;
      s2.games_played += played;
    }
  }

  for (const bye of input.byes ?? []) {
    if (!inRound(bye.round_number)) continue;
    const row = rows.get(bye.player_id);
    if (!row) continue;
    row.wins += 1;
    row.points += input.byePointsOf?.(bye) ?? stage.scoring.bye;
  }

  for (const { match } of scored) {
    const s1 = rows.get(match.player_1_id);
    const s2 = rows.get(match.player_2_id);
    if (!s1 || !s2) continue;
    s1.buchholz += s2.points;
    s2.buchholz += s1.points;
  }

  for (const [playerId, extra] of Object.entries(input.pointAdjustments ?? {})) {
    const row = rows.get(playerId);
    if (row) row.points += extra;
  }
  attachCustomMetrics([...rows.values()], input);

  const chain = stage.rank.length > 0 ? stage.rank : LEGACY_RANK_CHAIN;
  const table = rankRows([...rows.values()], chain, { input, scored });
  for (const placement of input.placements ?? []) {
    for (const row of table) {
      row.metrics = { ...row.metrics, [placement.key]: placement.points[row.rank - 1] ?? 0 };
    }
  }
  return table;
}

/** Sets `row.metrics` from the precomputed values and the `metric.define` expressions; rows stay bare without either. */
function attachCustomMetrics(rows: KitStanding[], input: StageStandingsInput): void {
  const defs = input.metricDefs ?? [];
  if (defs.length === 0 && input.customMetrics === undefined) return;
  const relations = new Map<string, (a: string, b: string) => boolean>();
  for (const [key, pairs] of Object.entries(input.relations ?? {})) {
    const linked = new Set(pairs.map(([from, to]) => `${from}\u0000${to}`));
    relations.set(key, (a, b) => linked.has(`${a}\u0000${b}`));
  }
  for (const row of rows) {
    const given = input.customMetrics?.[row.player_id];
    if (defs.length === 0 && given === undefined) continue;
    const metrics: Record<string, number> = { ...given };
    if (defs.length > 0) {
      const refs = new Map<string, ExprValue>(
        PLAYER_ROW_FIELDS.map((field) => [field, field === 'participants' ? rows.length : ((row as unknown as Record<string, number | undefined>)[field] ?? 0)]),
      );
      refs.set('rank', 0);
      refs.set('group_rank', 0);
      refs.set('player', row.player_id);
      for (const [name, value] of Object.entries(input.playerRefs?.[row.player_id] ?? {})) refs.set(name, value);
      // The scope names the player: `rand('k')` takes a literal key, so without the player every row would draw alike.
      const ctx = { refs, collections: new Map(), relations, seed: input.seed ?? '', scope: `metric:${input.stage.key}:${row.player_id}` };
      for (const def of defs) {
        const result = evaluate(def.expr, ctx, 'number');
        metrics[def.key] = result.ok && typeof result.value === 'number' ? result.value : 0;
      }
    }
    row.metrics = metrics;
  }
}

export interface ViewRow {
  player_id: string;
  player_name: string;
  value: number;
  /** Per stage key: the player's value in that stage (absent when the player was not in it). */
  by_stage: Record<string, number>;
  rank: number;
}

/**
 * A cross-stage view (`standings.view`): one metric summed over the named stages, highest first, ties in the order the
 * players first appear. Stages missing from `tables` add nothing.
 */
export function computeViewStandings(
  view: { stages: readonly string[]; metric: string },
  tables: Readonly<Record<string, readonly KitStanding[]>>,
  input: Pick<StageStandingsInput, 'seeds' | 'ratings'> = {},
): ViewRow[] {
  const rows = new Map<string, ViewRow>();
  for (const key of view.stages) {
    for (const row of tables[key] ?? []) {
      const value = metricValue(row, view.metric, input) ?? 0;
      const entry = rows.get(row.player_id) ?? { player_id: row.player_id, player_name: row.player_name, value: 0, by_stage: {}, rank: 0 };
      entry.value += value;
      entry.by_stage[key] = (entry.by_stage[key] ?? 0) + value;
      rows.set(row.player_id, entry);
    }
  }
  const sorted = [...rows.values()].sort((a, b) => b.value - a.value);
  sorted.forEach((row, i) => {
    row.rank = i + 1;
  });
  return sorted;
}
