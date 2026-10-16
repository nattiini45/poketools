import type { Standing } from '@/lib/tournament/types';
import type { LeagueFixture } from '@/lib/supabase/queries/league-standings';
import type { SeasonWithDetails } from '@/types/season';
import type { TournamentWithDetails } from '@/types/tournament';
import { currentStage } from '@/components/world/sections/rules-context';
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { commonMessages } from '@/i18n/messages/common';
import { worldEvoligaMessages } from '@/i18n/messages/world/evoliga';
import FixtureList from './FixtureList';
import StandingsTable from './StandingsTable';
import type { EvoligaLocaleProps } from './types';

export type BoardPanelKind = 'pulse' | 'schedule';

interface BoardFocusPanelProps extends EvoligaLocaleProps {
  kind: BoardPanelKind;
  league: SeasonWithDetails;
  stages: TournamentWithDetails[];
  standings: Standing[];
  fixtures: LeagueFixture[];
}

/**
 * Tab chip in the ZA register: the shoulder-flanked row above the schedule
 * pages (`04-za-requests-ui.png`). A sibling radio drives the selected state,
 * so the docked panel stays a server component — no client JS for paging.
 */
const TAB =
  'row-start-1 cursor-pointer rounded-full px-2 py-1.5 text-center text-[0.7rem] font-semibold ' +
  'uppercase tracking-wide text-arena-ink-secondary transition-colors duration-150 ' +
  'hover:bg-[var(--hud-chip-hover)] hover:text-arena-ink motion-reduce:transition-none';

/** ZA `L`/`R` shoulder glyph: which trigger pages the panel on a controller. */
const SHOULDER =
  'row-start-1 select-none rounded-md border border-arena-border px-1.5 py-0.5 text-[0.6rem] ' +
  'font-bold text-arena-ink-secondary';

export function boardPanelTitle(kind: BoardPanelKind, stages: TournamentWithDetails[], locale: Locale): string {
  const t = createTranslator(worldEvoligaMessages, locale);
  const active = stages.find((stage) => stage.status === 'active');
  if (kind === 'pulse') return t('board.pulseTitle');
  return active
    ? t('board.scheduleTitleActive', { stage: active.name, round: active.current_round })
    : t('board.scheduleTitle');
}

/**
 * Body of the `?board=pulse|schedule` Focus panel (ADR-0003): the full
 * standings behind the PULS board, the current stage's fixtures behind the
 * SPIELPLAN board. Reuses the #schedule components so the DOM section and
 * the in-world panel never disagree. Server component.
 */
export default function BoardFocusPanel({ kind, league, stages, standings, fixtures, locale }: BoardFocusPanelProps) {
  const t = createTranslator(worldEvoligaMessages, locale);
  const common = createTranslator(commonMessages, locale);
  const active = currentStage(stages);
  const live = fixtures.find((fixture) => fixture.match.status === 'in_progress') ?? null;

  if (kind === 'pulse') {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-arena-ink-secondary">
          {league.name}
          {active ? ` · ${active.name}` : ''} · {t('board.participants', { count: league.participant_count })}
        </p>
        {live && (
          <p className="rounded-lg border border-arena-border bg-arena-elevated px-3 py-2 text-arena-ink">
            <span className="font-semibold text-arena-live">{t('board.liveNow')}</span> {live.match.player_1_name}
            <span className="mx-1.5 text-arena-ink-secondary">{common('versus')}</span>
            {live.match.player_2_name}
          </p>
        )}
        <StandingsTable standings={standings} compact locale={locale} />
      </div>
    );
  }

  const stageFixtures = active ? fixtures.filter((fixture) => fixture.stageId === active.id) : fixtures;
  const open = stageFixtures.filter(
    (fixture) => fixture.match.status === 'scheduled' || fixture.match.status === 'in_progress',
  );
  // Section 8's post-threshold states count as played here — the SPIELPLAN
  // board collapses `pending_confirmation`/`disputed` to `beendet`
  // (`FIXTURE_STATUS` in board-content.ts), and the glass FixtureList keeps
  // their own pills ('Beendet'/'Strittig') so the panel surfaces the
  // exception the board collapses. Leaving them out of BOTH tabs hid every
  // finished-but-unconfirmed match from the docked panel. Sort fallback
  // mirrors board-content.ts: played-at, else kickoff.
  const played = [...stageFixtures]
    .filter(
      (fixture) =>
        fixture.match.status === 'completed' ||
        fixture.match.status === 'pending_confirmation' ||
        fixture.match.status === 'disputed',
    )
    .sort((a, b) =>
      (b.match.date_played ?? b.match.scheduled_at ?? '').localeCompare(
        a.match.date_played ?? a.match.scheduled_at ?? '',
      ),
    );

  return (
    <div className="space-y-3 text-sm">
      <p className="text-arena-ink-secondary">
        {league.name}
        {active ? ` · ${t('board.matchdayLine', { stage: active.name, round: active.current_round })}` : ''}
      </p>
      <fieldset className="grid grid-cols-[auto_1fr_1fr_1fr_auto] items-center gap-x-1 gap-y-3">
        <legend className="sr-only">{t('board.chooseView')}</legend>
        <input
          type="radio"
          name="board-schedule-page"
          id="board-schedule-page-spielplan"
          defaultChecked
          className="peer/spielplan sr-only"
        />
        <input
          type="radio"
          name="board-schedule-page"
          id="board-schedule-page-tabelle"
          className="peer/tabelle sr-only"
        />
        <input
          type="radio"
          name="board-schedule-page"
          id="board-schedule-page-ergebnisse"
          className="peer/ergebnisse sr-only"
        />

        <span aria-hidden="true" className={`col-start-1 ${SHOULDER}`}>
          L
        </span>
        <label
          htmlFor="board-schedule-page-spielplan"
          className={`col-start-2 ${TAB} peer-checked/spielplan:bg-[var(--hud-chip-active)] peer-checked/spielplan:text-[var(--hud-chip-active-ink)] peer-checked/spielplan:shadow-[inset_0_0_0_1px_var(--hud-chip-active-ring)] peer-focus-visible/spielplan:outline peer-focus-visible/spielplan:outline-2 peer-focus-visible/spielplan:outline-offset-2 peer-focus-visible/spielplan:outline-arena-focus`}
        >
          {t('board.tabSchedule')}
        </label>
        <label
          htmlFor="board-schedule-page-tabelle"
          className={`col-start-3 ${TAB} peer-checked/tabelle:bg-[var(--hud-chip-active)] peer-checked/tabelle:text-[var(--hud-chip-active-ink)] peer-checked/tabelle:shadow-[inset_0_0_0_1px_var(--hud-chip-active-ring)] peer-focus-visible/tabelle:outline peer-focus-visible/tabelle:outline-2 peer-focus-visible/tabelle:outline-offset-2 peer-focus-visible/tabelle:outline-arena-focus`}
        >
          {t('board.tabTable')}
        </label>
        <label
          htmlFor="board-schedule-page-ergebnisse"
          className={`col-start-4 ${TAB} peer-checked/ergebnisse:bg-[var(--hud-chip-active)] peer-checked/ergebnisse:text-[var(--hud-chip-active-ink)] peer-checked/ergebnisse:shadow-[inset_0_0_0_1px_var(--hud-chip-active-ring)] peer-focus-visible/ergebnisse:outline peer-focus-visible/ergebnisse:outline-2 peer-focus-visible/ergebnisse:outline-offset-2 peer-focus-visible/ergebnisse:outline-arena-focus`}
        >
          {t('board.tabResults')}
        </label>
        <span aria-hidden="true" className={`col-start-5 ${SHOULDER}`}>
          R
        </span>

        <div className="col-span-5 row-start-2 hidden peer-checked/spielplan:block">
          <FixtureList fixtures={open} variant="glass" locale={locale} />
        </div>
        <div className="col-span-5 row-start-2 hidden peer-checked/tabelle:block">
          <StandingsTable standings={standings} variant="glass" locale={locale} />
        </div>
        <div className="col-span-5 row-start-2 hidden peer-checked/ergebnisse:block">
          {played.length > 0 ? (
            <FixtureList fixtures={played} variant="glass" locale={locale} />
          ) : (
            <p className="mt-2 text-arena-ink-secondary">{t('board.noResults')}</p>
          )}
        </div>
      </fieldset>
    </div>
  );
}
