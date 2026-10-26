/**
 * The format ids `POST /api/seed-rulesets` creates standard rulesets for: the 88 formats the catalog had before the
 * rule preset catalog grew (the ladder tiers of generations 1 to 9, plus Doubles OU, VGC, Monotype, 1v1 and the
 * National Dex). The list is frozen on purpose.
 *
 * The catalog (`PRESETS` in ./format-catalog.ts) now also holds the Smogon draft formats, the doubles Ubers and Little
 * Cup formats and the rest of the National Dex family. Those are presets, not site rulesets: the ruleset studio
 * offers them as starting points and a league makes its own ruleset from one, so seeding them would put dozens of
 * rulesets in the site catalog that nobody asked for. Seeding a new preset is a decision, made by adding its id here.
 * Pure and client-safe (no imports).
 */
const SEEDED_TIERS: Readonly<Record<number, readonly string[]>> = {
  1: ['ou', 'uu', 'nu', 'lc', 'ubers'],
  2: ['ou', 'uu', 'nu', 'lc', 'ubers'],
  3: ['ou', 'uu', 'nu', 'lc', 'ubers', 'doublesou'],
  4: ['ou', 'uu', 'nu', 'lc', 'ubers', 'doublesou'],
  5: ['ou', 'uu', 'ru', 'nu', 'lc', 'ubers', 'doublesou'],
  6: ['ou', 'uu', 'ru', 'nu', 'pu', 'lc', 'ubers', 'ag', 'doublesou', 'vgc', 'monotype', '1v1'],
  7: ['ou', 'uu', 'ru', 'nu', 'pu', 'zu', 'lc', 'nfe', 'ubers', 'ag', 'cap', 'doublesou', 'vgc', 'monotype', '1v1'],
  8: ['ou', 'uu', 'ru', 'nu', 'pu', 'zu', 'lc', 'nfe', 'ubers', 'ag', 'cap', 'doublesou', 'vgc', 'monotype', '1v1', 'nationaldex'],
  9: ['ou', 'uu', 'ru', 'nu', 'pu', 'zu', 'lc', 'nfe', 'ubers', 'ag', 'cap', 'doublesou', 'vgc', 'monotype', '1v1', 'nationaldex'],
};

/** The 88 format ids the seed route creates rulesets for, in generation order. */
export const SEED_FORMAT_IDS: readonly string[] = Object.entries(SEEDED_TIERS).flatMap(([gen, tiers]) =>
  tiers.map((tier) => `gen${gen}${tier}`),
);
