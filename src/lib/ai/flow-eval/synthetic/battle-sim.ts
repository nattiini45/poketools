/**
 * A tiny stylised singles battle generator that writes a Pokémon Showdown replay log. It is not a
 * rules engine: it picks moves from the sets, subtracts a random percentage of HP, lets one side
 * win by construction and logs the protocol lines (`|switch|`, `|move|`, `|-damage|`, `|faint|`,
 * `|win|`, weather, hazards, Terastallization) that the app's own `extractBattleFrames` reads. The
 * point is a believable turn-by-turn summary for the context builder, not battle realism.
 */

import type { PokemonSet } from '@/types/team';
import { createRng, MOVE_KIND, WEATHER_ABILITY } from './roster';

export type Side = 'p1' | 'p2';

export interface SimMonStat {
  species: string;
  brought: true;
  lead: boolean;
  kos: number;
  koed: boolean;
  moves: string[];
  turnsActive: number;
}

export interface SimResult {
  log: string;
  winner: Side;
  turns: number;
  /** Per side, the Pokémon that took part. */
  stats: Record<Side, SimMonStat[]>;
}

interface Mon {
  set: PokemonSet;
  hp: number;
  fainted: boolean;
  stat: SimMonStat;
  tera: boolean;
}

interface SimInput {
  names: Record<Side, string>;
  /** The Pokémon each side brings, lead first. */
  teams: Record<Side, PokemonSet[]>;
  /** The side that wins. */
  winner: Side;
  seed: number;
  /** Gen number for the `|gen|` line. */
  gen?: number;
}

const ident = (side: Side, mon: Mon): string => `${side}a: ${mon.set.species}`;

function runOnce(input: SimInput, seed: number): SimResult {
  const rng = createRng(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)];
  const sides: Side[] = ['p1', 'p2'];
  const mons: Record<Side, Mon[]> = { p1: [], p2: [] };
  for (const side of sides) {
    mons[side] = input.teams[side].map((set, i) => ({
      set,
      hp: 100,
      fainted: false,
      tera: false,
      stat: { species: set.species, brought: true, lead: i === 0, kos: 0, koed: false, moves: [], turnsActive: 0 },
    }));
  }
  const active: Record<Side, number> = { p1: 0, p2: 0 };
  const hazards: Record<Side, Set<string>> = { p1: new Set(), p2: new Set() };
  const teraTurn: Record<Side, number> = { p1: 2 + Math.floor(rng() * 6), p2: 2 + Math.floor(rng() * 6) };
  const lines: string[] = [];
  const out = (line: string): void => void lines.push(line);
  const other = (side: Side): Side => (side === 'p1' ? 'p2' : 'p1');
  const cur = (side: Side): Mon => mons[side][active[side]];
  const alive = (side: Side): Mon[] => mons[side].filter((m) => !m.fainted);

  out(`|player|p1|${input.names.p1}|1|`);
  out(`|player|p2|${input.names.p2}|2|`);
  out(`|teamsize|p1|${mons.p1.length}`);
  out(`|teamsize|p2|${mons.p2.length}`);
  out('|gametype|singles');
  out(`|gen|${input.gen ?? 9}`);
  out(`|tier|[Gen ${input.gen ?? 9}] OU`);
  out('|start');

  const switchIn = (side: Side, index: number): void => {
    active[side] = index;
    const mon = cur(side);
    out(`|switch|${ident(side, mon)}|${mon.set.species}|${mon.hp}/100`);
    const weather = WEATHER_ABILITY[mon.set.ability];
    if (weather) out(`|-weather|${weather}|[from] ability: ${mon.set.ability}|[of] ${ident(side, mon)}`);
  };
  switchIn('p1', 0);
  switchIn('p2', 0);

  // The winner hits harder, so the scripted result is the likely one; the caller retries seeds until it holds.
  const power: Record<Side, number> = input.winner === 'p1' ? { p1: 1.25, p2: 0.8 } : { p1: 0.8, p2: 1.25 };

  let turn = 1;
  let winner: Side | null = null;
  out(`|turn|${turn}`);
  while (winner === null && turn <= 45) {
    for (const side of sides) cur(side).stat.turnsActive += 1;
    const order: Side[] = rng() < 0.5 ? ['p1', 'p2'] : ['p2', 'p1'];
    for (const side of order) {
      const me = cur(side);
      if (me.fainted) continue;
      const foeSide = other(side);
      const foe = cur(foeSide);
      if (!me.tera && turn === teraTurn[side] && me.set.tera_type) {
        me.tera = true;
        out(`|-terastallize|${ident(side, me)}|${me.set.tera_type}`);
      }
      const bench = alive(side).filter((m) => m !== me);
      if (me.hp < 35 && bench.length > 0 && rng() < 0.3) {
        switchIn(side, mons[side].indexOf(pick(bench)));
        continue;
      }
      const move = pick(me.set.moves);
      if (!me.stat.moves.includes(move)) me.stat.moves.push(move);
      out(`|move|${ident(side, me)}|${move}|${ident(foeSide, foe)}`);
      const kind = MOVE_KIND[move];
      if (kind === 'hazard') {
        if (!hazards[foeSide].has(move)) {
          hazards[foeSide].add(move);
          out(`|-sidestart|${foeSide}: ${input.names[foeSide]}|move: ${move}`);
        }
        continue;
      }
      if (kind === 'boost') {
        out(`|-boost|${ident(side, me)}|atk|1`);
        continue;
      }
      if (kind === 'recover') {
        me.hp = Math.min(100, me.hp + 35 + Math.floor(rng() * 15));
        out(`|-heal|${ident(side, me)}|${me.hp}/100|[from] move: ${move}`);
        continue;
      }
      if (kind === 'status') continue;
      const damage = Math.max(6, Math.round((14 + rng() * 34) * power[side]));
      foe.hp = Math.max(0, foe.hp - damage);
      if (foe.hp > 0) {
        out(`|-damage|${ident(foeSide, foe)}|${foe.hp}/100`);
      } else {
        out(`|-damage|${ident(foeSide, foe)}|0 fnt`);
        out(`|faint|${ident(foeSide, foe)}`);
        foe.fainted = true;
        foe.stat.koed = true;
        me.stat.kos += 1;
      }
    }
    out('|upkeep');
    for (const side of sides) {
      if (!cur(side).fainted) continue;
      const next = alive(side)[0];
      if (next === undefined) {
        winner = other(side);
      } else if (winner === null) {
        switchIn(side, mons[side].indexOf(next));
      }
    }
    if (winner === null) {
      turn += 1;
      out(`|turn|${turn}`);
    }
  }
  if (winner === null) winner = input.winner;
  out(`|win|${input.names[winner]}`);

  const stats: Record<Side, SimMonStat[]> = {
    p1: mons.p1.filter((m) => m.stat.turnsActive > 0).map((m) => m.stat),
    p2: mons.p2.filter((m) => m.stat.turnsActive > 0).map((m) => m.stat),
  };
  return { log: lines.join('\n'), winner, turns: turn, stats };
}

/** Simulate a game whose result is `input.winner`, trying seeds from `input.seed` until the scripted winner wins. */
export function simulateGame(input: SimInput): SimResult {
  let last: SimResult | null = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    last = runOnce(input, input.seed + attempt * 7919);
    if (last.winner === input.winner && last.turns >= 6) return last;
  }
  if (last === null || last.winner !== input.winner) throw new Error(`could not script a win for ${input.winner} from seed ${input.seed}`);
  return last;
}
