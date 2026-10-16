/**
 * `draft/legacy` root (owner DL-UI-1, draft-frontend §8.5): terms shared by the
 * legacy draft board, the evolution components and the matchup view. The
 * component texts live in the sub-namespaces `draft/legacy/{board,evolution,pages}`
 * (DL-UI-1) and `draft/legacy/league-admin` (DL-UI-2).
 *
 * League terms (token names, progress sources, "on the clock") come from
 * `glossary`; progress chips from `draft/shared`; enum labels from `enums`.
 * Sentence case in storage; ALL-CAPS only through CSS.
 */
export default {
  /** A line price in the legacy screens ("12 pts"). */
  pts: '{n} pts',
  ptsRemaining: '{n} pts remaining',
  picksLeft: { one: '{count} pick left', other: '{count} picks left' },
  noPicksYet: 'No picks yet',
  /** Stand-in for a player id the page cannot name. */
  unknownPlayer: 'Unknown',
  /** Short stage badge ("S2"). */
  stageShort: 'S{n}',
  stage: 'Stage {n}',
  suspended: 'Suspended',
  /** Tera eligibility of a stage (`getTeraEligibility`), keyed by the rule value. */
  tera: {
    any: 'Tera All',
    stab_only: 'Tera STAB',
    none: 'No Tera',
  },
  /** Team-role categories, keyed by `TeamRoleCategory` verbatim (the only team-role labels). */
  teamRole: {
    hazard_setting: 'Hazard Setting',
    hazard_removal: 'Hazard Removal',
    healing_cleric: 'Healing / Cleric',
    momentum: 'Momentum',
    item_removal: 'Item Removal',
    status: 'Status',
    priority: 'Priority',
    disruption: 'Disruption',
  },
  /** A price group with its price range ("<group> (<min>–<max>)"); the group label comes from `enums.priceGroup`. */
  priceGroupRange: '{group} ({min}–{max})',
} as const;
