/**
 * The Smogon tournament extras of the draft presets: what the Smogon draft league threads add on top of Showdown's
 * own format. A draft preset is Showdown-faithful (it enforces exactly what the Showdown format defines, see
 * `draft.ts` and the catalog); the rulesets studio offers "add Smogon tour bans" as a visible toggle that applies
 * the extras below as ordinary, editable clauses and bans.
 *
 * Only documented extras are here. Each overlay lists the thread it was read from; a rule that the thread states
 * but this app cannot express, or that is one league's own tiering, is left out and named in `skipped`. Nothing is
 * inferred: where two threads disagree, or a name looks like a typo, the entry stays out and is listed under
 * `unresolved` so an admin can decide.
 *
 * SOURCES (read 2026-10-26 through a page summariser, not raw HTML, so MEDIUM confidence; the research's
 * verification pass fetched each thread a second time and the lines below held, see docs/ruleset-presets.md):
 *  - SV NatDex III signups, https://www.smogon.com/forums/threads/sv-natdex-iii-signups.3788255/ (posted 2026-09-13,
 *    edited 2026-09-21): `[Gen 9] NatDex Draft`; Species, Sleep, Evasion, OHKO, Moody, Endless Battle and Baton Pass
 *    Clauses; Z-moves, Dynamax, Gigantamax and Tera banned; moves Last Respects, Shed Tail, Hidden Power; ability
 *    Power Construct; items Berserk Gene, Quick Claw, King's Rock, Razor Fang and every Gem except Normal Gem.
 *  - SV NatDex II signups, https://www.smogon.com/forums/threads/sv-natdex-ii-signups.3760882/ (2025-03-02): the same
 *    rule set; its page also lists Moody as a banned ability.
 *  - NatDex LC II signups, https://www.smogon.com/forums/threads/natdex-lc-ii-signups.3772680/ (2025-10-19):
 *    `NatDex LC Draft`; the Item Clause is not enforced; moves Grassy Glide, Hidden Power, Baton Pass, Dragon Rage,
 *    Sonic Boom; Z-crystals, non-Normal Gems, Berserk Gene, Quick Claw, King's Rock, Razor Claw banned; Z and Tera banned.
 *  - 6v6 Doubles Draft signups, https://www.smogon.com/forums/threads/6v6-doubles-draft-signups.3772315/ (2025-10-11)
 *    and format discussion, https://www.smogon.com/forums/threads/6v6-doubles-draft-format-discussion.3764012/
 *    (2025-04-28 onward): tour code `gen96v6doublesdraft@@@teratypepreview, -last respects, -dark void`; Species
 *    Clause (by dex number), Gravity Sleep Clause, Evasion (Double Team, Minimize), OHKO and Endless Battle Clauses.
 *  - Draft League Calendar 2026, https://www.smogon.com/forums/threads/draft-league-calendar-2026.3771952/: the
 *    seasons and their formats (no rules; the other draft presets have no documented extras and so no overlay).
 *
 * The "Moody Clause" of those threads is a ban of the Moody ability (Showdown has no separate rule), so it is
 * written here as that ban. "Z-moves banned" is the ban of the Z-crystal items; Dynamax and Gigantamax do not exist
 * in Gen 9.
 */
import type { RuleNames } from './standard';

/** Item groups the server expands from the dex (the names would be a long list that goes stale with the dex). */
export type OverlayItemGroup = 'z-crystals' | 'gems-except-normal';

export interface TourOverlay {
  /** Clause names added on top of the preset. */
  clausesAdd: readonly string[];
  /** Clause names of the preset that the tour does not use. */
  clausesRemove: readonly string[];
  /** Moves, items and abilities banned in addition (Showdown names). The overlay bans no Pokémon. */
  bans: RuleNames;
  itemGroups: readonly OverlayItemGroup[];
  sources: readonly string[];
  /** Documented rules left out because the app cannot express them or they are one league's own. */
  skipped: readonly string[];
  /** Entries left out because the sources disagree or look mistyped; the admin decides. */
  unresolved: readonly string[];
}

const NO_POKEMON = { pokemon: [] } as const;

/** The overlays by preset id. A preset not listed has no documented tour extras. */
export const TOUR_OVERLAYS: Readonly<Record<string, TourOverlay>> = {
  gen9natdexdraft: {
    clausesAdd: ['Species Clause', 'Baton Pass Clause', 'Terastal Clause'],
    clausesRemove: [],
    bans: {
      ...NO_POKEMON,
      moves: ['Hidden Power', 'Last Respects', 'Shed Tail'],
      items: ['Berserk Gene', "King's Rock", 'Quick Claw', 'Razor Fang'],
      abilities: ['Moody', 'Power Construct'],
    },
    itemGroups: ['z-crystals', 'gems-except-normal'],
    sources: [
      'https://www.smogon.com/forums/threads/sv-natdex-iii-signups.3788255/',
      'https://www.smogon.com/forums/threads/sv-natdex-ii-signups.3760882/',
    ],
    skipped: ['At most one Mega Evolution per team (optional in the thread)', 'Multi-forme exceptions of the species clause (Pikachu, Tauros, Basculin, ...)'],
    unresolved: ['SV NatDex III lists only Power Construct as a banned ability, NatDex II also lists Moody; the Moody Clause of both is applied'],
  },
  gen9natdexlcdraft: {
    clausesAdd: ['Species Clause', 'Baton Pass Clause', 'Terastal Clause'],
    clausesRemove: ['Item Clause'],
    bans: {
      ...NO_POKEMON,
      moves: ['Baton Pass', 'Grassy Glide', 'Hidden Power'],
      items: ['Berserk Gene', "King's Rock", 'Quick Claw', 'Razor Claw'],
      abilities: ['Moody'],
    },
    itemGroups: ['z-crystals', 'gems-except-normal'],
    sources: ['https://www.smogon.com/forums/threads/natdex-lc-ii-signups.3772680/'],
    skipped: ['Dynamax Clause (Dynamax does not exist in Gen 9)'],
    unresolved: [],
  },
  gen9doublesdraft: {
    clausesAdd: ['Species Clause', 'Gravity Sleep Clause', 'Tera Type Preview'],
    clausesRemove: [],
    bans: {
      ...NO_POKEMON,
      moves: ['Dark Void', 'Double Team', 'Last Respects', 'Minimize'],
      items: [],
      abilities: [],
    },
    itemGroups: [],
    sources: [
      'https://www.smogon.com/forums/threads/6v6-doubles-draft-signups.3772315/',
      'https://www.smogon.com/forums/threads/6v6-doubles-draft-format-discussion.3764012/',
    ],
    skipped: ['A Pokémon banned in that league\'s own tiering update (Archaludon)'],
    unresolved: [],
  },
};

/** The overlay of a preset, or `undefined` when the Smogon threads document no extras for it. */
export function getTourOverlay(presetId: string): TourOverlay | undefined {
  return TOUR_OVERLAYS[presetId];
}
