import { Suspense, type ReactNode } from 'react';
import OverlaySwitch from '@/components/world/route/focus/OverlaySwitch';
import { ROSTER_BOARD_VALUE } from '@/components/world/route/focus/overlay-keys';
import BoardFocusPanel, { boardPanelTitle, type BoardPanelKind } from './BoardFocusPanel';
import TeamFocusPanel, { teamPanelTitle } from './TeamFocusPanel';
import LineFocusPanel, { linePanelTitle } from './LineFocusPanel';
import RulesFocusPanel, { rulesPanelTitle } from './RulesFocusPanel';
import RosterListPanel, { type RosterListRow } from '@/components/world/sections/overlays/RosterListPanel';
import { rulesCopyContext } from '@/components/world/sections/rules-context';
import { priceBandLabel } from '@/lib/route-world/board-text';
import type { FormatRules } from '@/types/format-rules';
import type { SeasonWithDetails } from '@/types/season';
import type { PublicParticipant } from '@/lib/players/public-player';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { EvolutionTracker } from '@/types/evolution';
import type { TournamentWithDetails } from '@/types/tournament';
import type { Standing } from '@/lib/tournament/types';
import type { LeagueFixture } from '@/lib/supabase/queries/league-standings';
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { worldMessages } from '@/i18n/messages/world';
import type { EvoligaLocaleProps } from './types';

interface EvoligaOverlaysProps extends EvoligaLocaleProps {
  league: SeasonWithDetails;
  stages: TournamentWithDetails[];
  participants: PublicParticipant[];
  trackers: EvolutionTracker[];
  entries: PointBuyListEntry[];
  standings: Standing[];
  fixtures: LeagueFixture[];
  formatRules: FormatRules | null;
  /**
   * The contract's stage-fallback-aware ruleset name (season's, else the
   * first stage's — `assembleWorldRouteData`), the same value the #rules
   * section reads, so the docked rulebook and the DOM section can never
   * name different rulesets.
   */
  rulesetName: string | null;
}

const BOARD_KINDS: BoardPanelKind[] = ['pulse', 'schedule'];

/**
 * The `?board=roster` rows from the point-buy list — the same `entries` the
 * #roster RosterTable lists and the kiosk grid paints the head of, in list
 * order, so the panel's row count is the section's. Band words are the
 * plaza boards' own vocabulary in the viewer's language (`priceBandLabel`;
 * German GÜNSTIG keeps its umlaut). Every row links its `?mon=` line panel. Pure.
 */
export function plazaRosterRows(entries: readonly PointBuyListEntry[], locale: Locale): RosterListRow[] {
  return [...entries]
    .sort((a, b) => a.line_number - b.line_number)
    .map((entry) => ({
      id: entry.id,
      line: entry.line_number,
      name: entry.base_pokemon,
      band: entry.price_group,
      bandLabel: priceBandLabel(entry.price_group, locale),
      price: entry.price,
      sprite: true,
      trainer: null,
      href: `?mon=${encodeURIComponent(entry.id)}`,
    }));
}

/** Both gate plaques open the whole rulebook; the value records which one. */
const RULE_SIDES = ['left', 'right'] as const;

/**
 * Wires the Focus panels (ADR-0003) of the EvoLiga world to their search
 * params: `?team=<player id>` → TeamFocusPanel, `?mon=<line id>` →
 * LineFocusPanel, `?board=pulse|schedule` → BoardFocusPanel,
 * `?board=roster` → RosterListPanel (the whole Kaderliste),
 * `?rules=left|right` → RulesFocusPanel. All content is
 * server-rendered from page-loaded data (no client fetching); OverlaySwitch +
 * ContextOverlay handle the param-driven native <dialog>. Each OverlaySwitch
 * needs its own <Suspense> boundary because it uses useSearchParams
 * (Next.js 16 rule).
 *
 * Panel bodies live in their own files so each plaza station card owns one.
 * This file stays the DOM primary control for team/line details.
 */
export default function EvoligaOverlays({
  league,
  stages,
  participants,
  trackers,
  entries,
  standings,
  fixtures,
  formatRules,
  rulesetName,
  locale,
  dataLocale = locale,
}: EvoligaOverlaysProps) {
  const trackersByPlayer = new Map<string, EvolutionTracker[]>();
  for (const tracker of trackers) {
    const list = trackersByPlayer.get(tracker.player_id) ?? [];
    list.push(tracker);
    trackersByPlayer.set(tracker.player_id, list);
  }

  const entryByBase = new Map<string, PointBuyListEntry>();
  for (const entry of entries) {
    if (!entryByBase.has(entry.base_pokemon)) entryByBase.set(entry.base_pokemon, entry);
  }

  const standingByPlayer = new Map<string, Standing>();
  for (const standing of standings) {
    if (!standingByPlayer.has(standing.player_id)) standingByPlayer.set(standing.player_id, standing);
  }

  const teamContents: Record<string, ReactNode> = {};
  const teamTitles: Record<string, string> = {};
  for (const participant of participants) {
    teamContents[participant.id] = (
      <TeamFocusPanel
        participant={participant}
        lines={trackersByPlayer.get(participant.id) ?? []}
        entryByBase={entryByBase}
        standing={standingByPlayer.get(participant.id) ?? null}
        locale={locale}
        dataLocale={dataLocale}
      />
    );
    teamTitles[participant.id] = teamPanelTitle(participant, locale);
  }

  const lineContents: Record<string, ReactNode> = {};
  const lineTitles: Record<string, string> = {};
  for (const entry of entries) {
    lineContents[entry.id] = <LineFocusPanel entry={entry} locale={locale} dataLocale={dataLocale} />;
    lineTitles[entry.id] = linePanelTitle(entry, locale, dataLocale);
  }

  const boardContents: Record<string, ReactNode> = {};
  const boardTitles: Record<string, string> = {};
  for (const kind of BOARD_KINDS) {
    boardContents[kind] = (
      <BoardFocusPanel
        kind={kind}
        league={league}
        stages={stages}
        standings={standings}
        fixtures={fixtures}
        locale={locale}
      />
    );
    boardTitles[kind] = boardPanelTitle(kind, stages, locale);
  }
  // Always registered — with no list bound, or an empty one, the panel says so
  // (in the viewer's language), so the kiosk and the card CTA never dead-end.
  boardContents[ROSTER_BOARD_VALUE] = <RosterListPanel rows={plazaRosterRows(entries, locale)} />;
  boardTitles[ROSTER_BOARD_VALUE] = createTranslator(worldMessages, locale)('overlays.rosterLines');

  // The league's format picks the rulebook's body, never whether a row exists.
  const rulesContext = rulesCopyContext({ league, stages });
  const ruleContents: Record<string, ReactNode> = {};
  const ruleTitles: Record<string, string> = {};
  for (const side of RULE_SIDES) {
    ruleContents[side] = (
      <RulesFocusPanel
        side={side}
        formatRules={formatRules}
        rulesetName={rulesetName}
        context={rulesContext}
        leagueId={league.id}
        locale={locale}
        dataLocale={dataLocale}
      />
    );
    ruleTitles[side] = rulesPanelTitle(side, locale);
  }

  return (
    <>
      <Suspense fallback={null}>
        <OverlaySwitch paramName="team" contents={teamContents} titles={teamTitles} />
      </Suspense>
      <Suspense fallback={null}>
        <OverlaySwitch paramName="mon" contents={lineContents} titles={lineTitles} />
      </Suspense>
      <Suspense fallback={null}>
        <OverlaySwitch paramName="board" contents={boardContents} titles={boardTitles} />
      </Suspense>
      <Suspense fallback={null}>
        <OverlaySwitch paramName="rules" contents={ruleContents} titles={ruleTitles} />
      </Suspense>
    </>
  );
}
