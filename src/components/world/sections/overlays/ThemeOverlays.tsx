import { Suspense, type ReactNode } from 'react';
import OverlaySwitch from '@/components/world/route/focus/OverlaySwitch';
import { ROSTER_BOARD_VALUE } from '@/components/world/route/focus/overlay-keys';
import BoardPanel, { boardPanelTitle, type BoardPanelKind } from './BoardPanel';
import LinePanel, { linePanelTitle } from './LinePanel';
import RulesPanel, { rulesPanelTitle } from './RulesPanel';
import TeamPanel, { teamPanelTitle } from './TeamPanel';
import RosterListPanel, { type RosterListRow } from './RosterListPanel';
import { priceBandLabel } from '@/lib/route-world/board-text';
import type { EvolutionTracker } from '@/types/evolution';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { WorldRosterTile } from '@/lib/worlds/route-data';
import type { PublicParticipant } from '@/lib/players/public-player';
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { worldMessages } from '@/i18n/messages/world';
import { compareTrackersForDisplay } from '@/lib/draft-ui/progress-display';
import { rulesCopyContext } from '../rules-context';
import type { RulesCopyFn, ThemeRouteData, WorldLocaleProps } from '../types';

interface ThemeOverlaysProps extends WorldLocaleProps {
  data: ThemeRouteData;
  /** The theme's own plaque painter, so panel and painted gate never disagree. */
  rulesCopy: RulesCopyFn;
}

const BOARD_KINDS: BoardPanelKind[] = ['pulse', 'schedule'];
/** Each theme mounts one gate plaque as its rules subject; its value is fixed. */
const RULE_VALUES = ['gate'] as const;

/** One param's server-rendered overlay bodies and their accessible titles. */
export interface OverlayMaps {
  contents: Record<string, ReactNode>;
  titles: Record<string, string>;
}

export interface ThemeOverlayMaps {
  team: OverlayMaps;
  mon: OverlayMaps;
  board: OverlayMaps;
  rules: OverlayMaps;
}

/**
 * The `?board=roster` rows from the contract's `rosterTiles` — the SAME list
 * the #roster section renders and the frieze paints the head of, so the
 * panel's row count is the section's and the painted "OF N". Point-buy tiles
 * (`price !== null`, the `deriveRosterTiles` discriminator) link their
 * `?mon=` line panel; participant-fallback tiles link the trainer's `?team=`
 * panel (the team map is keyed by the same participant id). Band words are
 * the boards' own vocabulary in the viewer's language (`priceBandLabel`). Pure.
 */
export function rosterRowsFromTiles(
  tiles: readonly WorldRosterTile[],
  participants: readonly PublicParticipant[],
  locale: Locale = 'en',
): RosterListRow[] {
  const trainerById = new Map(participants.map((participant) => [participant.id, participant.name]));
  return tiles.map((tile) => {
    const isLine = tile.price !== null;
    const trainer = isLine ? null : (trainerById.get(tile.id) ?? null);
    return {
      id: tile.id,
      line: tile.line,
      name: tile.name,
      band: tile.band,
      bandLabel: priceBandLabel(tile.band, locale),
      price: tile.price,
      sprite: isLine,
      trainer,
      href: isLine
        ? `?mon=${encodeURIComponent(tile.id)}`
        : trainer !== null
          ? `?team=${encodeURIComponent(tile.id)}`
          : null,
    };
  });
}

/**
 * Pure builder for the four param → panel maps. Exported so the keying rules
 * (participant ids for `team`, entry ids for `mon`, fixed value sets for
 * `board` (pulse, schedule, roster) / `rules`, nothing for unknown values)
 * are unit-testable without a DOM. An empty `entries` list yields an empty `mon` map — the correct
 * behavior for formats without a point-buy list.
 */
export function buildThemeOverlayMaps(
  data: ThemeRouteData,
  rulesCopy: RulesCopyFn,
  { locale = 'en', dataLocale = locale }: WorldLocaleProps = {},
): ThemeOverlayMaps {
  const t = createTranslator(worldMessages, locale);
  const {
    league,
    stages,
    participants,
    entries,
    trackers,
    teamAces,
    standings,
    fixtures,
    formatRules,
    rulesetName,
    rosterTiles,
  } = data;

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

  // First row per player wins — the standings order is the table order, so the
  // index doubles as the rank the panel shows.
  const standingByPlayer = new Map<string, ThemeRouteData['standings'][number]>();
  const rankByPlayer = new Map<string, number>();
  standings.forEach((row, index) => {
    if (!standingByPlayer.has(row.player_id)) {
      standingByPlayer.set(row.player_id, row);
      rankByPlayer.set(row.player_id, index + 1);
    }
  });

  const team: OverlayMaps = { contents: {}, titles: {} };
  for (const participant of participants) {
    const owned = trackersByPlayer.get(participant.id) ?? [];
    // Same ace derivation as TeamsSection: best evolved line where tracked
    // (stage, then self-earned KOs, then total progress — draft-frontend
    // §8.3), else the team-derived ace, else nothing to name.
    const ace =
      owned.length > 0
        ? [...owned].sort(compareTrackersForDisplay)[0].current_form
        : (teamAces[participant.id] ?? null);
    team.contents[participant.id] = (
      <TeamPanel
        participant={participant}
        standing={standingByPlayer.get(participant.id) ?? null}
        rank={rankByPlayer.get(participant.id) ?? null}
        ace={ace}
        lines={owned}
        entryByBase={entryByBase}
        locale={locale}
        dataLocale={dataLocale}
      />
    );
    team.titles[participant.id] = teamPanelTitle(participant, locale);
  }

  const mon: OverlayMaps = { contents: {}, titles: {} };
  for (const entry of entries) {
    mon.contents[entry.id] = <LinePanel entry={entry} locale={locale} dataLocale={dataLocale} />;
    mon.titles[entry.id] = linePanelTitle(entry, locale, dataLocale);
  }

  const board: OverlayMaps = { contents: {}, titles: {} };
  for (const kind of BOARD_KINDS) {
    board.contents[kind] = (
      <BoardPanel
        kind={kind}
        league={league}
        stages={stages}
        standings={standings}
        fixtures={fixtures}
        locale={locale}
      />
    );
    board.titles[kind] = boardPanelTitle(kind, stages, locale);
  }
  board.contents[ROSTER_BOARD_VALUE] = (
    <RosterListPanel rows={rosterRowsFromTiles(rosterTiles, participants, locale)} />
  );
  board.titles[ROSTER_BOARD_VALUE] = rosterTiles.some((tile) => tile.price !== null)
    ? t('overlays.rosterLines')
    : t('overlays.roster');

  const rules: OverlayMaps = { contents: {}, titles: {} };
  const rulesContext = rulesCopyContext({ league, stages });
  for (const value of RULE_VALUES) {
    rules.contents[value] = (
      <RulesPanel
        formatRules={formatRules}
        rulesetName={rulesetName}
        rulesCopy={rulesCopy}
        context={rulesContext}
        leagueId={league.id}
        locale={locale}
      />
    );
    rules.titles[value] = rulesPanelTitle(locale);
  }

  return { team, mon, board, rules };
}

/**
 * Wires the isle route themes' focus panels to their search params, in the
 * viewer's language (the close button follows it too):
 * `?team=<player id>` → TeamPanel, `?mon=<line id>` → LinePanel,
 * `?board=pulse|schedule` → BoardPanel, `?board=roster` → RosterListPanel
 * (every roster line), `?rules=gate` → RulesPanel. All
 * content is server-rendered from page-loaded data (no client fetching);
 * OverlaySwitch + ContextOverlay handle the param-driven native <dialog>.
 * Each OverlaySwitch needs its own <Suspense> boundary because it uses
 * useSearchParams (Next.js 16 rule). Values absent from a map render nothing.
 */
export default function ThemeOverlays({ data, rulesCopy, locale = 'en', dataLocale = locale }: ThemeOverlaysProps) {
  const maps = buildThemeOverlayMaps(data, rulesCopy, { locale, dataLocale });

  return (
    <>
      <Suspense fallback={null}>
        <OverlaySwitch
          paramName="team"
          contents={maps.team.contents}
          titles={maps.team.titles}
        />
      </Suspense>
      <Suspense fallback={null}>
        <OverlaySwitch
          paramName="mon"
          contents={maps.mon.contents}
          titles={maps.mon.titles}
        />
      </Suspense>
      <Suspense fallback={null}>
        <OverlaySwitch
          paramName="board"
          contents={maps.board.contents}
          titles={maps.board.titles}
        />
      </Suspense>
      <Suspense fallback={null}>
        <OverlaySwitch
          paramName="rules"
          contents={maps.rules.contents}
          titles={maps.rules.titles}
        />
      </Suspense>
    </>
  );
}
