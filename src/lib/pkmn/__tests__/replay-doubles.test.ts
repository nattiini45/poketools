/**
 * Doubles attribution (#53). The logs are hand-authored from the Showdown protocol shapes (no recorded replay, no player
 * names) and parsed with the real Pokédex and protocol parser. Every expectation below was worked out by hand from the
 * log lines.
 */
import { describe, expect, it } from 'vitest';
import { parseReplayLog } from '../replay';

type Parsed = ReturnType<typeof parseReplayLog>;

function row(result: Parsed, side: 'p1' | 'p2', name: string) {
  const found = result.players[side === 'p1' ? 0 : 1].pokemon.find((p) => p.pokemon_name === name);
  if (!found) throw new Error(`no row for ${name}`);
  return found;
}

const HEADER = ['|gametype|doubles', '|player|p1|Alice|1|', '|player|p2|Bob|2|', '|gen|9'];

const FULL_BATTLE = [
  ...HEADER,
  '|poke|p1|Incineroar, L50, M|',
  '|poke|p1|Rillaboom, L50, F|',
  '|poke|p1|Amoonguss, L50, F|',
  '|poke|p1|Kingambit, L50, M|',
  '|poke|p2|Flutter Mane, L50|',
  '|poke|p2|Urshifu-*, L50, M|',
  '|poke|p2|Gholdengo, L50|',
  '|poke|p2|Landorus-Therian, L50, M|',
  '|switch|p1a: Incineroar|Incineroar, L50, M|100/100',
  '|switch|p1b: Rillaboom|Rillaboom, L50, F|100/100',
  '|switch|p2a: Flutter Mane|Flutter Mane, L50|100/100',
  '|switch|p2b: Urshifu|Urshifu-Rapid-Strike, L50, M|100/100',
  '|turn|1',
  '|move|p1a: Incineroar|Fake Out|p2b: Urshifu',
  '|-damage|p2b: Urshifu|85/100',
  '|move|p1b: Rillaboom|Grassy Glide|p2b: Urshifu',
  '|-damage|p2b: Urshifu|50/100',
  '|move|p2a: Flutter Mane|Moonblast|p1a: Incineroar',
  '|-damage|p1a: Incineroar|0 fnt',
  '|faint|p1a: Incineroar',
  '|upkeep',
  '|switch|p1a: Amoonguss|Amoonguss, L50, F|100/100',
  '|turn|2',
  '|move|p2a: Flutter Mane|Dazzling Gleam|p1a: Amoonguss|[spread] p1a,p1b',
  '|-damage|p1a: Amoonguss|40/100',
  '|-damage|p1b: Rillaboom|0 fnt',
  '|faint|p1b: Rillaboom',
  '|move|p1a: Amoonguss|Sludge Bomb|p2b: Urshifu',
  '|-damage|p2b: Urshifu|0 fnt',
  '|faint|p2b: Urshifu',
  '|upkeep',
  '|switch|p1b: Kingambit|Kingambit, L50, M|100/100',
  '|switch|p2b: Gholdengo|Gholdengo, L50|100/100',
  '|turn|3',
  '|move|p2b: Gholdengo|Make It Rain|p1a: Amoonguss|[spread] p1a,p1b',
  '|-damage|p1a: Amoonguss|0 fnt',
  '|-damage|p1b: Kingambit|60/100',
  '|faint|p1a: Amoonguss',
  '|move|p1b: Kingambit|Sucker Punch|p2a: Flutter Mane',
  '|-damage|p2a: Flutter Mane|0 fnt',
  '|faint|p2a: Flutter Mane',
  '|upkeep',
  '|win|Alice',
];

describe('doubles leads and turns active', () => {
  const result = parseReplayLog(FULL_BATTLE.join('\n'));

  it('marks all four starting Pokémon as leads, and only them', () => {
    expect(row(result, 'p1', 'Incineroar').was_lead).toBe(true);
    expect(row(result, 'p1', 'Rillaboom').was_lead).toBe(true);
    expect(row(result, 'p2', 'Flutter Mane').was_lead).toBe(true);
    expect(row(result, 'p2', 'Urshifu').was_lead).toBe(true);
    expect(row(result, 'p1', 'Amoonguss').was_lead).toBe(false);
    expect(row(result, 'p1', 'Kingambit').was_lead).toBe(false);
    expect(row(result, 'p2', 'Gholdengo').was_lead).toBe(false);
  });

  it('counts a turn for both active slots of a side, and for a replacement from the turn it is on the field', () => {
    expect(row(result, 'p1', 'Incineroar').turns_active).toBe(1);
    expect(row(result, 'p1', 'Rillaboom').turns_active).toBe(2);
    expect(row(result, 'p1', 'Amoonguss').turns_active).toBe(2);
    expect(row(result, 'p1', 'Kingambit').turns_active).toBe(1);
    expect(row(result, 'p2', 'Flutter Mane').turns_active).toBe(3);
    expect(row(result, 'p2', 'Urshifu').turns_active).toBe(2);
    expect(row(result, 'p2', 'Gholdengo').turns_active).toBe(1);
  });

  it('leaves a Pokémon that never entered the field unbrought and idle', () => {
    expect(row(result, 'p2', 'Landorus-Therian')).toMatchObject({ was_brought: false, turns_active: 0, kos_dealt: 0 });
  });

  it('deactivates only the slot that switched or was dragged, not its partner', () => {
    const log = [
      ...HEADER,
      '|switch|p1a: Incineroar|Incineroar, L50, M|100/100',
      '|switch|p1b: Rillaboom|Rillaboom, L50, F|100/100',
      '|switch|p2a: Flutter Mane|Flutter Mane, L50|100/100',
      '|switch|p2b: Urshifu|Urshifu-Rapid-Strike, L50, M|100/100',
      '|turn|1',
      '|switch|p1b: Kingambit|Kingambit, L50, M|100/100',
      '|drag|p2a: Gholdengo|Gholdengo, L50|100/100',
      '|turn|2',
      '|turn|3',
      '|win|Alice',
    ].join('\n');
    const parsed = parseReplayLog(log);
    expect(row(parsed, 'p1', 'Incineroar').turns_active).toBe(3);
    expect(row(parsed, 'p1', 'Rillaboom').turns_active).toBe(1);
    expect(row(parsed, 'p1', 'Kingambit').turns_active).toBe(2);
    expect(row(parsed, 'p2', 'Flutter Mane').turns_active).toBe(1);
    expect(row(parsed, 'p2', 'Gholdengo').turns_active).toBe(2);
    expect(row(parsed, 'p2', 'Urshifu-Rapid-Strike').turns_active).toBe(3);
  });
});

describe('doubles faints and kill credit by slot', () => {
  const result = parseReplayLog(FULL_BATTLE.join('\n'));

  it('marks the fainted slot own row as KO’d, not the partner', () => {
    expect(row(result, 'p1', 'Incineroar').was_koed).toBe(true);
    expect(row(result, 'p1', 'Rillaboom').was_koed).toBe(true);
    expect(row(result, 'p1', 'Amoonguss').was_koed).toBe(true);
    expect(row(result, 'p1', 'Kingambit').was_koed).toBe(false);
    expect(row(result, 'p2', 'Flutter Mane').was_koed).toBe(true);
    expect(row(result, 'p2', 'Urshifu').was_koed).toBe(true);
    expect(row(result, 'p2', 'Gholdengo').was_koed).toBe(false);
  });

  it('credits moves and KOs to the Pokémon in the acting slot, with one KO per spread target', () => {
    expect(row(result, 'p2', 'Flutter Mane')).toMatchObject({ kos_dealt: 2, moves_used: ['Moonblast', 'Dazzling Gleam'] });
    expect(row(result, 'p2', 'Gholdengo')).toMatchObject({ kos_dealt: 1, moves_used: ['Make It Rain'] });
    expect(row(result, 'p1', 'Amoonguss')).toMatchObject({ kos_dealt: 1, moves_used: ['Sludge Bomb'] });
    expect(row(result, 'p1', 'Kingambit')).toMatchObject({ kos_dealt: 1, moves_used: ['Sucker Punch'] });
    expect(row(result, 'p1', 'Incineroar')).toMatchObject({ kos_dealt: 0, moves_used: ['Fake Out'] });
    expect(row(result, 'p1', 'Rillaboom')).toMatchObject({ kos_dealt: 0, moves_used: ['Grassy Glide'] });
    expect(row(result, 'p2', 'Urshifu')).toMatchObject({ kos_dealt: 0, moves_used: [] });
  });

  it('credits a spread move that KOs both targets once to each', () => {
    const log = [
      ...HEADER,
      '|switch|p1a: Incineroar|Incineroar, L50, M|100/100',
      '|switch|p1b: Rillaboom|Rillaboom, L50, F|100/100',
      '|switch|p2a: Landorus|Landorus-Therian, L50, M|100/100',
      '|switch|p2b: Garchomp|Garchomp, L50, M|100/100',
      '|turn|1',
      '|move|p2b: Garchomp|Earthquake|p1a: Incineroar|[spread] p1a,p1b,p2a',
      '|-damage|p1a: Incineroar|0 fnt',
      '|-damage|p1b: Rillaboom|0 fnt',
      '|-damage|p2a: Landorus|0 fnt',
      '|faint|p1a: Incineroar',
      '|faint|p1b: Rillaboom',
      '|faint|p2a: Landorus',
      '|win|Bob',
    ].join('\n');
    const parsed = parseReplayLog(log);
    // Its own ally's KO is not a kill: only the two opposing faints count.
    expect(row(parsed, 'p2', 'Garchomp').kos_dealt).toBe(2);
    expect(row(parsed, 'p2', 'Landorus-Therian').kos_dealt).toBe(0);
    expect(row(parsed, 'p2', 'Landorus-Therian').was_koed).toBe(true);
    expect(row(parsed, 'p2', 'Garchomp').was_koed).toBe(false);
  });

  it('credits a hazard, a status and a weather KO to the second-slot Pokémon that set them', () => {
    const log = [
      ...HEADER,
      '|switch|p1a: Incineroar|Incineroar, L50, M|100/100',
      '|switch|p1b: Whimsicott|Whimsicott, L50, M|100/100',
      '|switch|p2a: Garchomp|Garchomp, L50, M|100/100',
      '|switch|p2b: Landorus|Landorus-Therian, L50, M|100/100',
      '|turn|1',
      '|move|p1b: Whimsicott|Stealth Rock|p2a: Garchomp',
      '|-sidestart|p2: Bob|move: Stealth Rock',
      '|move|p1b: Whimsicott|Will-O-Wisp|p2a: Garchomp',
      '|-status|p2a: Garchomp|brn',
      '|move|p1b: Whimsicott|Sandstorm|p1b: Whimsicott',
      '|-weather|Sandstorm',
      '|move|p1a: Incineroar|Flare Blitz|p2b: Landorus',
      '|-damage|p2b: Landorus|10/100',
      '|-damage|p2a: Garchomp|0 fnt|[from] brn',
      '|faint|p2a: Garchomp',
      '|-weather|Sandstorm|[upkeep]',
      '|-damage|p2b: Landorus|0 fnt|[from] Sandstorm',
      '|faint|p2b: Landorus',
      '|upkeep',
      '|switch|p2a: Tyranitar|Tyranitar, L50, M|100/100',
      '|-damage|p2a: Tyranitar|0 fnt|[from] Stealth Rock',
      '|faint|p2a: Tyranitar',
      '|win|Alice',
    ].join('\n');
    const parsed = parseReplayLog(log);
    expect(row(parsed, 'p1', 'Whimsicott').kos_dealt).toBe(3);
    expect(row(parsed, 'p1', 'Incineroar').kos_dealt).toBe(0);
    expect(row(parsed, 'p1', 'Whimsicott').moves_used).toEqual(['Stealth Rock', 'Will-O-Wisp', 'Sandstorm']);
    expect(row(parsed, 'p1', 'Incineroar').moves_used).toEqual(['Flare Blitz']);
  });

  it('credits recoil KOs to the last opposing Pokémon that hit the target, not to a guess', () => {
    const log = [
      ...HEADER,
      '|switch|p1a: Incineroar|Incineroar, L50, M|100/100',
      '|switch|p1b: Rillaboom|Rillaboom, L50, F|100/100',
      '|switch|p2a: Garchomp|Garchomp, L50, M|100/100',
      '|switch|p2b: Landorus|Landorus-Therian, L50, M|100/100',
      '|turn|1',
      '|move|p2a: Garchomp|Dragon Claw|p1b: Rillaboom',
      '|-damage|p1b: Rillaboom|30/100',
      '|move|p1b: Rillaboom|Wood Hammer|p2b: Landorus',
      '|-damage|p2b: Landorus|20/100',
      '|-damage|p1b: Rillaboom|0 fnt|[from] Recoil',
      '|faint|p1b: Rillaboom',
      '|win|Bob',
    ].join('\n');
    const parsed = parseReplayLog(log);
    expect(row(parsed, 'p2', 'Garchomp').kos_dealt).toBe(1);
    expect(row(parsed, 'p2', 'Landorus-Therian').kos_dealt).toBe(0);
  });
});

describe('doubles Destiny Bond, Ally Switch and unknown credit', () => {
  const FIELD = [
    ...HEADER,
    '|switch|p1a: Gengar|Gengar, L50, M|100/100',
    '|switch|p1b: Whimsicott|Whimsicott, L50, M|100/100',
    '|switch|p2a: Garchomp|Garchomp, L50, M|100/100',
    '|switch|p2b: Landorus|Landorus-Therian, L50, M|100/100',
    '|turn|1',
  ];

  it('credits a Destiny Bond KO to the Pokémon that knocked out the Destiny Bond user', () => {
    const log = [
      ...FIELD,
      '|move|p1a: Gengar|Destiny Bond|p1a: Gengar',
      '|-singlemove|p1a: Gengar|Destiny Bond',
      '|move|p2b: Landorus|Rock Slide|p1b: Whimsicott',
      '|-damage|p1b: Whimsicott|70/100',
      '|move|p2a: Garchomp|Dragon Claw|p1a: Gengar',
      '|-damage|p1a: Gengar|0 fnt',
      '|faint|p1a: Gengar',
      '|-activate|p1a: Gengar|move: Destiny Bond',
      '|faint|p2a: Garchomp',
      '|win|Bob',
    ].join('\n');
    const parsed = parseReplayLog(log);
    expect(row(parsed, 'p2', 'Garchomp')).toMatchObject({ kos_dealt: 1, was_koed: true });
    expect(row(parsed, 'p1', 'Gengar')).toMatchObject({ kos_dealt: 1, was_koed: true });
    expect(row(parsed, 'p1', 'Whimsicott').kos_dealt).toBe(0);
    expect(row(parsed, 'p2', 'Landorus-Therian')).toMatchObject({ kos_dealt: 0, was_koed: false });
  });

  it('credits the attacker from the other slot when it is the second slot that knocked out the Destiny Bond user', () => {
    const log = [
      ...FIELD,
      '|move|p1a: Gengar|Destiny Bond|p1a: Gengar',
      '|move|p2b: Landorus|Knock Off|p1a: Gengar',
      '|-damage|p1a: Gengar|0 fnt',
      '|faint|p1a: Gengar',
      '|-activate|p1a: Gengar|move: Destiny Bond',
      '|faint|p2b: Landorus',
      '|win|Bob',
    ].join('\n');
    const parsed = parseReplayLog(log);
    expect(row(parsed, 'p1', 'Gengar').kos_dealt).toBe(1);
    expect(row(parsed, 'p2', 'Landorus-Therian')).toMatchObject({ kos_dealt: 1, was_koed: true });
    expect(row(parsed, 'p2', 'Garchomp')).toMatchObject({ kos_dealt: 0, was_koed: false });
    expect(row(parsed, 'p1', 'Whimsicott').kos_dealt).toBe(0);
  });

  it('follows the Pokémon through Ally Switch, for moves and for faints', () => {
    const log = [
      ...HEADER,
      '|switch|p1a: Indeedee|Indeedee-F, L50, F|100/100',
      '|switch|p1b: Rillaboom|Rillaboom, L50, F|100/100',
      '|switch|p2a: Flutter Mane|Flutter Mane, L50|100/100',
      '|switch|p2b: Urshifu|Urshifu-Rapid-Strike, L50, M|100/100',
      '|turn|1',
      '|move|p1a: Indeedee|Ally Switch|p1a: Indeedee',
      '|swap|p1b: Indeedee|1|[from] move: Ally Switch',
      '|move|p2a: Flutter Mane|Moonblast|p1b: Indeedee',
      '|-damage|p1b: Indeedee|0 fnt',
      '|faint|p1b: Indeedee',
      '|move|p1a: Rillaboom|Grassy Glide|p2b: Urshifu',
      '|-damage|p2b: Urshifu|0 fnt',
      '|faint|p2b: Urshifu',
      '|turn|2',
      '|win|Bob',
    ].join('\n');
    const parsed = parseReplayLog(log);
    expect(row(parsed, 'p1', 'Indeedee-F')).toMatchObject({ was_koed: true, kos_dealt: 0, moves_used: ['Ally Switch'] });
    expect(row(parsed, 'p1', 'Rillaboom')).toMatchObject({
      was_koed: false,
      kos_dealt: 1,
      moves_used: ['Grassy Glide'],
      turns_active: 2,
    });
    expect(row(parsed, 'p2', 'Flutter Mane').kos_dealt).toBe(1);
  });

  it('credits nobody for an unexplained faint while two opposing Pokémon are out', () => {
    const log = [...FIELD, '|faint|p2a: Garchomp', '|win|Alice'].join('\n');
    const parsed = parseReplayLog(log);
    expect(row(parsed, 'p2', 'Garchomp').was_koed).toBe(true);
    expect(row(parsed, 'p1', 'Gengar').kos_dealt).toBe(0);
    expect(row(parsed, 'p1', 'Whimsicott').kos_dealt).toBe(0);
  });

  it('credits nobody for a Destiny Bond activation that names no killer while two opposing Pokémon are out', () => {
    const log = [...FIELD, '|-activate|p1a: Gengar|move: Destiny Bond', '|faint|p2a: Garchomp', '|win|Alice'].join('\n');
    const parsed = parseReplayLog(log);
    expect(row(parsed, 'p1', 'Gengar').kos_dealt).toBe(0);
    expect(row(parsed, 'p1', 'Whimsicott').kos_dealt).toBe(0);
  });

  it('still credits the only opposing Pokémon left when nothing else identifies the source', () => {
    const log = [
      ...FIELD,
      '|move|p2a: Garchomp|Dragon Claw|p1b: Whimsicott',
      '|-damage|p1b: Whimsicott|0 fnt',
      '|faint|p1b: Whimsicott',
      '|upkeep',
      '|faint|p2a: Garchomp',
      '|win|Alice',
    ].join('\n');
    const parsed = parseReplayLog(log);
    expect(row(parsed, 'p1', 'Gengar').kos_dealt).toBe(1);
    expect(row(parsed, 'p1', 'Whimsicott').kos_dealt).toBe(0);
  });
});

describe('doubles detection', () => {
  const ILLUSION_LOG = (gametype: string | null) => [
    ...(gametype ? [`|gametype|${gametype}`] : []),
    '|poke|p2|Zoroark, M|',
    '|poke|p2|Lycanroc, M|',
    '|switch|p1a: Alpha|Alpha|100/100',
    '|switch|p2a: Howler|Lycanroc, M|100/100',
    '|turn|1',
    '|move|p2a: Howler|Bitter Malice|p1a: Alpha',
    '|-damage|p1a: Alpha|50/100',
    '|replace|p2a: Masque|Zoroark, M',
    '|-end|p2a: Masque|Illusion',
    '|win|Bob',
  ].join('\n');

  it('splits an Illusion window in a battle that is singles', () => {
    for (const gametype of ['singles', null]) {
      const zoroark = parseReplayLog(ILLUSION_LOG(gametype)).players[1].pokemon.find((p) => p.pokemon_name === 'Zoroark');
      expect(zoroark).toMatchObject({ was_brought: true, moves_used: ['Bitter Malice'] });
    }
  });

  it.each(['doubles', 'triples', 'multi', 'freeforall'])(
    'treats |gametype|%s as multi-slot even when every switch is in the a slot',
    (gametype) => {
      const zoroark = parseReplayLog(ILLUSION_LOG(gametype)).players[1].pokemon.find((p) => p.pokemon_name === 'Zoroark');
      expect(zoroark?.was_brought ?? false).toBe(false);
    },
  );

  it('falls back to the slot letter when the log has no |gametype| line', () => {
    const log = [
      '|poke|p2|Zoroark, M|',
      '|poke|p2|Lycanroc, M|',
      '|switch|p1a: Alpha|Alpha|100/100',
      '|switch|p1b: Gamma|Gamma|100/100',
      '|switch|p2a: Howler|Lycanroc, M|100/100',
      '|turn|1',
      '|replace|p2a: Masque|Zoroark, M',
      '|win|Bob',
    ].join('\n');
    const zoroark = parseReplayLog(log).players[1].pokemon.find((p) => p.pokemon_name === 'Zoroark');
    expect(zoroark?.was_brought ?? false).toBe(false);
  });
});
