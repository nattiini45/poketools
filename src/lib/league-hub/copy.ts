import type { BracketCopy } from '@/components/bracket/labels';
import type { RoundRobinTableLabels } from '@/components/bracket/RoundRobinTable';
import type { ScopedInsightsLabels } from '@/components/insights/ScopedInsightsView';
import type { RulesetDetailLabels } from '@/components/ruleset/RulesetDetail';
import type { TablePaginationLabels } from '@/components/ui/Table';
import { LEAGUE_TIME_ZONE, type Locale } from '@/i18n/config';
import { createFormatter } from '@/i18n/format';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { createTranslator, getMessages } from '@/i18n/core';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { leagueHubMessages } from '@/i18n/messages/league-hub';
import { leagueHubSharedMessages } from '@/i18n/messages/league-hub/shared';
import type { LeagueHubTab } from './tabs';

/**
 * League hub copy in the viewer's language (i18n-core §7).
 *
 * The words live in the `league-hub` namespace (same keys as this
 * interface); status, bracket-type and format labels come from `enums`, the
 * draft-room link and the EP column from `glossary`, stored engine round
 * names go through `translateEngineLabel`. `leagueHubCopy(locale)` is the
 * thin adapter that rebuilds this interface, so the hub's server components
 * keep their `copy.x` reads. Pure and client-safe; memoized per locale.
 */
export interface LeagueHubCopy {
  heading: string;
  tablistLabel: string;
  tabs: Record<LeagueHubTab, string>;
  /** Tab label when the league's table phases are all Swiss. */
  swissTab: string;
  status: Record<string, string>;
  roundStatus: Record<string, string>;
  matchStatus: Record<string, string>;
  bracketType: Record<string, string>;
  formatType: Record<string, string>;
  bracketSide: Record<string, string>;
  trainers: (count: number) => string;
  start: string;
  end: string;
  /** "Start: 1 Mar 2026" (the date already formatted). */
  startDate: (date: string) => string;
  endDate: (date: string) => string;
  links: {
    insights: string;
    draft: string;
    pointBuy: string;
    matchup: string;
    teams: string;
    phasePage: string;
  };
  table: {
    rank: string;
    trainer: string;
    played: string;
    wins: string;
    losses: string;
    draws: string;
    points: string;
    games: string;
    killDiff: string;
    evolutionPoints: string;
    buchholz: string;
    movement: string;
    advancementZone: string;
    tie: string;
    /** Matches played (the combined table of a league with groups). */
    matchesPlayed: string;
    /** Points per match (the combined table, while match counts differ). */
    pointsPerMatch: string;
  };
  standingsNote: string;
  /** League groups: the group tables count cross-group matches; the combined table follows. */
  groupTablesNote: string;
  combinedTable: string;
  combinedByPointsPerMatch: string;
  combinedByPoints: string;
  /** A points-per-match value in the viewer's number format, two decimals ("1.50" / "1,50"). */
  pointsPerMatchValue: (value: number) => string;
  /** The season table's scoring (non-EPB: the generic standings defaults). */
  seasonScoring: string;
  /** The season table's scoring on Evolution Point Buy. */
  seasonEvolutionScoring: string;
  noResults: string;
  noMatches: string;
  round: (position: number) => string;
  /**
   * A stored round name in the viewer's language. The bracket and pairing
   * engines name rounds in English ("Round 3", "Semifinals", "Losers Round
   * 2"); German translates those patterns and keeps any other name (an
   * admin's "Woche 1") as written.
   */
  roundName: (name: string) => string;
  versus: string;
  /** Tooltip on a completed match's result when it has no game rows (no score to show). */
  resultWithoutGames: string;
  /** A tab whose reads failed: the panel says so, the rest of the page renders. */
  tabUnavailable: string;
  groupsEmpty: string;
  groupsNoPlayers: string;
  roundRobinScoring: string;
  /** Evolution Point Buy tables: 3 points a win, then the format's tiebreak chain. */
  evolutionScoring: string;
  swissScoring: string;
  advances: (count: number, perGroup: boolean) => string;
  resultsGrid: string;
  playoffsEmpty: string;
  bracketPending: string;
  phasesEmpty: string;
  bestOf: (count: number) => string;
  players: (count: number) => string;
  groups: string;
  noMembers: string;
  insightsNote: string;
  description: string;
  ruleset: string;
  noRuleset: string;
  formatRulesLink: string;
  coreLiga: string;
  reportsEmpty: string;
}

function buildCopy(locale: Locale): LeagueHubCopy {
  const m = getMessages(leagueHubMessages, locale);
  const t = createTranslator(leagueHubMessages, locale);
  const common = createTranslator(commonMessages, locale);
  const enums = getMessages(enumMessages, locale);
  const glossary = getMessages(glossaryMessages, locale);
  return {
    heading: m.heading,
    tablistLabel: m.tablistLabel,
    tabs: { ...m.tabs },
    swissTab: m.swissTab,
    status: { ...m.status },
    roundStatus: { ...enums.roundStatus },
    matchStatus: { ...enums.matchStatus },
    bracketType: { ...enums.bracketType },
    formatType: { ...enums.formatType },
    bracketSide: { ...m.bracketSide },
    trainers: (count) => t('trainers', { count }),
    start: m.start,
    end: m.end,
    startDate: (date) => t('startDate', { date }),
    endDate: (date) => t('endDate', { date }),
    links: { ...m.links, draft: glossary.draft.draftRoom },
    table: { ...m.table, evolutionPoints: glossary.progress.evolutionPointsShort },
    standingsNote: m.standingsNote,
    groupTablesNote: m.groupTablesNote,
    combinedTable: m.combinedTable,
    combinedByPointsPerMatch: m.combinedByPointsPerMatch,
    combinedByPoints: m.combinedByPoints,
    pointsPerMatchValue: (value) =>
      createFormatter({ locale, timeZone: LEAGUE_TIME_ZONE }).number(value, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    seasonScoring: m.seasonScoring,
    seasonEvolutionScoring: m.seasonEvolutionScoring,
    noResults: m.noResults,
    noMatches: m.noMatches,
    // Positions stay plain digits (never "1.000"), as the stored names are.
    round: (position) => t('round', { position: String(position) }),
    roundName: (name) => translateEngineLabel('round', name, locale),
    versus: m.versus,
    resultWithoutGames: m.resultWithoutGames,
    tabUnavailable: m.tabUnavailable,
    groupsEmpty: m.groupsEmpty,
    groupsNoPlayers: m.groupsNoPlayers,
    roundRobinScoring: m.roundRobinScoring,
    evolutionScoring: m.evolutionScoring,
    swissScoring: m.swissScoring,
    advances: (count, perGroup) => t(perGroup ? 'advances.perGroup' : 'advances.overall', { count }),
    resultsGrid: m.resultsGrid,
    playoffsEmpty: m.playoffsEmpty,
    bracketPending: m.bracketPending,
    phasesEmpty: m.phasesEmpty,
    bestOf: (count) => common('bestOf', { count: String(count) }),
    players: (count) => t('players', { count }),
    groups: m.groups,
    noMembers: m.noMembers,
    insightsNote: m.insightsNote,
    description: m.description,
    ruleset: m.ruleset,
    noRuleset: m.noRuleset,
    formatRulesLink: m.formatRulesLink,
    coreLiga: m.coreLiga,
    reportsEmpty: m.reportsEmpty,
  };
}

const copies = new Map<Locale, LeagueHubCopy>();

export function leagueHubCopy(locale: Locale): LeagueHubCopy {
  let copy = copies.get(locale);
  if (!copy) {
    copy = buildCopy(locale);
    copies.set(locale, copy);
  }
  return copy;
}

/**
 * Labels for the shared components the hub embeds: the elimination bracket,
 * the round robin results grid, the ruleset detail and the insights tables.
 *
 * BRIDGE (i18n-core §7 deviation, recorded for the sweep): the design moves
 * this wording into the owners' namespaces and lets those components
 * localize themselves. Until they all do, German passes these as their
 * existing `labels` overrides (from `league-hub/shared`, `enums`, `content`
 * and the hub's own table letters); English passes nothing (null), so they
 * render exactly as on the phase pages and /insights. The sweep deletes this
 * function and `league-hub/shared` once every default is localized.
 */
export interface HubSharedLabels {
  bracket: BracketCopy;
  resultsGrid: RoundRobinTableLabels;
  ruleset: RulesetDetailLabels;
  insights: ScopedInsightsLabels;
}

function buildShared(locale: Locale): HubSharedLabels {
  const copy = leagueHubCopy(locale);
  const shared = getMessages(leagueHubSharedMessages, locale);
  const t = createTranslator(leagueHubSharedMessages, locale);
  const enums = getMessages(enumMessages, locale);
  const pagination: TablePaginationLabels = { ...shared.pagination };
  return {
    bracket: {
      labels: {
        winnersBracket: enums.bracketSide.winners,
        losersBracket: enums.bracketSide.losers,
        grandFinals: enums.bracketSide.grand_finals,
        noRounds: shared.bracket.noRounds,
        tbd: shared.bracket.tbd,
        match: shared.bracket.match,
        tbdMatch: shared.bracket.tbdMatch,
        matchStatus: { ...enums.matchStatus },
        lossesShort: copy.table.losses,
        lossesEntering: shared.bracket.lossesEntering,
      },
      roundName: (name) => translateEngineLabel('round', name, locale),
      slotLabel: (label) => translateEngineLabel('slot', label, locale),
    },
    resultsGrid: {
      player: copy.table.trainer,
      win: copy.table.wins,
      loss: copy.table.losses,
      draw: copy.table.draws,
    },
    ruleset: {
      ...shared.ruleset,
      sharedTypeRule: (percent) => t('ruleset.sharedTypeRule', { percent }),
    },
    insights: {
      tabs: { ...shared.insightsTabs },
      usage: { ...shared.usage, pagination },
      kills: { ...shared.kills, pagination },
      moves: { ...shared.moves },
    },
  };
}

let germanShared: HubSharedLabels | undefined;

export function hubSharedLabels(locale: Locale): HubSharedLabels | null {
  if (locale === 'en') return null;
  germanShared ??= buildShared(locale);
  return germanShared;
}
