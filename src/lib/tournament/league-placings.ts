import type { MatchRecord } from './types';
import type { SeasonStandingsContext } from './season-standings';

export interface LeagueRankingStage {
  id: string;
  bracket_type?: string;
  third_place_enabled?: boolean;
  participant_count?: number;
  bracket_reset_enabled?: boolean;
}

export type PlayoffRecord = MatchRecord;

export function isPlayoffStage(stage: LeagueRankingStage): boolean {
  return stage.bracket_type === 'single_elim' || stage.bracket_type === 'double_elim';
}

export function playoffStandingsOptions(stage: LeagueRankingStage | null | undefined, participantCount?: number): { playoffStage?: LeagueRankingStage } {
  return stage && isPlayoffStage(stage)
    ? { playoffStage: { ...stage, ...(participantCount === undefined ? {} : { participant_count: participantCount }) } }
    : {};
}

export function groupStageIds(stages: readonly LeagueRankingStage[]): string[] {
  return stages.filter((stage) => !isPlayoffStage(stage)).map((stage) => stage.id);
}

export function groupStageRanking(context: SeasonStandingsContext, stages: readonly LeagueRankingStage[]): SeasonStandingsContext {
  if (!context.kit || !stages.some(isPlayoffStage)) return context;
  const ids = new Set(groupStageIds(stages));
  return { ...context, kit: { ...context.kit,
    stages: Object.fromEntries(Object.entries(context.kit.stages).filter(([id]) => ids.has(id))),
    adjustments: Object.fromEntries(Object.entries(context.kit.adjustments ?? {}).filter(([id]) => ids.has(id))),
  } };
}

export function playoffRanks(stage: LeagueRankingStage, records: readonly PlayoffRecord[]): Map<string, number> {
  const ranks = new Map<string, number>();
  if (!isPlayoffStage(stage) || records.length === 0) return ranks;
  const double = stage.bracket_type === 'double_elim';
  const finals = records.filter((record) => double ? record.bracket_side === 'grand_finals' : true);
  const lastRound = Math.max(...finals.map((record) => record.round_number));
  if (!double) {
    const main = records.filter((record) => record.round_number < lastRound || (record.bracket_pos ?? 0) === 0);
    const entrants = new Set(main.flatMap((record) => [record.player_1_id, record.player_2_id]));
    const lost = new Set(main.filter((record) => record.winner_id).map((record) =>
      record.winner_id === record.player_1_id ? record.player_2_id : record.player_1_id));
    if (entrants.size < (stage.participant_count ?? 2) || entrants.size - lost.size !== 1) return ranks;
  }
  const orderedFinals = [...finals].sort((a, b) => a.round_number - b.round_number || (a.bracket_pos ?? 0) - (b.bracket_pos ?? 0));
  const firstFinal = orderedFinals[0];
  if (!firstFinal) return ranks;
  let final = orderedFinals.find((record) => record.round_number === lastRound && (record.bracket_pos ?? 0) === 0);
  if (double) {
    final = firstFinal;
    if (stage.bracket_reset_enabled !== false && firstFinal.winner_id === firstFinal.player_2_id) {
      if (orderedFinals.length < 2) return ranks;
      final = orderedFinals[orderedFinals.length - 1];
    }
  }
  if (!final?.winner_id) return ranks;
  const loser = (record: PlayoffRecord) => record.winner_id === record.player_1_id ? record.player_2_id : record.player_1_id;
  ranks.set(final.winner_id, 1);
  ranks.set(loser(final), 2);
  const eliminationRounds = new Map<number, string[]>();
  for (const record of records) {
    if (!record.winner_id || record === final || record.round_number > lastRound) continue;
    if (double && record.bracket_side !== 'losers') continue;
    if (!double && record.round_number === lastRound) continue;
    const id = loser(record);
    if (ranks.has(id)) continue;
    const round = eliminationRounds.get(record.round_number) ?? [];
    round.push(id);
    eliminationRounds.set(record.round_number, round);
  }
  for (const [, players] of [...eliminationRounds].sort(([a], [b]) => b - a)) {
    const rank = ranks.size + 1;
    for (const id of players) if (!ranks.has(id)) ranks.set(id, rank);
  }
  if (!double && stage.third_place_enabled) {
    const bronze = records.find((record) => record.round_number === lastRound && record.bracket_pos === 1);
    if (bronze?.winner_id) {
      ranks.set(bronze.winner_id, 3);
      ranks.set(loser(bronze), 4);
    }
  }
  return ranks;
}

export function finalLeaguePlacings<T extends { player_id: string }>(
  groupTable: readonly T[],
  stages: readonly LeagueRankingStage[],
  recordsByStage: ReadonlyMap<string, readonly PlayoffRecord[]>,
): (T & { rank: number })[] | undefined {
  const playoffs = stages.filter(isPlayoffStage);
  if (playoffs.length === 0) return undefined;
  // Each block contains rank groups in finishing order. A group may contain several tied players.
  let blocks: string[][][] = [];
  for (const stage of playoffs) {
    const bracketRanks = playoffRanks(stage, recordsByStage.get(stage.id) ?? []);
    if (bracketRanks.size === 0) return undefined;
    const groups = new Map<number, string[]>();
    for (const [id, rank] of [...bracketRanks].sort((a, b) => a[1] - b[1])) {
      const group = groups.get(rank) ?? [];
      group.push(id);
      groups.set(rank, group);
    }
    const dependent = blocks.filter((block) => block.some((group) => group.some((id) => bracketRanks.has(id))));
    if (dependent.length === 0) {
      blocks.push([...groups.values()]);
      continue;
    }
    const first = blocks.indexOf(dependent[0]);
    const eliminated = dependent.flat()
      .map((group) => group.filter((id) => !bracketRanks.has(id)))
      .filter((group) => group.length > 0);
    blocks = blocks.filter((block, index) => index === first || !dependent.includes(block));
    blocks[first] = [...groups.values(), ...eliminated];
  }
  const ranks = new Map<string, number>();
  let rank = 1;
  for (const group of blocks.flat()) {
    for (const id of group) ranks.set(id, rank);
    rank += group.length;
  }
  const placed = groupTable.filter((row) => ranks.has(row.player_id));
  placed.sort((a, b) => ranks.get(a.player_id)! - ranks.get(b.player_id)!);
  const rest = groupTable.filter((row) => !ranks.has(row.player_id));
  return [
    ...placed.map((row) => ({ ...row, rank: ranks.get(row.player_id)! })),
    ...rest.map((row, index) => ({ ...row, rank: placed.length + index + 1 })),
  ];
}
