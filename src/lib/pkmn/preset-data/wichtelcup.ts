/**
 * A NEUTRAL Secret Santa cup example, with made-up pools. The real community tournament's pools, exact levels and
 * surprise phase are NOT public: a maintainer build ships them through the private pack's `formatPresets` and
 * `rulesetPresetOverrides` (docs/format-packs.md, "Pack extensions"), which replace this example on the admin-only
 * preset surfaces and override the `gen9natdexwichtelcup` rule preset. This file only demonstrates the mechanic with a
 * small fictional field, so a public checkout has a working example and the public tests have data to run against.
 *
 * IDs are resolved and integrity-tested against the installed National Dex data like the other authored preset tables.
 */
import type { RuleNames } from './standard';

export const WICHTELCUP_NORMAL = [
  'Pikachu', 'Charizard', 'Blastoise', 'Venusaur', 'Eevee', 'Snorlax', 'Machamp', 'Gengar',
] as const;

export const WICHTELCUP_JUNK = [
  'Starmie', 'Golem', 'Blissey', 'Clefable', 'Ninetales', 'Alakazam',
] as const;

export const WICHTELCUP_PREMIUM = [
  'Dragonite', 'Tyranitar', 'Salamence', 'Metagross', 'Garchomp', 'Hydreigon',
] as const;

export const WICHTELCUP_NEW_YEAR = [
  'Mewtwo', 'Mew', 'Lugia',
] as const;

export const WICHTELCUP_SPECIES = [
  ...WICHTELCUP_NORMAL, ...WICHTELCUP_JUNK, ...WICHTELCUP_PREMIUM, ...WICHTELCUP_NEW_YEAR,
] as const;

/** The example admits no extra formes beyond its pool entries; a pack may admit formes of an unpinned entry. */
export const WICHTELCUP_ENTRY_FORMES = [] as const;

/** The exact-id allowlist of the rule preset: every pool entry plus the formes an unpinned entry admits. */
export const WICHTELCUP_ALLOWED = [...WICHTELCUP_SPECIES, ...WICHTELCUP_ENTRY_FORMES] as const;

const Z_CRYSTALS_AND_MEGA_STONES = [
  'Abomasite', 'Absolite', 'Absolite Z', 'Aerodactylite', 'Aggronite', 'Alakazite', 'Aloraichium Z',
  'Altarianite', 'Ampharosite', 'Audinite', 'Banettite', 'Barbaracite', 'Baxcalibrite', 'Beedrillite',
  'Blastoisinite', 'Blazikenite', 'Buginium Z', 'Cameruptite', 'Chandelurite', 'Charizardite X',
  'Charizardite Y', 'Chesnaughtite', 'Chimechite', 'Clefablite', 'Crabominite', 'Crucibellite', 'Darkinium Z',
  'Darkranite', 'Decidium Z', 'Delphoxite', 'Diancite', 'Dragalgite', 'Dragoninite', 'Dragonium Z', 'Drampanite',
  'Eelektrossite', 'Eevium Z', 'Electrium Z', 'Emboarite', 'Excadrite', 'Fairium Z', 'Falinksite', 'Feraligite',
  'Fightinium Z', 'Firium Z', 'Floettite', 'Flyinium Z', 'Froslassite', 'Galladite', 'Garchompite',
  'Garchompite Z', 'Gardevoirite', 'Gengarite', 'Ghostium Z', 'Glalitite', 'Glimmoranite', 'Golisopite',
  'Golurkite', 'Grassium Z', 'Greninjite', 'Groundium Z', 'Gyaradosite', 'Hawluchanite', 'Heatranite',
  'Heracronite', 'Houndoominite', 'Icium Z', 'Incinium Z', 'Kangaskhanite', 'Kommonium Z', 'Latiasite',
  'Latiosite', 'Lopunnite', 'Lucarionite', 'Lucarionite Z', 'Lunalium Z', 'Lycanium Z', 'Magearnite',
  'Malamarite', 'Manectite', 'Marshadium Z', 'Mawilite', 'Medichamite', 'Meganiumite', 'Meowsticite',
  'Metagrossite', 'Mewnium Z', 'Mewtwonite X', 'Mewtwonite Y', 'Mimikium Z', 'Normalium Z', 'Pidgeotite',
  'Pikanium Z', 'Pikashunium Z', 'Pinsirite', 'Poisonium Z', 'Primarium Z', 'Psychium Z', 'Pyroarite',
  'Raichunite X', 'Raichunite Y', 'Rockium Z', 'Sablenite', 'Salamencite', 'Sceptilite', 'Scizorite',
  'Scolipite', 'Scovillainite', 'Scraftinite', 'Sharpedonite', 'Skarmorite', 'Slowbronite', 'Snorlium Z',
  'Solganium Z', 'Staraptite', 'Starminite', 'Steelium Z', 'Steelixite', 'Swampertite', 'Tapunium Z',
  'Tatsugirinite', 'Tyranitarite', 'Ultranecrozium Z', 'Venusaurite', 'Victreebelite', 'Waterium Z',
  'Zeraorite', 'Zygardite',
] as const;

/**
 * The example's bans are the mechanic's bans, not a community tuning: Light Clay, Moody and Snow Cloak, and no Mega
 * Evolution or Z-Moves (the stones and crystals). A pack overrides the resolved rules with its own allowlist and bans.
 */
export const WICHTELCUP_BANS: RuleNames = {
  pokemon: [],
  moves: [],
  items: ['Light Clay', ...Z_CRYSTALS_AND_MEGA_STONES],
  abilities: ['Moody', 'Snow Cloak'],
};

/** The six primary roles of the junk-gift pool. */
export type WichtelcupRole = 'hazard_removal' | 'hazard_setter' | 'wall_stall' | 'support' | 'weather_setter' | 'attacker';

/**
 * The primary role of every junk-gift species of the example (one per species). Only the primary role is binding: a
 * giver picks two junk gifts with different primary roles. Keyed by the same display names as `WICHTELCUP_JUNK`, so a
 * species missing here is a compile error.
 */
export const WICHTELCUP_JUNK_ROLES: Readonly<Record<(typeof WICHTELCUP_JUNK)[number], WichtelcupRole>> = {
  Starmie: 'hazard_removal',
  Golem: 'hazard_setter',
  Blissey: 'wall_stall',
  Clefable: 'support',
  Ninetales: 'weather_setter',
  Alakazam: 'attacker',
};
