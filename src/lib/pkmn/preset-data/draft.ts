/**
 * The rule data of the Smogon draft formats (Showdown's "Draft" section, `config/formats.ts` L497-L680 at
 * `PRESET_DATA_PIN`, ./pin.ts): the move, item and ability bans per format, and the combination bans the app lists
 * but does not model. The clause lists, the level, the team size and the other rule facts are in the dex-free
 * catalog (`PRESETS` in ../format-catalog.ts); the Champions roster is `champions-roster.generated.ts`; the
 * documented Smogon tournament extras are `tour-overlay.ts`.
 *
 * Names are Showdown's English names; `../preset-rules.server.ts` folds them to ids. Everything is resolved PER MOD,
 * because a mod can replace a rule: the gen 3 mod replaces `Standard Draft` outright (`data/mods/gen3/rulesets.ts`
 * L11-L22), the champions mod has its own `Standard AG` and `Flat Rules` (`data/mods/champions/rulesets.ts`); gens
 * 4 to 9 outside Champions use the base `Standard Draft` (`data/rulesets.ts` L157-L165), which has NO banlist: a
 * draft league's roster is the draft, not a tier list. Reading `data/rulesets.ts` alone would be wrong for gen 3
 * and Champions.
 */
import { NO_BANS, type RuleNames } from './standard';

/**
 * The Pokémon a draft format bans because of a TIER: the gen 3 mod bans the whole `Uber` tier (15 species in the
 * dex: `data/mods/gen3/rulesets.ts` L11-L22), nothing else bans a Pokémon. The tier is the highest one that stays
 * legal; everything above it is banned (`getBannedPokemonForTier`).
 */
export const DRAFT_TIER_BANS: Readonly<Record<string, string>> = {
  gen3draft: 'OU',
};

/**
 * The explicit bans of the draft formats that have any, by preset id. A format absent here bans no move, item or
 * ability.
 */
export const DRAFT_BANS: Readonly<Record<string, RuleNames>> = {
  // `[Gen 3] Draft` (L673): the gen 3 mod ruleset (Swagger, Focus Band, King's Rock, Quick Claw) + the format's own `Assist`.
  gen3draft: { ...NO_BANS, moves: ['Assist', 'Swagger'], items: ['Focus Band', "King's Rock", 'Quick Claw'] },
  // `[Gen 4] Draft` (L666); the combinations are in DRAFT_COMBINATION_BANS.
  gen4draft: { ...NO_BANS, moves: ['Assist', 'Swagger'], items: ["King's Rock", 'Quick Claw'] },
  // `[Gen 5] Draft` (L656).
  gen5draft: { ...NO_BANS, moves: ['Assist', 'Swagger'], items: ["King's Rock", 'Quick Claw', 'Soul Dew'], abilities: ['Moody'] },
  // `[Gen 6] Draft` (L649).
  gen6draft: { ...NO_BANS, moves: ['Swagger'], items: ['Soul Dew'], abilities: ['Moody'] },
  // `[Gen 9] NatDex LC Draft` (L540); it has no species banlist, unlike `[Gen 9] LC`.
  gen9natdexlcdraft: { ...NO_BANS, moves: ['Dragon Rage', 'Sonic Boom'] },
};

/**
 * The combination bans of the older draft formats, in Showdown's notation (`A + B`: a Pokémon with both; `A ++ B`:
 * a team that has both). The ban arrays cannot hold a combination, so the app lists them as a documented rule it
 * does not enforce (`combination_bans` in the catalog's unmodelled facts).
 */
export const DRAFT_COMBINATION_BANS: Readonly<Record<string, readonly string[]>> = {
  // `[Gen 3] Draft` and data/mods/gen3/rulesets.ts L11-L22
  gen3draft: ['Smeargle + Ingrain', 'Baton Pass + Ancient Power', 'Baton Pass + Silver Wind'],
  // `[Gen 4] Draft` (L666)
  gen4draft: ['Sand Stream ++ Sand Veil', 'Snow Warning ++ Snow Cloak', 'No Guard + Dynamic Punch', 'Baton Pass + Magnet Rise'],
  // `[Gen 5] Draft` (L656)
  gen5draft: ['Drizzle ++ Swift Swim', 'Drought ++ Chlorophyll', 'Sand Stream ++ Sand Rush', 'Landorus + Sheer Force', 'Excadrill + Sand Rush'],
};
