/**
 * `draft/legacy/evolution` (owner DL-UI-1, draft-frontend §8.5): the evolution
 * components (`src/components/evolution/**` minus `ProgressSourceChips`) and
 * the labels of `src/lib/evolution/point-buy-display.ts`.
 *
 * `en` is the components' English verbatim, except the §8.3 naming edits
 * (Comeback Token for `kill_tokens`, participation token for `cosmo_points`, Draft Kill
 * Token for `draft_tokens`; thresholds labelled progress points) and the
 * German literals of `PointBuyDetailCard`, which get English text here.
 * Species, move, ability, type and stat names come from `src/lib/pkmn/i18n`.
 *
 * The league's own rulings (`summary.suspendedNext`, `summary.suspensionDetail`,
 * `pointBuy.rule.noCocoon`, `pointBuy.rule.cosmog`, `pointBuy.ruleFilter.scatterbug`,
 * `pointBuy.ruleFilter.no_cocoon_rule`) come from the active format pack (design
 * spec §E.1).
 */
import { formatPack } from '@/lib/format-pack';

const P = formatPack.messages.en.draftLegacyEvolution;

export default {
  xpBar: {
    ariaNamed: '{name} progress: {value} of {max}',
    aria: 'Progress: {value} of {max}',
    skip: 'Skip',
    skipAria: 'Skip animation',
  },
  decision: {
    title: 'Decision match required',
    tied: 'The following players are tied on all tiebreakers (match points, evolution points, kill difference, and head-to-head): <b>{names}</b>.',
    hint: 'Schedule a decision match via manual round pairing. The winner breaks the tie.',
    enter: 'Enter decision match (Admin)',
    leagueAdmin: 'League admin',
  },
  /** `EpbPokemonRow` (match detail page). */
  row: {
    evolved: 'Evolved!',
    evolvedInto: 'Evolved into {form}',
    next: 'Next: {form}',
    nextMore: { one: 'Next: {form} ({count} more)', other: 'Next: {form} ({count} more)' },
    fullyEvolved: 'Fully evolved',
  },
  replay: {
    play: {
      one: 'Play evolution replay ({count} event)',
      other: 'Play evolution replay ({count} events)',
    },
    title: 'Evolution Replay',
    skipAll: 'Skip all',
    /** Self-earned KOs of this match in the "+N" line. */
    kosGained: { one: '+{count} KO', other: '+{count} KOs' },
  },
  summary: {
    /** `value` is "+1" or "0". */
    evolutionPoint: 'EP: {value}',
    evolutions: { one: '{count} evolution', other: '{count} evolutions' },
    comebackTokens: { one: '+{count} Comeback Token', other: '+{count} Comeback Tokens' },
    ...P.summary,
  },
  matchup: {
    yourTrainer: 'Your Trainer',
    opponent: 'Opponent',
    player1: 'Player 1',
    player2: 'Player 2',
    select: 'Select...',
    rosters: 'Rosters',
    stabTitle: 'STAB: {attacker} → {defender}',
    roleComparison: 'Team Role Comparison',
    selectTwo: 'Select two trainers to compare rosters, type matchups, and team roles.',
    none: 'none',
  },
  roster: {
    lines: { one: '{count} line', other: '{count} lines' },
    /** Total progress (all sources); the chips beside it split it by source. */
    progressTotal: 'Progress: {n}',
    roles: 'Roles: {list}',
    empty: 'No drafted lines found.',
  },
  stab: {
    corner: 'vs →',
    cellTitle: '{attacker} ({attackerTypes}) vs {defender} ({defenderTypes})',
  },
  detail: {
    abilities: 'Abilities: {list}',
    weakTo: 'Weak to',
    resists: 'Resists',
    immune: 'Immune',
    teamRoles: 'Team roles',
  },
  pointBuy: {
    detailsAria: '{name} details',
    lineNumber: 'Line #{n}',
    closeDetails: 'Close details',
    priceGroup: 'Price Group',
    killsToStage2: 'Kills to Stage 2',
    additionalToStage3: 'Additional to Stage 3',
    resetsAfterStage2: 'Resets after Stage 2',
    early: 'Early',
    mid: 'Mid',
    late: 'Late',
    rationale: 'Rationale',
    history: 'History',
    specialRules: 'Special rules',
    /** Structured special rules; thresholds come from the entry (league overrides applied). */
    rule: {
      scatterbug: {
        one: '{count} progress point to {stage2}, {more} more to {stage3}',
        other: '{count} progress points to {stage2}, {more} more to {stage3}',
      },
      ...P.pointBuy.rule,
      noRedraft: 'Excluded from the Redraft',
    },
    stages: 'Stages',
    sources: 'Sources: {sources}',
    legacyTier: 'Legacy tier: {tier}',
    noRoles: 'No team roles imported for this stage',
    columns: {
      pokemon: 'Pokémon',
      killsS2: 'Kills S2',
      killsS3: 'Kills S3',
      group: 'Group',
    },
    viewDetails: 'View details for {name}',
    searchPlaceholder: 'Search Pokémon...',
    searchAria: 'Search evolution lines',
    filterPriceGroup: 'Filter by price group',
    allPriceGroups: 'All price groups',
    filterType: 'Filter by type',
    allTypes: 'All types',
    filterTeamRole: 'Filter by team role',
    allTeamRoles: 'All team roles',
    priceMin: 'Price min',
    priceMax: 'Price max',
    killsS3Plus: 'Kills S3+',
    filterSpecialRules: 'Filter by special rules',
    /** Special-rule filter options, keyed by `SpecialRuleFilter` (the participation line is labelled with the species name alone). */
    ruleFilter: {
      ...P.pointBuy.ruleFilter,
      no_redraft: 'No redraft',
      has_text: 'Has special rules text',
    },
    lineCount: '{shown} / {total} lines',
    empty: 'No evolution lines match your filters',
    pinnedHint: 'Pinned — Esc or click outside to close',
    loadingList: 'Loading list…',
  },
} as const;
