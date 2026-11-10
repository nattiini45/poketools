/**
 * The Pokémon the visual seed writes: one Gen 9 OU team per seeded trainer and the Evolution Point Buy lines of the
 * seeded EvoLiga list. Plain data, deterministic, no imports beyond types.
 */
import type { PokemonSet, StatSpread } from '@/types/team';
import type { PriceGroup } from '@/types/point-buy';

type SetRow = readonly [species: string, item: string, ability: string, nature: string, tera: string, moves: readonly string[]];

const IVS: StatSpread = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const PHYSICAL: StatSpread = { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 };
const SPECIAL: StatSpread = { hp: 4, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 };
const BULKY: StatSpread = { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 };

const SPECIAL_NATURES = new Set(['Timid', 'Modest']);
const BULKY_NATURES = new Set(['Bold', 'Impish', 'Careful', 'Calm', 'Relaxed', 'Sassy']);

function toSet([species, item, ability, nature, tera, moves]: SetRow): PokemonSet {
  const evs = SPECIAL_NATURES.has(nature) ? SPECIAL : BULKY_NATURES.has(nature) ? BULKY : PHYSICAL;
  return { name: '', species, gender: '', item, ability, evs, ivs: IVS, nature, level: 100, moves: [...moves], tera_type: tera };
}

/** One six-Pokémon team per trainer key of `VISUAL_SEED_IDS` (`playerAria` … `playerHugo`). */
export const VISUAL_SEED_TEAMS: Readonly<Record<string, readonly PokemonSet[]>> = {
  playerAria: ([
    ['Great Tusk', 'Booster Energy', 'Protosynthesis', 'Jolly', 'Ground', ['Headlong Rush', 'Close Combat', 'Ice Spinner', 'Rapid Spin']],
    ['Gholdengo', 'Choice Scarf', 'Good as Gold', 'Timid', 'Steel', ['Make It Rain', 'Shadow Ball', 'Trick', 'Focus Blast']],
    ['Kingambit', 'Leftovers', 'Supreme Overlord', 'Adamant', 'Dark', ['Kowtow Cleave', 'Sucker Punch', 'Iron Head', 'Swords Dance']],
    ['Dragonite', 'Heavy-Duty Boots', 'Multiscale', 'Adamant', 'Normal', ['Extreme Speed', 'Dragon Dance', 'Earthquake', 'Roost']],
    ['Iron Valiant', 'Booster Energy', 'Quark Drive', 'Timid', 'Fairy', ['Moonblast', 'Psyshock', 'Calm Mind', 'Encore']],
    ['Corviknight', 'Leftovers', 'Pressure', 'Impish', 'Dragon', ['Brave Bird', 'Defog', 'U-turn', 'Roost']],
  ] satisfies SetRow[]).map(toSet),
  playerBram: ([
    ['Garchomp', 'Rocky Helmet', 'Rough Skin', 'Jolly', 'Steel', ['Earthquake', 'Dragon Tail', 'Stealth Rock', 'Spikes']],
    ['Rotom-Wash', 'Leftovers', 'Levitate', 'Bold', 'Water', ['Hydro Pump', 'Volt Switch', 'Will-O-Wisp', 'Pain Split']],
    ['Ting-Lu', 'Leftovers', 'Vessel of Ruin', 'Careful', 'Poison', ['Earthquake', 'Ruination', 'Whirlwind', 'Spikes']],
    ['Iron Moth', 'Booster Energy', 'Quark Drive', 'Timid', 'Grass', ['Fiery Dance', 'Sludge Wave', 'Energy Ball', 'U-turn']],
    ['Toxapex', 'Black Sludge', 'Regenerator', 'Bold', 'Fairy', ['Surf', 'Toxic', 'Haze', 'Recover']],
    ['Zamazenta', 'Leftovers', 'Dauntless Shield', 'Jolly', 'Fire', ['Body Press', 'Crunch', 'Iron Defense', 'Stone Edge']],
  ] satisfies SetRow[]).map(toSet),
  playerCleo: ([
    ['Gliscor', 'Toxic Orb', 'Poison Heal', 'Impish', 'Water', ['Earthquake', 'Knock Off', 'Toxic', 'Protect']],
    ['Dragapult', 'Choice Specs', 'Infiltrator', 'Timid', 'Ghost', ['Draco Meteor', 'Shadow Ball', 'Flamethrower', 'U-turn']],
    ['Heatran', 'Air Balloon', 'Flash Fire', 'Calm', 'Grass', ['Magma Storm', 'Earth Power', 'Taunt', 'Stealth Rock']],
    ['Clefable', 'Leftovers', 'Magic Guard', 'Bold', 'Steel', ['Moonblast', 'Knock Off', 'Calm Mind', 'Moonlight']],
    ['Samurott-Hisui', 'Focus Sash', 'Sharpness', 'Jolly', 'Dark', ['Ceaseless Edge', 'Razor Shell', 'Sucker Punch', 'Aqua Jet']],
    ['Ogerpon-Wellspring', 'Wellspring Mask', 'Water Absorb', 'Jolly', 'Water', ['Ivy Cudgel', 'Horn Leech', 'Swords Dance', 'Spiky Shield']],
  ] satisfies SetRow[]).map(toSet),
  playerDario: ([
    ['Landorus-Therian', 'Rocky Helmet', 'Intimidate', 'Impish', 'Water', ['Earthquake', 'U-turn', 'Stealth Rock', 'Taunt']],
    ['Volcarona', 'Heavy-Duty Boots', 'Flame Body', 'Timid', 'Grass', ['Fiery Dance', 'Giga Drain', 'Quiver Dance', 'Morning Sun']],
    ['Slowking-Galar', 'Heavy-Duty Boots', 'Regenerator', 'Sassy', 'Water', ['Sludge Bomb', 'Future Sight', 'Chilly Reception', 'Slack Off']],
    ['Iron Treads', 'Booster Energy', 'Quark Drive', 'Jolly', 'Ground', ['Earthquake', 'Knock Off', 'Rapid Spin', 'Stealth Rock']],
    ['Roaring Moon', 'Booster Energy', 'Protosynthesis', 'Jolly', 'Flying', ['Acrobatics', 'Knock Off', 'Earthquake', 'Dragon Dance']],
    ['Meowscarada', 'Choice Band', 'Protean', 'Jolly', 'Grass', ['Flower Trick', 'Knock Off', 'U-turn', 'Triple Axel']],
  ] satisfies SetRow[]).map(toSet),
  playerElin: ([
    ['Raging Bolt', 'Booster Energy', 'Protosynthesis', 'Modest', 'Fairy', ['Thunderclap', 'Draco Meteor', 'Thunderbolt', 'Calm Mind']],
    ['Cinderace', 'Heavy-Duty Boots', 'Libero', 'Jolly', 'Fire', ['Pyro Ball', 'U-turn', 'Court Change', 'Sucker Punch']],
    ['Skarmory', 'Rocky Helmet', 'Sturdy', 'Impish', 'Dragon', ['Body Press', 'Spikes', 'Whirlwind', 'Roost']],
    ['Primarina', 'Leftovers', 'Torrent', 'Calm', 'Water', ['Moonblast', 'Surf', 'Calm Mind', 'Draining Kiss']],
    ['Ursaluna', 'Flame Orb', 'Guts', 'Adamant', 'Ghost', ['Facade', 'Headlong Rush', 'Fire Punch', 'Swords Dance']],
    ['Hatterene', 'Leftovers', 'Magic Bounce', 'Calm', 'Water', ['Draining Kiss', 'Psychic Noise', 'Calm Mind', 'Mystical Fire']],
  ] satisfies SetRow[]).map(toSet),
  playerFinn: ([
    ['Tyranitar', 'Leftovers', 'Sand Stream', 'Careful', 'Ghost', ['Stone Edge', 'Knock Off', 'Stealth Rock', 'Thunder Wave']],
    ['Excadrill', 'Air Balloon', 'Sand Rush', 'Adamant', 'Ground', ['High Horsepower', 'Iron Head', 'Rapid Spin', 'Swords Dance']],
    ['Pelipper', 'Damp Rock', 'Drizzle', 'Bold', 'Ground', ['Hurricane', 'Surf', 'U-turn', 'Roost']],
    ['Barraskewda', 'Choice Band', 'Swift Swim', 'Adamant', 'Water', ['Liquidation', 'Flip Turn', 'Close Combat', 'Psychic Fangs']],
    ['Serperior', 'Leftovers', 'Contrary', 'Timid', 'Fire', ['Leaf Storm', 'Glare', 'Substitute', 'Tera Blast']],
    ['Weavile', 'Heavy-Duty Boots', 'Pressure', 'Jolly', 'Ice', ['Triple Axel', 'Knock Off', 'Ice Shard', 'Swords Dance']],
  ] satisfies SetRow[]).map(toSet),
  playerGreta: ([
    ['Darkrai', 'Life Orb', 'Bad Dreams', 'Timid', 'Poison', ['Dark Pulse', 'Sludge Bomb', 'Focus Blast', 'Nasty Plot']],
    ['Zapdos', 'Heavy-Duty Boots', 'Static', 'Bold', 'Water', ['Volt Switch', 'Hurricane', 'Roost', 'Discharge']],
    ['Alomomola', 'Rocky Helmet', 'Regenerator', 'Relaxed', 'Fairy', ['Scald', 'Flip Turn', 'Wish', 'Protect']],
    ['Enamorus', 'Choice Scarf', 'Contrary', 'Timid', 'Fairy', ['Moonblast', 'Earth Power', 'Mystical Fire', 'Healing Wish']],
    ['Iron Crown', 'Booster Energy', 'Quark Drive', 'Timid', 'Fighting', ['Tachyon Cutter', 'Psyshock', 'Focus Blast', 'Calm Mind']],
    ['Hippowdon', 'Leftovers', 'Sand Stream', 'Impish', 'Dragon', ['Earthquake', 'Stealth Rock', 'Whirlwind', 'Slack Off']],
  ] satisfies SetRow[]).map(toSet),
  playerHugo: ([
    ['Gouging Fire', 'Heavy-Duty Boots', 'Protosynthesis', 'Adamant', 'Fairy', ['Flare Blitz', 'Dragon Claw', 'Dragon Dance', 'Morning Sun']],
    ['Scizor', 'Choice Band', 'Technician', 'Adamant', 'Steel', ['Bullet Punch', 'U-turn', 'Close Combat', 'Knock Off']],
    ['Amoonguss', 'Black Sludge', 'Regenerator', 'Calm', 'Water', ['Spore', 'Giga Drain', 'Sludge Bomb', 'Clear Smog']],
    ['Sinistcha', 'Leftovers', 'Hospitality', 'Bold', 'Poison', ['Matcha Gotcha', 'Shadow Ball', 'Calm Mind', 'Strength Sap']],
    ['Walking Wake', 'Choice Specs', 'Protosynthesis', 'Timid', 'Water', ['Hydro Steam', 'Draco Meteor', 'Flamethrower', 'Flip Turn']],
    ['Cresselia', 'Leftovers', 'Levitate', 'Bold', 'Fairy', ['Moonblast', 'Lunar Blessing', 'Moonlight', 'Calm Mind']],
  ] satisfies SetRow[]).map(toSet),
};

/** An opponent team for the solo Cast Studio session (a ladder opponent without a player row). */
export const VISUAL_SEED_SOLO_OPPONENT: readonly PokemonSet[] = ([
  ['Ting-Lu', 'Leftovers', 'Vessel of Ruin', 'Careful', 'Poison', ['Earthquake', 'Ruination', 'Whirlwind', 'Spikes']],
  ['Iron Valiant', 'Booster Energy', 'Quark Drive', 'Timid', 'Fairy', ['Moonblast', 'Psyshock', 'Calm Mind', 'Encore']],
  ['Dragapult', 'Choice Specs', 'Infiltrator', 'Timid', 'Ghost', ['Draco Meteor', 'Shadow Ball', 'Flamethrower', 'U-turn']],
  ['Corviknight', 'Leftovers', 'Pressure', 'Impish', 'Dragon', ['Brave Bird', 'Defog', 'U-turn', 'Roost']],
  ['Kingambit', 'Leftovers', 'Supreme Overlord', 'Adamant', 'Dark', ['Kowtow Cleave', 'Sucker Punch', 'Iron Head', 'Swords Dance']],
  ['Volcarona', 'Heavy-Duty Boots', 'Flame Body', 'Timid', 'Grass', ['Fiery Dance', 'Giga Drain', 'Quiver Dance', 'Morning Sun']],
] satisfies SetRow[]).map(toSet);

export interface VisualSeedLine {
  line_number: number;
  base_pokemon: string;
  stage2_pokemon: string;
  stage3_pokemon: string | null;
  price: number;
  price_group: PriceGroup;
  kills_to_stage2: number;
  additional_kills_to_stage3: number | null;
  moves: readonly string[];
}

/** The EvoLiga list: three lines per EPB trainer, in draft order (trainer 1 gets lines 1-3, and so on). */
export const VISUAL_SEED_EPB_LINES: readonly VisualSeedLine[] = [
  { line_number: 1, base_pokemon: 'Dratini', stage2_pokemon: 'Dragonair', stage3_pokemon: 'Dragonite', price: 22, price_group: 'premium', kills_to_stage2: 5, additional_kills_to_stage3: 5, moves: ['Extreme Speed', 'Dragon Dance', 'Fire Punch', 'Roost'] },
  { line_number: 2, base_pokemon: 'Riolu', stage2_pokemon: 'Lucario', stage3_pokemon: null, price: 12, price_group: 'mittel', kills_to_stage2: 3, additional_kills_to_stage3: null, moves: ['Close Combat', 'Extreme Speed', 'Meteor Mash', 'Swords Dance'] },
  { line_number: 3, base_pokemon: 'Rookidee', stage2_pokemon: 'Corvisquire', stage3_pokemon: 'Corviknight', price: 8, price_group: 'guenstig', kills_to_stage2: 2, additional_kills_to_stage3: 3, moves: ['Brave Bird', 'U-turn', 'Defog', 'Roost'] },
  { line_number: 4, base_pokemon: 'Larvitar', stage2_pokemon: 'Pupitar', stage3_pokemon: 'Tyranitar', price: 20, price_group: 'premium', kills_to_stage2: 3, additional_kills_to_stage3: 4, moves: ['Stone Edge', 'Crunch', 'Earthquake', 'Dragon Dance'] },
  { line_number: 5, base_pokemon: 'Froakie', stage2_pokemon: 'Frogadier', stage3_pokemon: 'Greninja', price: 16, price_group: 'hoch', kills_to_stage2: 2, additional_kills_to_stage3: 3, moves: ['Hydro Pump', 'Dark Pulse', 'Ice Beam', 'U-turn'] },
  { line_number: 6, base_pokemon: 'Tinkatink', stage2_pokemon: 'Tinkatuff', stage3_pokemon: 'Tinkaton', price: 7, price_group: 'guenstig', kills_to_stage2: 2, additional_kills_to_stage3: 2, moves: ['Gigaton Hammer', 'Play Rough', 'Knock Off', 'Stealth Rock'] },
  { line_number: 7, base_pokemon: 'Gible', stage2_pokemon: 'Gabite', stage3_pokemon: 'Garchomp', price: 21, price_group: 'premium', kills_to_stage2: 3, additional_kills_to_stage3: 4, moves: ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'] },
  { line_number: 8, base_pokemon: 'Axew', stage2_pokemon: 'Fraxure', stage3_pokemon: 'Haxorus', price: 13, price_group: 'mittel', kills_to_stage2: 2, additional_kills_to_stage3: 3, moves: ['Outrage', 'Earthquake', 'Poison Jab', 'Dragon Dance'] },
  { line_number: 9, base_pokemon: 'Fletchling', stage2_pokemon: 'Fletchinder', stage3_pokemon: 'Talonflame', price: 5, price_group: 'budget', kills_to_stage2: 1, additional_kills_to_stage3: 2, moves: ['Brave Bird', 'Flare Blitz', 'U-turn', 'Roost'] },
  { line_number: 10, base_pokemon: 'Beldum', stage2_pokemon: 'Metang', stage3_pokemon: 'Metagross', price: 19, price_group: 'hoch', kills_to_stage2: 3, additional_kills_to_stage3: 3, moves: ['Meteor Mash', 'Zen Headbutt', 'Earthquake', 'Bullet Punch'] },
  { line_number: 11, base_pokemon: 'Frigibax', stage2_pokemon: 'Arctibax', stage3_pokemon: 'Baxcalibur', price: 14, price_group: 'mittel', kills_to_stage2: 3, additional_kills_to_stage3: 3, moves: ['Glaive Rush', 'Icicle Crash', 'Earthquake', 'Ice Shard'] },
  { line_number: 12, base_pokemon: 'Pawniard', stage2_pokemon: 'Bisharp', stage3_pokemon: 'Kingambit', price: 9, price_group: 'guenstig', kills_to_stage2: 2, additional_kills_to_stage3: 3, moves: ['Kowtow Cleave', 'Sucker Punch', 'Iron Head', 'Swords Dance'] },
];

/**
 * Progress of each line's tracker on the legacy EPB draft board, by `line_number` of `VISUAL_SEED_EPB_LINES`: every
 * stage, a bar in each colour band (below 50 %, from 50 %, from 80 %), every progress source and the final form.
 * The total progress (`total_kos`) is the sum of the sources.
 */
export const VISUAL_SEED_EPB_BOARD_PROGRESS: Readonly<
  Record<number, { stage: 1 | 2 | 3; real_kills: number; draft_tokens: number; kill_tokens: number; cosmo_points: number }>
> = {
  1: { stage: 1, real_kills: 3, draft_tokens: 0, kill_tokens: 0, cosmo_points: 0 },
  2: { stage: 2, real_kills: 3, draft_tokens: 1, kill_tokens: 0, cosmo_points: 0 },
  3: { stage: 2, real_kills: 2, draft_tokens: 0, kill_tokens: 2, cosmo_points: 0 },
  4: { stage: 1, real_kills: 1, draft_tokens: 0, kill_tokens: 0, cosmo_points: 0 },
  5: { stage: 3, real_kills: 4, draft_tokens: 0, kill_tokens: 0, cosmo_points: 1 },
  6: { stage: 1, real_kills: 1, draft_tokens: 0, kill_tokens: 0, cosmo_points: 0 },
  7: { stage: 2, real_kills: 3, draft_tokens: 1, kill_tokens: 0, cosmo_points: 0 },
  8: { stage: 1, real_kills: 0, draft_tokens: 0, kill_tokens: 1, cosmo_points: 0 },
  9: { stage: 3, real_kills: 3, draft_tokens: 0, kill_tokens: 0, cosmo_points: 0 },
  10: { stage: 1, real_kills: 2, draft_tokens: 0, kill_tokens: 0, cosmo_points: 0 },
  11: { stage: 1, real_kills: 0, draft_tokens: 0, kill_tokens: 0, cosmo_points: 0 },
  12: { stage: 2, real_kills: 2, draft_tokens: 0, kill_tokens: 0, cosmo_points: 2 },
};

/** The draft league's picks, in pick order (the snake order decides who makes each one). */
export const VISUAL_SEED_DRAFT_PICKS: readonly string[] = [
  'Great Tusk', 'Gholdengo', 'Kingambit', 'Dragapult', 'Garchomp', 'Iron Valiant', 'Raging Bolt', 'Gliscor',
  'Corviknight', 'Heatran', 'Zamazenta', 'Darkrai', 'Primarina', 'Volcarona',
];
