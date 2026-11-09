/**
 * Wichtelcup 2026 community rules, transcribed from the approved tournament specification.
 * IDs are resolved and integrity-tested against the installed National Dex data like the other authored preset tables.
 */
import type { RuleNames } from './standard';

export const WICHTELCUP_NORMAL = [
  'Abomasnow', 'Sandslash-Alola', 'Aurorus', 'Avalugg', 'Avalugg-Hisui', 'Beartic', 'Cryogonal', 'Dewgong',
  'Eiscue', 'Froslass', 'Frosmoth', 'Glaceon', 'Glalie', 'Jynx', 'Lapras', 'Mr. Rime', 'Piloswine', 'Regice',
  'Rotom-Frost', 'Sneasel', 'Vanilluxe', 'Walrein', 'Articuno', 'Vulpix-Alola', 'Sawsbuck-Winter', 'Wyrdeer',
  'Ampharos', 'Dubwool', 'Sceptile', 'Alcremie', 'Appletun', 'Dachsbun', 'Dedenne', 'Dipplin', 'Greedent',
  'Flapple', 'Morpeko', 'Bronzong', 'Coalossal', 'Carbink', 'Togedemaru', 'Lunatone', 'Solrock', 'Miltank',
  'Torkoal', 'Morgrem', 'Houndoom', 'Drampa', 'Dusknoir', 'Trevenant', 'Banette', 'Bewear', 'Klinklang',
  'Gogoat', 'Stonjourner', 'Minior', 'Ponyta', 'Cetoddle', 'Snom', 'Vanillite', 'Vanillish', 'Crabominable',
  'Deerling-Winter', 'Vivillon-Icy-Snow',
] as const;

export const WICHTELCUP_JUNK = [
  'Bergmite', 'Mr. Mime-Galar', 'Prinplup', 'Staryu',
  'Delibird', 'Sudowoodo', 'Swinub', 'Snorunt', 'Rolycoly', 'Kricketune',
  'Bronzor', 'Sealeo', 'Wooloo', 'Spheal', 'Phantump', 'Milcery',
  'Chingling', 'Litwick', 'Mareep', 'Impidimp', 'Fidough',
  'Snover', 'Amaura', 'Castform',
  'Darumaka-Galar', 'Lampent', 'Swirlix', 'Cubchoo', 'Stufful', 'Stantler',
] as const;

export const WICHTELCUP_PREMIUM = [
  'Ninetales-Alola', 'Mamoswine', 'Weavile', 'Empoleon', 'Cloyster', 'Cetitan', 'Arctozolt', 'Arctovish',
  'Glastrier', 'Chandelure', 'Togekiss', 'Sylveon', 'Slurpuff', 'Hydrapple', 'Tinkaton', 'Diancie', 'Primarina',
  'Rotom-Heat', 'Snorlax', 'Starmie', 'Tyranitar', 'Grimmsnarl', 'Polteageist',
] as const;

export const WICHTELCUP_NEW_YEAR = [
  'Blacephalon', 'Xurkitree', 'Celesteela', 'Regieleki', 'Volcanion', 'Iron Moth', 'Necrozma', 'Jirachi',
  'Victini', 'Meloetta', 'Toxtricity', 'Pecharunt',
  'Dialga', 'Palkia', 'Solgaleo', 'Lunala', 'Ho-Oh', 'Reshiram', 'Zekrom', 'Groudon', 'Celebi',
  'Zeraora', 'Magearna', 'Rayquaza',
] as const;

export const WICHTELCUP_SPECIES = [
  ...WICHTELCUP_NORMAL, ...WICHTELCUP_JUNK, ...WICHTELCUP_PREMIUM, ...WICHTELCUP_NEW_YEAR,
] as const;

/**
 * Formes the rules admit through a pool entry that does not pin its form. Toxtricity is "standard species; use form details
 * supported by engine and Species Clause" (section 9), unlike the "base form" entries (Dialga, Necrozma, Rayquaza, ...) and
 * "standard starting form" (Meloetta): both its formes may be brought, and they count as one species under the Species Clause.
 * They are not extra pool entries (the pools keep the sizes of the rules text); the format's pool check already matches a
 * forme by its base species, so only the rule preset's exact-id allowlist has to list them.
 */
export const WICHTELCUP_ENTRY_FORMES = ['Toxtricity-Low-Key'] as const;

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
 * Items that change a pool species into a forme the pool does not list (Primal Groudon, the Origin formes). The cup allows
 * only "base form" entries, and the allowlist alone cannot see an in-battle or item-forced change, so the items are banned.
 */
const FORME_ITEMS = ['Red Orb', 'Adamant Crystal', 'Lustrous Globe'] as const;

/**
 * Every ban of the cup traces to a line of the rules text or the Showdown ruleset; nothing else is banned:
 *  - Light Clay: "Banned item" (section 2); Moody and Snow Cloak: "Banned abilities" (section 2);
 *  - the Mega Stones: "No Mega Evolution"; the Z-crystals: "No Z-Moves";
 *  - Red Orb, Adamant Crystal, Lustrous Globe: Groudon, Dialga and Palkia are "base form" entries, and these items turn them
 *    into Primal Groudon and the Origin formes.
 * No move is banned. "Rayquaza (base form; no Mega)" is kept by the Mega Rayquaza Clause (clausesForTier) in battle and by
 * the allowlist, which does not list Rayquaza-Mega; Dragon Ascent itself is an ordinary attack the rules do not ban.
 */
export const WICHTELCUP_BANS: RuleNames = {
  pokemon: [],
  moves: [],
  items: ['Light Clay', ...FORME_ITEMS, ...Z_CRYSTALS_AND_MEGA_STONES],
  abilities: ['Moody', 'Snow Cloak'],
};

/** The six primary roles of the junk-gift pool (rules text, section 7). */
export type WichtelcupRole = 'hazard_removal' | 'hazard_setter' | 'wall_stall' | 'support' | 'weather_setter' | 'attacker';

/**
 * The reviewed primary role of every junk-gift species (rules text, section 7: exactly one per species, 4 + 6 + 6 + 5 + 3 + 6).
 * Only the primary role is binding: a giver picks two junk gifts with different primary roles. The secondary roles of the
 * text are non-binding notes and are not transcribed. Keyed by the same display names as `WICHTELCUP_JUNK`, so a species
 * missing here is a compile error.
 */
export const WICHTELCUP_JUNK_ROLES: Readonly<Record<(typeof WICHTELCUP_JUNK)[number], WichtelcupRole>> = {
  Bergmite: 'hazard_removal',
  'Mr. Mime-Galar': 'hazard_removal',
  Prinplup: 'hazard_removal',
  Staryu: 'hazard_removal',
  Delibird: 'hazard_setter',
  Sudowoodo: 'hazard_setter',
  Swinub: 'hazard_setter',
  Snorunt: 'hazard_setter',
  Rolycoly: 'hazard_setter',
  Kricketune: 'hazard_setter',
  Bronzor: 'wall_stall',
  Sealeo: 'wall_stall',
  Wooloo: 'wall_stall',
  Spheal: 'wall_stall',
  Phantump: 'wall_stall',
  Milcery: 'wall_stall',
  Chingling: 'support',
  Litwick: 'support',
  Mareep: 'support',
  Impidimp: 'support',
  Fidough: 'support',
  Snover: 'weather_setter',
  Amaura: 'weather_setter',
  Castform: 'weather_setter',
  'Darumaka-Galar': 'attacker',
  Lampent: 'attacker',
  Swirlix: 'attacker',
  Cubchoo: 'attacker',
  Stufful: 'attacker',
  Stantler: 'attacker',
};
