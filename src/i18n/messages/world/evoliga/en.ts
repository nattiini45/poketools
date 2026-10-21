/**
 * `world/evoliga` (T19): the DOM copy of the EvoLiga plaza world
 * (`src/components/world/evoliga/*.tsx`) — its five sections and the Focus
 * panels behind the plaza's boards, aces, roster tiles and gate plaques.
 *
 * The plaza was German-only; its German stays the reviewed source wording for
 * `de`, and the English is new. League terms (token names, progress sources,
 * draft room, stages) come from `glossary`, enum labels from `enums`,
 * Pokémon / move / item names from the pkmn layer — never from here.
 *
 * The league's own rule prose (`rules.comebackRule`, `rules.cosmoRule`,
 * `rules.evolutionBody`) comes from the active format pack (design spec §E.1).
 */
import { formatPack } from '@/lib/format-pack';

const P = formatPack.messages.en.worldEvoliga;

export default {
  /** Points in a table cell or a summary line. */
  points: '{points} pts',
  noCompleted: 'No completed matches yet — the table forms with the first results.',
  pulse: {
    heading: 'Season pulse',
    participants: 'Participants',
    currentStage: 'Current stage',
    noStage: 'No stage created yet',
    ruleset: 'Ruleset',
    nextMatch: 'Next match',
    liveNow: 'live now',
    noOpenMatches: 'No open matches are scheduled right now.',
    tableTop: 'Top of the table',
  },
  roster: {
    heading: 'Point-Buy list',
    /** The heading while no list is bound: the section shows only a notice, not a list. */
    headingNoList: 'Roster',
    noList:
      'No point-buy list has been bound to this league yet. The list appears here as soon as the league admins bind it.',
    emptyList: 'The bound point-buy list is still empty.',
    priceGroups: 'Price groups',
  },
  teams: {
    heading: 'Teams',
    noParticipants: 'No participants have registered for this league yet.',
    noDraft: 'No lines have been drafted yet — the draft for this league has not been set up or has not run yet.',
    evolutionPoints: '<b>{points}</b> evolution points',
    noLines: 'No lines drafted.',
    stage: 'Stage {stage}',
  },
  team: {
    title: 'Team: {name}',
    noLines: 'This player has not drafted any lines yet.',
    player: 'Player',
    record: 'Record (W-L-D)',
    points: 'Points',
    rosterValue: 'Roster value',
    rosterValueAmount: '{value} points',
    lines: 'Lines',
    totalKos: 'Total KOs',
    moreLines: 'More lines',
    benchStage: 'Stage {stage}',
  },
  line: {
    title: 'Line: {name}',
    number: 'No. {number}',
    line: 'Line',
    price: 'Price',
    priceValue: '{price} points',
    priceGroup: 'Price group',
    killsToStage2: 'KOs to stage 2',
    additionalKills: 'Additional KOs to stage 3',
    ratings: 'Early / Mid / Late',
  },
  board: {
    pulseTitle: 'Pulse — standings',
    scheduleTitle: 'Schedule',
    scheduleTitleActive: 'Schedule — {stage}, matchday {round}',
    participants: { one: '{count} participant', other: '{count} participants' },
    liveNow: 'Live now:',
    matchdayLine: '{stage} · Matchday {round}',
    chooseView: 'Choose a view',
    tabSchedule: 'Schedule',
    tabTable: 'Table',
    tabResults: 'Results',
    noResults: 'No results yet — the first matchday has not been played.',
  },
  fixtures: {
    none: 'No matches scheduled yet.',
    /** The docked panel's pill for a disputed match — the one status the board collapses into its done word. */
    disputed: 'Disputed',
  },
  standings: {
    player: 'Player',
    winLoss: 'W-L',
    points: 'Pts',
    pointsLong: 'Points',
    killDiff: 'KO diff.',
  },
  schedule: {
    heading: 'Schedule',
    noStages: 'No stages or matchdays have been created for this league yet.',
    currentTable: 'Current table',
  },
  rules: {
    heading: 'Rules',
    noFormatRules:
      'No explicit format rules are set for this league — the standard rules of the Evolution Point Buy format apply.',
    budgetDraft: 'Budget & draft',
    budgetBody:
      'Every player has a draft budget of <b>{budget} points</b> and drafts <b>{picks} evolution lines</b>. Each line costs a different number of points depending on its price group; the whole budget may be spent.',
    tokens: 'Token economy',
    draftKillRule:
      '<b>{token}:</b> {ratio} unspent budget points make 1 token, at most {max} per player and {perLine} per line. It adds evolution progress but may never trigger an evolution by itself.',
    evolutionTera: 'Evolution & Tera',
    teraStage: 'Stage {stage}: {rule}',
    redraftHeading: 'Redraft',
    redraftBody:
      'Lines change hands only in the redraft between the two halves: each trainer secretly drops lines, and the freed lines are then drafted again. There are no trades between trainers. The redraft phase is currently <b>{state}</b>.',
    redraftOpen: 'open',
    redraftClosed: 'closed',
    tiebreakers: 'Tiebreakers',
    tiebreakersLead: 'On equal points, these decide in order:',
    tiebreaker: {
      match_points: 'Match points',
      evolution_points: 'Evolution points',
      kill_difference: 'KO difference',
      head_to_head: 'Head-to-head',
      decision_match: 'Decision match',
    },
    bans: 'Bans',
    bannedMoves: 'Banned moves: {list}.',
    bannedItems: 'Banned items: {list}.',
    none: 'none',
    underlying: 'Underlying ruleset: <b>{name}</b>.',
    format: 'Format',
    allRules: 'All rules',
    toRulesTab: 'Open the Rules tab',
    ...P.rules,
  },
  rulesPanel: {
    titleFormat: 'Rules — format',
    titleClauses: 'Rules — clauses',
    standardRules: 'Standard rules',
    choosePage: 'Choose a rules page',
    tabFormat: 'Format',
    tabClauses: 'Clauses',
    tabDraft: 'Draft',
  },
} as const;
