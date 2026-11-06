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

export const WICHTELCUP_BANS: RuleNames = {
  pokemon: [],
  moves: [],
  items: ['Light Clay', ...Z_CRYSTALS_AND_MEGA_STONES],
  abilities: ['Moody', 'Snow Cloak'],
};
