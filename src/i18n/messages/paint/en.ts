/**
 * `paint` (T20): every word the shared route engine and the plaza 3D world
 * paint onto a canvas — the jumbotron boards, the Rotom PC kiosk and holo,
 * the rules gate, the crest LED wall, the roll-call ledger, the wayfinding
 * kiosk and the price-band words the isle painters share
 * (`src/lib/route-world/board-text.ts`).
 *
 * Stored in sentence case; painters upper-case with `paintCaps`
 * (`src/lib/route-world/paint-copy.ts`, `upperForPaint`, so `ß` → `SS`).
 * Pokémon names never live here: they come from `src/lib/pkmn/i18n`.
 *
 * The league's own words (`gate.label.cosmoPoints`, `gate.value.shutout`,
 * `gate.value.participation`, `priceBand.*`) come from the active format pack
 * (design spec §E.1).
 */
import { formatPack } from '@/lib/format-pack';

const P = formatPack.messages.en.paint;

export default {
  common: {
    live: 'Live',
    points: '{points} pts',
    matchday: 'Matchday',
    matchdayN: 'Matchday {n}',
  },
  board: {
    pulseTitle: 'Pulse',
    tableTitle: 'Standings',
    resultsTitle: 'Results',
    scheduleTitle: 'Schedule',
    noLiveMatch: 'No match in progress',
    gamesPlayed: { one: '{count} match played', other: '{count} matches played' },
    participants: { one: '{count} participant', other: '{count} participants' },
    colWins: 'W',
    colLosses: 'L',
    colDraws: 'D',
    colDiff: 'Diff',
    colPoints: 'Pts',
    emptyTableHeadline: 'No standings yet',
    emptyTableCopy: 'It takes shape with the first results.',
    emptyResultsHeadline: 'No results yet',
    emptyResultsCopy: 'The first matchday has not been played yet.',
    emptyScheduleHeadline: 'No matchday scheduled',
    emptyScheduleCopy: 'The next matches are being scheduled right now.',
    groupCurrent: 'Current',
    groupNext: 'Up next',
    groupLabel: '{matchday} · {tag}',
    groupLabelMore: '{matchday} · {tag} · +{count} more',
    status: {
      upcoming: 'Open',
      live: 'Live',
      done: 'Final',
    },
    kickoffNext: 'Next kickoff · {date} {time}',
    countdown: 'Next kickoff in {clock} · {date} {time}',
    countdownDays: { one: '{count} day {clock}', other: '{count} days {clock}' },
    liveTicker: 'Live · {home} — {away}',
  },
  desk: {
    kioskBrand: 'Rotom PC · EvoLiga',
    rosterTitle: 'Point-Buy list',
    lines: { one: '{count} line', other: '{count} lines' },
    open: { one: '{count} open', other: '{count} open' },
    columns: 'Line · Pokémon · Price',
    price: '{price} pts',
    holoBrand: 'EvoLiga · Roster',
    healing: 'Healing',
  },
  gate: {
    teraRule: {
      any: 'Any Tera',
      stab_only: 'STAB Tera only',
      none: 'No Tera',
    },
    tiebreaker: {
      match_points: 'Match points',
      evolution_points: 'Evolution points',
      kill_difference: 'KO difference',
      head_to_head: 'Head-to-head',
      decision_match: 'Decider match',
    },
    none: 'none',
    rulesTabText: 'in the Rules tab',
    rulesTabNote: 'This league’s clauses, bans and custom rules are listed in the league overview.',
    rulesNoneText: 'not on record',
    rulesNoneNote: '{noRuleset} No clauses, bans or custom rules are on record.',
    label: {
      ruleset: 'Ruleset',
      format: 'Format',
      bestOf: 'Best-of',
      clauses: 'Clauses',
      bans: 'Bans',
      customRules: 'Custom rules',
      draftBudget: 'Draft budget',
      evolutionLines: 'Evolution lines',
      redraftPhase: 'Redraft phase',
      teraStage: 'Tera — stage {n}',
      bannedMoves: 'Banned moves',
      bannedItems: 'Banned items',
      draftTokens: 'Draft tokens',
      tokensPerPlayer: 'Tokens per player',
      tokensPerLine: 'Tokens per line',
      killTokens: 'Kill tokens',
      ...P.gate.label,
    },
    value: {
      budgetPoints: '{budget} points',
      open: 'open',
      closed: 'closed',
      tokenRatio: '{ratio} points → 1 token',
      max: 'max. {n}',
      ...P.gate.value,
    },
    note: {
      tiebreaker: 'Tiebreakers: {chain}',
      banned: 'Moves: {moves} · Items: {items}',
    },
    heading: {
      format: 'Format',
      clauses: 'Clauses',
      draftRules: 'Draft rules',
    },
    plaque: {
      kickerLeft: 'Tablet I',
      kickerRight: 'Tablet II',
      titleFormat: 'Format',
      titleClausesBans: 'Clauses & bans',
      titleFormatDraft: 'Format & draft',
      titleTeraClauses: 'Tera & clauses',
      footer: 'Tap for the full ruleset',
      boardKicker: 'Ruleset',
    },
    cta: {
      draft: 'Draft now',
      play: 'Play now',
    },
  },
  crest: {
    kicker: 'Trainer {index}/{total}',
    kickerPlace: 'Trainer {index}/{total} · Rank {place}',
    ace: 'Ace · {ace}',
    tagline: 'Your arena. Your glory.',
  },
  ledger: {
    kicker: 'Trainers',
    rankSpan: 'Ranks 1–{n}',
    setBack: 'set back',
    height: '{height} m',
  },
  plinth: {
    kicker: 'Ace',
  },
  kiosk: {
    pulseTable: 'Pulse · Standings',
    rosterWest: 'List ← West',
    rulesSouth: 'Rules ↓ South',
  },
  /** Point-buy price groups as the boards paint them (keys = stored `price_group`). */
  priceBand: P.priceBand,
  rosterNote: {
    tapWall: 'Tap the wall for all {total}',
    tapWallCounted: '{shown} of {total} lines · Tap the wall for all {total}',
    tapSail: 'Tap the sail for all {total}',
    tapSailCounted: '{shown} of {total} lines · Tap the sail for all {total}',
  },
} as const;
