/**
 * League hub (`src/components/league/hub/**`, i18n-core §7; owner T03).
 *
 * Same keys as the former `LeagueHubCopy` in `src/lib/league-hub/copy.ts`,
 * English copied verbatim. The former function members are plural objects
 * or templates; `leagueHubCopy(locale)` rebuilds the old interface from
 * here. Status, bracket-type and format labels the hub shares with the rest
 * of the site come from `enums`; the draft-room link and the EP column from
 * `glossary`.
 *
 * The EPB scoring sentences (`seasonEvolutionScoring`, `evolutionScoring`) state the league's
 * tiebreak chain, so they come from the active format pack (`leagueHub`).
 */
import { formatPack } from '@/lib/format-pack';

const P = formatPack.messages.en.leagueHub;

export default {
  heading: 'League hub',
  tablistLabel: 'League views',
  tabs: {
    standings: 'Standings',
    matches: 'Matches',
    groups: 'Group stage',
    playoffs: 'Playoffs',
    phases: 'Phases',
    insights: 'Insights',
    rules: 'Rules',
    reports: 'Reports',
  },
  swissTab: 'Swiss rounds',
  /** Season and phase status chips (the hub says "In progress" where the enum says "Active"). */
  status: { upcoming: 'Upcoming', active: 'In progress', completed: 'Completed' },
  /** Short bracket-side prefixes ("Winners · Round 2"). */
  bracketSide: { winners: 'Winners', losers: 'Losers', grand_finals: 'Grand final' },
  trainers: { one: '{count} trainer', other: '{count} trainers' },
  start: 'Start',
  end: 'End',
  startDate: 'Start: {date}',
  endDate: 'End: {date}',
  links: {
    insights: 'Full insights',
    pointBuy: 'Point-buy list',
    matchup: 'Matchup analysis',
    teams: 'Teams & progress',
    phasePage: 'Open phase page',
  },
  table: {
    rank: '#',
    trainer: 'Trainer',
    played: 'Played',
    wins: 'W',
    losses: 'L',
    draws: 'D',
    points: 'Pts',
    games: 'Games',
    killDiff: 'Kill diff',
    buchholz: 'Buchholz',
    movement: 'Move',
    advancementZone: 'Advancement zone',
    tie: 'Tie',
  },
  standingsNote: 'Season table: every phase combined.',
  seasonScoring: '1 point per win, ½ per draw · Buchholz breaks ties.',
  seasonEvolutionScoring: P.seasonEvolutionScoring,
  noResults: 'No results yet.',
  noMatches: 'No matches scheduled yet.',
  round: 'Round {position}',
  versus: 'vs',
  resultWithoutGames: 'Result recorded without game reports',
  tabUnavailable: 'This view could not be loaded right now. Please try again in a moment.',
  groupsEmpty: 'This league has no table phase yet.',
  groupsNoPlayers: 'No players enrolled in this phase yet.',
  roundRobinScoring: '3 points per win · kill difference breaks ties',
  evolutionScoring: P.evolutionScoring,
  swissScoring: '1 point per win, ½ per draw · Buchholz breaks ties',
  advances: {
    perGroup: 'Top {count} per group advance',
    overall: 'Top {count} overall advance',
  },
  resultsGrid: 'Results grid',
  playoffsEmpty: 'This league has no playoff phase yet.',
  bracketPending: 'The bracket appears once the pairings are generated.',
  phasesEmpty: 'No phases configured yet.',
  players: { one: '{count} player', other: '{count} players' },
  groups: 'Groups',
  noMembers: 'No members',
  insightsNote: 'Pokémon usage, kill ranking and move usage across every phase.',
  description: 'About this league',
  ruleset: 'Ruleset',
  noRuleset: 'No ruleset assigned.',
  formatRulesLink: 'Format rules',
  coreLiga: 'Core Liga assignments',
  reportsEmpty: 'No reports yet.',
} as const;
