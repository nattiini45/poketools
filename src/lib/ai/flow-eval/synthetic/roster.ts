/**
 * The synthetic Pokémon pool of the AI flow eval fixtures: public game data only (species, moves,
 * items, abilities), arranged into hand-authored sets. Nothing here comes from a real player or league.
 */

import type { PokemonSet } from '@/types/team';

/** A small seeded generator (mulberry32), so every rebuild of the fixtures is byte-identical. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Spread = 'PA' | 'SA' | 'PB' | 'SB';

const SPREADS: Record<Spread, PokemonSet['evs']> = {
  PA: { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 },
  SA: { hp: 4, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 },
  PB: { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 },
  SB: { hp: 252, atk: 0, def: 4, spa: 0, spd: 252, spe: 0 },
};

const FULL_IVS: PokemonSet['ivs'] = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

type Row = [species: string, item: string, ability: string, nature: string, tera: string, moves: string, spread: Spread];

// species | item | ability | nature | tera | moves | spread
const ROWS: Row[] = [
  ['Great Tusk', 'Booster Energy', 'Protosynthesis', 'Jolly', 'Steel', 'Headlong Rush, Close Combat, Rapid Spin, Knock Off', 'PA'],
  ['Gholdengo', 'Air Balloon', 'Good as Gold', 'Timid', 'Fairy', 'Make It Rain, Shadow Ball, Nasty Plot, Recover', 'SA'],
  ['Kingambit', 'Leftovers', 'Supreme Overlord', 'Adamant', 'Dark', 'Kowtow Cleave, Sucker Punch, Iron Head, Swords Dance', 'PA'],
  ['Dragapult', 'Choice Specs', 'Infiltrator', 'Timid', 'Ghost', 'Draco Meteor, Shadow Ball, U-turn, Flamethrower', 'SA'],
  ['Garchomp', 'Rocky Helmet', 'Rough Skin', 'Jolly', 'Steel', 'Earthquake, Dragon Tail, Stealth Rock, Swords Dance', 'PA'],
  ['Corviknight', 'Leftovers', 'Pressure', 'Impish', 'Dragon', 'Brave Bird, Body Press, Defog, Roost', 'PB'],
  ['Toxapex', 'Black Sludge', 'Regenerator', 'Bold', 'Steel', 'Scald, Toxic, Recover, Haze', 'PB'],
  ['Ferrothorn', 'Leftovers', 'Iron Barbs', 'Relaxed', 'Water', 'Spikes, Leech Seed, Power Whip, Knock Off', 'PB'],
  ['Heatran', 'Leftovers', 'Flash Fire', 'Calm', 'Grass', 'Magma Storm, Earth Power, Stealth Rock, Taunt', 'SB'],
  ['Rillaboom', 'Choice Band', 'Grassy Surge', 'Adamant', 'Fire', 'Grassy Glide, Wood Hammer, Knock Off, U-turn', 'PA'],
  ['Iron Valiant', 'Booster Energy', 'Quark Drive', 'Naive', 'Fighting', 'Spirit Break, Close Combat, Knock Off, Swords Dance', 'PA'],
  ['Slowking-Galar', 'Heavy-Duty Boots', 'Regenerator', 'Bold', 'Water', 'Sludge Bomb, Future Sight, Chilly Reception, Slack Off', 'SB'],
  ['Landorus-Therian', 'Rocky Helmet', 'Intimidate', 'Impish', 'Flying', 'Earthquake, U-turn, Stealth Rock, Taunt', 'PB'],
  ['Clefable', 'Leftovers', 'Magic Guard', 'Bold', 'Steel', 'Moonblast, Soft-Boiled, Stealth Rock, Flamethrower', 'PB'],
  ['Skeledirge', 'Heavy-Duty Boots', 'Unaware', 'Bold', 'Water', 'Torch Song, Slack Off, Hex, Will-O-Wisp', 'SB'],
  ['Gliscor', 'Toxic Orb', 'Poison Heal', 'Impish', 'Water', 'Earthquake, Knock Off, Protect, Toxic', 'PB'],
  ['Dragonite', 'Heavy-Duty Boots', 'Multiscale', 'Adamant', 'Normal', 'Extreme Speed, Dragon Dance, Earthquake, Roost', 'PA'],
  ['Weavile', 'Choice Band', 'Pressure', 'Jolly', 'Dark', 'Triple Axel, Knock Off, Ice Shard, Low Kick', 'PA'],
  ['Rotom-Wash', 'Leftovers', 'Levitate', 'Bold', 'Fairy', 'Hydro Pump, Volt Switch, Will-O-Wisp, Pain Split', 'SB'],
  ['Primarina', 'Throat Spray', 'Liquid Voice', 'Modest', 'Fairy', 'Hyper Voice, Moonblast, Psychic, Calm Mind', 'SA'],
  ['Hatterene', 'Leftovers', 'Magic Bounce', 'Bold', 'Steel', 'Psychic, Dazzling Gleam, Mystical Fire, Calm Mind', 'SB'],
  ['Annihilape', 'Leftovers', 'Defiant', 'Jolly', 'Water', 'Bulk Up, Rage Fist, Drain Punch, Taunt', 'PA'],
  ['Scizor', 'Choice Band', 'Technician', 'Adamant', 'Steel', 'Bullet Punch, U-turn, Knock Off, Close Combat', 'PA'],
  ['Gyarados', 'Heavy-Duty Boots', 'Intimidate', 'Adamant', 'Ground', 'Waterfall, Dragon Dance, Earthquake, Taunt', 'PA'],
  ['Pelipper', 'Damp Rock', 'Drizzle', 'Bold', 'Water', 'Scald, Hurricane, U-turn, Roost', 'SB'],
  ['Dondozo', 'Leftovers', 'Unaware', 'Impish', 'Water', 'Wave Crash, Curse, Rest, Sleep Talk', 'PB'],
  ['Ceruledge', 'Life Orb', 'Weak Armor', 'Adamant', 'Ghost', 'Bitter Blade, Shadow Sneak, Swords Dance, Poltergeist', 'PA'],
  ['Torkoal', 'Heat Rock', 'Drought', 'Bold', 'Fire', 'Lava Plume, Stealth Rock, Rapid Spin, Yawn', 'SB'],
  ['Volcarona', 'Heavy-Duty Boots', 'Flame Body', 'Timid', 'Water', 'Quiver Dance, Fiery Dance, Bug Buzz, Giga Drain', 'SA'],
  ['Talonflame', 'Heavy-Duty Boots', 'Gale Wings', 'Jolly', 'Fire', 'Brave Bird, Flare Blitz, Swords Dance, Roost', 'PA'],
  ['Excadrill', 'Leftovers', 'Sand Rush', 'Jolly', 'Water', 'Earthquake, Iron Head, Rapid Spin, Swords Dance', 'PA'],
  ['Hippowdon', 'Leftovers', 'Sand Stream', 'Impish', 'Water', 'Earthquake, Slack Off, Stealth Rock, Yawn', 'PB'],
];

function toSet([species, item, ability, nature, tera, moves, spread]: Row): PokemonSet {
  return {
    name: '',
    species,
    gender: '',
    item,
    ability,
    evs: { ...SPREADS[spread] },
    ivs: { ...FULL_IVS },
    nature,
    level: 100,
    moves: moves.split(', '),
    tera_type: tera,
  };
}

const POOL = new Map<string, PokemonSet>(ROWS.map((row) => [row[0], toSet(row)]));

/** The set of `species` from the pool; throws on a typo so a fixture cannot silently lose a Pokémon. */
export function setOf(species: string): PokemonSet {
  const found = POOL.get(species);
  if (!found) throw new Error(`synthetic roster has no set for ${species}`);
  return structuredClone(found);
}

export function teamOf(species: readonly string[]): PokemonSet[] {
  return species.map(setOf);
}

export function allSpecies(): string[] {
  return [...POOL.keys()];
}

/** Moves that do no direct damage, by what they do (everything else is an attack). */
export const MOVE_KIND: Record<string, 'hazard' | 'boost' | 'recover' | 'status'> = {
  'Stealth Rock': 'hazard',
  Spikes: 'hazard',
  'Swords Dance': 'boost',
  'Dragon Dance': 'boost',
  'Nasty Plot': 'boost',
  'Calm Mind': 'boost',
  'Quiver Dance': 'boost',
  'Bulk Up': 'boost',
  Curse: 'boost',
  Recover: 'recover',
  Roost: 'recover',
  'Slack Off': 'recover',
  'Soft-Boiled': 'recover',
  'Pain Split': 'recover',
  Rest: 'recover',
  Toxic: 'status',
  'Will-O-Wisp': 'status',
  Haze: 'status',
  Taunt: 'status',
  Defog: 'status',
  'Leech Seed': 'status',
  'Chilly Reception': 'status',
  Yawn: 'status',
  Protect: 'status',
  'Sleep Talk': 'status',
};

/** Weather set on switch-in by ability: PS weather id. */
export const WEATHER_ABILITY: Record<string, string> = {
  Drizzle: 'RainDance',
  Drought: 'SunnyDay',
  'Sand Stream': 'Sandstorm',
};
