/**
 * Advancement along a kit edge: which players of the source stage move on, and in which seed order. Pure and
 * client-safe; the advance route reads the source table and writes the target's participants.
 *
 * The selections run in order and never pick a player twice:
 * - `top_n`: the best `n` of the whole table;
 * - `per_group`: the best `n` of each group (group tables keep the order of the whole table);
 * - `wildcard`: the best `n` of the players not picked yet;
 * - `threshold`: every player whose row meets the expression (the fields the compiler type-checks against:
 *   `points`, `wins`, `losses`, `games_played`, `rank`, `group_rank`, `faints_dealt`, `faints_taken`,
 *   `kill_differential`, `buchholz`, plus `participants`, and the `standings` collection);
 * - `bottom_n`: the last `n` of the table, in table order;
 * - `manual_list`: the players an admin listed, in their order (up to `count`). Without a list the edge waits for one.
 *
 * Seeding of the target: `rank` keeps the order of the source table, `cross_group` deals group places
 * (every group's first, then every group's second, ...), `random` shuffles with the season seed and `manual`
 * keeps the selection order for the admin to change.
 */
import type { Edge } from '@/lib/format-kit/types';
import type { ExprIssue, ExprValue } from '@/lib/format-kit/expr/ast';
import { evaluate } from '@/lib/format-kit/expr/eval';
import { seededRand } from '@/lib/format-kit/expr/rand';
import type { KitStanding } from './standings';

export interface AdvancementInput {
  edge: Pick<Edge, 'key' | 'select' | 'seeding'>;
  /** The source stage's table, ranked. */
  table: readonly KitStanding[];
  /** Group number per player, when the source stage has groups. */
  groupOf?: Readonly<Record<string, number>>;
  /** The admin's list for a `manual_list` selection. */
  manualList?: readonly string[];
  seed?: string | null;
}

export interface AdvancedPlayer {
  player_id: string;
  /** Seed in the target stage, 1-based. */
  seed: number;
  /** Index of the selection that picked the player. */
  select: number;
}

export interface AdvancementResult {
  players: AdvancedPlayer[];
  /** True when a `manual_list` selection has no list yet: nothing is written until an admin gives one. */
  awaitingManualList: boolean;
  /** Rows whose threshold expression failed, with the issue. */
  issues: { player_id: string; select: number; issue: ExprIssue }[];
}

interface Placed {
  row: KitStanding;
  overall: number;
  group: number | null;
  groupRank: number;
}

function placements(input: AdvancementInput): Placed[] {
  const seen = new Map<number | null, number>();
  return input.table.map((row, i) => {
    const group = input.groupOf?.[row.player_id] ?? null;
    const groupRank = (seen.get(group) ?? 0) + 1;
    seen.set(group, groupRank);
    return { row, overall: i + 1, group, groupRank };
  });
}

function fields(placed: Placed): Map<string, ExprValue> {
  const { row } = placed;
  return new Map<string, ExprValue>([
    ['points', row.points],
    ['wins', row.wins],
    ['losses', row.losses],
    ['games_played', row.games_played],
    ['rank', placed.overall],
    ['group_rank', placed.groupRank],
    ['faints_dealt', row.faints_dealt],
    ['faints_taken', row.faints_taken],
    ['kill_differential', row.kill_differential],
    ['buchholz', row.buchholz],
  ]);
}

/**
 * The advanced players that belong to group `group` of the source stage, in their order and re-seeded from 1: what one
 * phase of a `foreach_group` stage is filled with. A player the source has no group for belongs to no group phase.
 */
export function playersOfGroup(
  players: readonly AdvancedPlayer[],
  groupOf: Readonly<Record<string, number>>,
  group: number,
): AdvancedPlayer[] {
  return players.filter((p) => groupOf[p.player_id] === group).map((p, i) => ({ ...p, seed: i + 1 }));
}

export function resolveAdvancement(input: AdvancementInput): AdvancementResult {
  const placed = placements(input);
  const picked = new Map<string, { at: Placed; select: number }>();
  const issues: AdvancementResult['issues'] = [];
  let awaitingManualList = false;
  const pick = (at: Placed, select: number) => {
    if (!picked.has(at.row.player_id)) picked.set(at.row.player_id, { at, select });
  };
  const rest = () => placed.filter((p) => !picked.has(p.row.player_id));

  input.edge.select.forEach((select, index) => {
    switch (select.kind) {
      case 'top_n':
        for (const at of placed.slice(0, select.n)) pick(at, index);
        break;
      case 'per_group':
        for (const at of placed) if (at.groupRank <= select.n) pick(at, index);
        break;
      case 'wildcard':
        for (const at of rest().slice(0, select.n)) pick(at, index);
        break;
      case 'bottom_n':
        for (const at of placed.slice(Math.max(0, placed.length - select.n))) pick(at, index);
        break;
      case 'threshold': {
        const rows = placed.map(fields);
        for (const at of placed) {
          const refs = fields(at);
          refs.set('participants', placed.length);
          const result = evaluate(
            select.when,
            { refs, collections: new Map([['standings', rows]]), relations: new Map(), seed: input.seed ?? '', scope: `advance:${input.edge.key}` },
            'boolean',
          );
          if (!result.ok) issues.push({ player_id: at.row.player_id, select: index, issue: result.issue });
          else if (result.value === true) pick(at, index);
        }
        break;
      }
      case 'manual_list': {
        if (input.manualList === undefined) {
          awaitingManualList = true;
          break;
        }
        const byId = new Map(placed.map((p) => [p.row.player_id, p]));
        const list = select.count === undefined ? input.manualList : input.manualList.slice(0, select.count);
        for (const id of list) {
          const at = byId.get(id);
          if (at !== undefined) pick(at, index);
        }
        break;
      }
    }
  });

  let ordered = [...picked.values()];
  switch (input.edge.seeding) {
    case 'rank':
      ordered.sort((a, b) => a.at.overall - b.at.overall);
      break;
    case 'cross_group':
      ordered.sort((a, b) => a.at.groupRank - b.at.groupRank || (a.at.group ?? 0) - (b.at.group ?? 0) || a.at.overall - b.at.overall);
      break;
    case 'random': {
      const scope = `advance:${input.edge.key}`;
      const seed = input.seed ?? '';
      ordered = ordered
        .map((entry) => ({ entry, draw: seededRand(seed, scope, entry.at.row.player_id) }))
        .sort((a, b) => a.draw - b.draw || (a.entry.at.row.player_id < b.entry.at.row.player_id ? -1 : 1))
        .map(({ entry }) => entry);
      break;
    }
    case 'manual':
      break;
  }
  return {
    players: ordered.map((entry, i) => ({ player_id: entry.at.row.player_id, seed: i + 1, select: entry.select })),
    awaitingManualList,
    issues,
  };
}
