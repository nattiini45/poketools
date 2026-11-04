/**
 * Golden parity of the kit standings against the legacy tables. Every fixture league is described by the legacy
 * descriptor (`describeLegacy`); each stage's described scoring and rank chain, run through the kit dispatcher,
 * must give the same table as the legacy code that league runs today, for many seeded result sets. Forfeits and
 * faint tallies are recorded too: a described league scores neither (legacy counts a forfeit as a plain win), so
 * they must not move a single point.
 *
 * Known gap, kept out on purpose: Evolution Point Buy ranks by evolution points, which have no kit metric. The
 * fixtures give every player 0, so that step never splits a tie on either side. Ties of three or more players on
 * every step before head-to-head are also skipped: legacy compares head-to-head inside its sort comparator (not a
 * total order), the kit settles only a tie of exactly two.
 */
import { describe, expect, it } from 'vitest';
import type { Stage } from '@/lib/format-kit/types';
import { describeLegacy } from '@/lib/format-studio/legacy/describe-legacy';
import type { LegacyInput, LegacyStageInput } from '@/lib/format-studio/legacy/types';
import { FIXTURE_LEAGUES } from '@/lib/format-studio/__tests__/fixtures/leagues';
import type { TournamentBattleStat } from '@/lib/supabase/queries/games';
import { computeEvolutionPointBuyStandings } from '@/lib/tournament/evolution-standings';
import { computeStandings, computeStandingsForFormat } from '@/lib/tournament/standings';
import { ROUND_ROBIN_MATCH_POINTS } from '@/lib/tournament/standings-rules';
import type { ByeRecord, MatchRecord, Standing } from '@/lib/tournament/types';
import type { KitStandingsData } from '../context';
import type { KitOutcome } from '../standings';

const SEEDS = [1, 7, 42, 99, 2024, 31337];
const PHASE = 'phase-1';

/** A small seeded generator (mulberry32): the result sets are the same on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ResultSet {
  ids: string[];
  names: Record<string, string>;
  matches: MatchRecord[];
  byes: ByeRecord[];
  battleStats: TournamentBattleStat[];
  gamesByMatch: Record<string, string[]>;
  outcomes: Record<string, KitOutcome>;
}

function results(seed: number, players: number, rounds: number): ResultSet {
  const next = rng(seed);
  const ids = Array.from({ length: players }, (_, i) => `p${i + 1}`);
  const names = Object.fromEntries(ids.map((id) => [id, id.toUpperCase()]));
  const out: ResultSet = { ids, names, matches: [], byes: [], battleStats: [], gamesByMatch: {}, outcomes: {} };
  for (let round = 1; round <= rounds; round += 1) {
    const order = [...ids].sort(() => next() - 0.5);
    if (order.length % 2 === 1) out.byes.push({ player_id: order.pop() as string, round_number: round });
    for (let i = 0; i < order.length; i += 2) {
      const [p1, p2] = [order[i], order[i + 1]];
      const matchId = `m${round}-${i / 2}`;
      const winner = next() < 0.5 ? p1 : p2;
      out.matches.push({ match_id: matchId, player_1_id: p1, player_2_id: p2, winner_id: winner, round_number: round });
      const games = 1 + Math.floor(next() * 3);
      out.gamesByMatch[matchId] = Array.from({ length: games }, () => winner);
      for (const player of [p1, p2]) {
        for (let mon = 0; mon < 3; mon += 1) {
          out.battleStats.push({
            game_id: `${matchId}-g1`,
            player_id: player,
            pokemon_name: `mon${mon}`,
            was_brought: true,
            was_lead: mon === 0,
            kos_dealt: Math.floor(next() * 3),
            was_koed: next() < 0.5,
            round_number: round,
          });
        }
      }
      const roll = next();
      if (roll < 0.15) out.outcomes[matchId] = { kind: 'forfeit', p1_faints: null, p2_faints: null };
      else if (roll < 0.25) out.outcomes[matchId] = { kind: 'no_show', p1_faints: null, p2_faints: null };
      else if (roll < 0.6) {
        out.outcomes[matchId] = {
          kind: 'played',
          p1_faints: winner === p1 ? Math.floor(next() * 5) : 6,
          p2_faints: winner === p2 ? Math.floor(next() * 5) : 6,
        };
      }
    }
  }
  return out;
}

const isTable = (stage: LegacyStageInput) => stage.bracketType === 'round_robin' || stage.bracketType === 'swiss';

/** What the legacy code scores per win for this stage, as its call sites pass it (not read from the descriptor). */
function legacyPointsPerWin(league: LegacyInput, stage: LegacyStageInput): number {
  if (league.season.formatType === 'evolution_point_buy') return league.pack.epb.matchPoints.win;
  return stage.bracketType === 'round_robin' ? ROUND_ROBIN_MATCH_POINTS.pointsPerWin : 1;
}

/** Legacy scores stored byes in a Swiss table only, and never in Evolution Point Buy (`scoringByeRecords`). */
function legacyScoresByes(league: LegacyInput, stage: LegacyStageInput): boolean {
  return stage.bracketType === 'swiss' && league.season.formatType !== 'evolution_point_buy';
}

function legacyTable(league: LegacyInput, stage: LegacyStageInput, set: ResultSet): Standing[] {
  if (league.season.formatType === 'evolution_point_buy') {
    return computeEvolutionPointBuyStandings(set.ids, set.names, set.matches, {}, {}, {
      pointsPerWin: league.pack.epb.matchPoints.win,
      pointsPerDraw: league.pack.epb.matchPoints.draw,
      battleStats: set.battleStats,
      tiebreakerOrder: league.facts.formatRules?.tiebreaker_order ?? league.pack.epb.tiebreakerChain,
    });
  }
  return computeStandings(set.ids, set.names, set.matches, {}, {
    pointsPerWin: legacyPointsPerWin(league, stage),
    pointsPerDraw: 0,
    battleStats: set.battleStats,
    gamesByMatch: set.gamesByMatch,
    byes: legacyScoresByes(league, stage) ? set.byes : undefined,
  });
}

function kitTable(described: Stage, league: LegacyInput, stage: LegacyStageInput, set: ResultSet): Standing[] {
  const kit: KitStandingsData = {
    engine: 'kit',
    stages: { [PHASE]: { key: described.key, scoring: described.scoring, rank: described.rank } },
    stageOfMatch: Object.fromEntries(set.matches.map((m) => [m.match_id as string, PHASE])),
    outcomes: set.outcomes,
    coinFlips: { [PHASE]: {} },
  };
  return computeStandingsForFormat('custom', set.ids, set.names, set.matches, {}, {
    battleStats: set.battleStats,
    gamesByMatch: set.gamesByMatch,
    byes: legacyScoresByes(league, stage) ? set.byes : undefined,
  }, {}, { kit });
}

/** True when three or more players are level on every step that runs before head-to-head. */
function wideTieBeforeHeadToHead(table: Standing[], evolutionPointBuy: boolean): boolean {
  if (!evolutionPointBuy) return false;
  const counts = new Map<string, number>();
  for (const row of table) {
    const key = `${row.points}|${row.kill_differential}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].some((n) => n >= 3);
}

function shape(rows: Standing[], evolutionPointBuy: boolean) {
  return rows.map((row) => ({
    player_id: row.player_id,
    points: row.points,
    wins: row.wins,
    losses: row.losses,
    kill_differential: row.kill_differential,
    ...(evolutionPointBuy
      ? { needs_decision_match: (row as Standing & { needs_decision_match?: boolean }).needs_decision_match === true }
      : { buchholz: row.buchholz, games_played: row.games_played }),
  }));
}

const cases = Object.entries(FIXTURE_LEAGUES).flatMap(([name, league]) => {
  const definition = describeLegacy(league);
  const evolutionPointBuy = league.season.formatType === 'evolution_point_buy';
  return league.stages
    .map((stage, index) => ({ name, league, stage, described: definition.stages[index], evolutionPointBuy }))
    // An Evolution Point Buy league has no table for its elimination stages.
    .filter((c) => !evolutionPointBuy || isTable(c.stage))
    .map((c) => ({ ...c, label: `${name} / ${c.stage.name} (${c.stage.bracketType})` }));
});

describe('kit standings match the legacy tables of every fixture league', () => {
  it('covers every fixture league', () => {
    expect(new Set(cases.map((c) => c.name))).toEqual(new Set(Object.keys(FIXTURE_LEAGUES)));
  });

  it.each(cases)('$label', ({ league, stage, described, evolutionPointBuy }) => {
    const players = stage.bracketType === 'swiss' ? 7 : 8;
    const rounds = stage.bracketType === 'round_robin' ? 7 : 4;
    let compared = 0;
    for (const seed of SEEDS) {
      const set = results(seed, players, rounds);
      const legacy = legacyTable(league, stage, set);
      if (wideTieBeforeHeadToHead(legacy, evolutionPointBuy)) continue;
      const kit = kitTable(described, league, stage, set);
      expect(shape(kit, evolutionPointBuy), `seed ${seed}`).toEqual(shape(legacy, evolutionPointBuy));
      compared += 1;
    }
    expect(compared).toBeGreaterThanOrEqual(3);
  });
});
