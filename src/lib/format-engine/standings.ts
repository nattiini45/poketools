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
 * Ranking: the rows start in participant order and the rank chain splits tied blocks step by step. A block still
 * tied after the chain keeps participant order. An empty chain (a bracket stage) ranks like the legacy table:
 * points, KO differential, Buchholz, wins.
 */
import { forfeitScoringOf, perOpponentFaintOf } from '@/lib/format-kit/scoring';
import type { RankStep, Scoring, Stage } from '@/lib/format-kit/types';
import { seededRand } from '@/lib/format-kit/expr/rand';
import type { TournamentBattleStat } from '@/lib/supabase/queries/games';
import type { ByeRecord, MatchRecord, Standing } from '@/lib/tournament/types';
import type { MatchOutcome } from '@/types/match-outcome';

/** The public part of a `match_outcomes` row: what standings read. */
export type KitOutcome = Pick<MatchOutcome, 'kind' | 'p1_faints' | 'p2_faints'>;

export interface KitStanding extends Standing {
  /** Place in the table, 1-based. Rows still tied after the whole chain have different places in participant order. */
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
  byes?: readonly ByeRecord[];
  battleStats?: readonly TournamentBattleStat[];
  gamesByMatch?: Readonly<Record<string, readonly string[]>>;
  /** Only matches, byes and stats up to this round. */
  maxRound?: number;
  /** Seed per player (1 = first); a player without one sorts after every seeded player. */
  seeds?: Readonly<Record<string, number>>;
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
  /** The admin's order of the players (`rank.manual`); unlisted players stay tied behind the listed ones. */
  manualOrder?: readonly string[];
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
      return null;
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

/** Orders `rows` (participant order) by `chain` and writes rank, tie groups and the decision-match flag. */
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
    const games = match.match_id === undefined ? undefined : input.gamesByMatch?.[match.match_id];
    if (games) {
      s1.games_played += games.length;
      s2.games_played += games.length;
    }
  }

  for (const bye of input.byes ?? []) {
    if (!inRound(bye.round_number)) continue;
    const row = rows.get(bye.player_id);
    if (!row) continue;
    row.wins += 1;
    row.points += stage.scoring.bye;
  }

  for (const { match } of scored) {
    const s1 = rows.get(match.player_1_id);
    const s2 = rows.get(match.player_2_id);
    if (!s1 || !s2) continue;
    s1.buchholz += s2.points;
    s2.buchholz += s1.points;
  }

  for (const stat of input.battleStats ?? []) {
    if (!inRound(stat.round_number)) continue;
    const row = rows.get(stat.player_id);
    if (!row) continue;
    row.kill_differential += stat.kos_dealt;
    if (stat.was_koed) row.kill_differential -= 1;
  }

  const chain = stage.rank.length > 0 ? stage.rank : LEGACY_RANK_CHAIN;
  return rankRows([...rows.values()], chain, { input, scored });
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
