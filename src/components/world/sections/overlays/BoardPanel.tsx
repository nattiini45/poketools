import { PANEL_INSET, TABLE_HEAD } from '@/components/world/panel';
import { createTranslator, type Translator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { enumLabel } from '@/i18n/content/enum-label';
import { LocalTime } from '@/i18n/LocalTime';
import { enumMessages } from '@/i18n/messages/enums';
import { worldMessages } from '@/i18n/messages/world';
import type { SeasonWithDetails } from '@/types/season';
import type { TournamentWithDetails } from '@/types/tournament';
import { currentStage } from '../rules-context';
import type { ThemeRouteData, WorldLocaleProps } from '../types';

type StandingRow = ThemeRouteData['standings'][number];
type FixtureRow = ThemeRouteData['fixtures'][number];
type WorldT = Translator<typeof worldMessages.en>;
type EnumT = Translator<typeof enumMessages.en>;

export type BoardPanelKind = 'pulse' | 'schedule';

interface BoardPanelProps extends WorldLocaleProps {
  kind: BoardPanelKind;
  league: SeasonWithDetails;
  stages: TournamentWithDetails[];
  standings: StandingRow[];
  fixtures: FixtureRow[];
}

export function boardPanelTitle(
  kind: BoardPanelKind,
  stages: TournamentWithDetails[],
  locale: Locale = 'en',
): string {
  const t = createTranslator(worldMessages, locale);
  const active = stages.find((stage) => stage.status === 'active');
  if (kind === 'pulse') return t('board.standingsTitle');
  return active
    ? t('board.scheduleTitleActive', { stage: active.name, round: active.current_round })
    : t('board.scheduleTitle');
}

/** Kickoff (else played-at) in the viewer's zone — never formatted on the server (§1.5 T2). */
function When({ fixture }: { fixture: FixtureRow }) {
  const stamp = fixture.match.scheduled_at ?? fixture.match.date_played;
  if (!stamp) return <>—</>;
  return <LocalTime value={stamp} preset="dateTimeYear" />;
}

function score(fixture: FixtureRow): string {
  const home = fixture.match.games.filter((g) => g.winner_id === fixture.match.player_1_id).length;
  const away = fixture.match.games.filter((g) => g.winner_id === fixture.match.player_2_id).length;
  return `${home}:${away}`;
}

function FixtureRows({ fixtures, t, enums }: { fixtures: FixtureRow[]; t: WorldT; enums: EnumT }) {
  return (
    <ul className="mt-2 space-y-1">
      {fixtures.map((fixture) => {
        const live = fixture.match.status === 'in_progress';
        return (
          <li key={fixture.match.id} className={`px-3 py-2 ${PANEL_INSET}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate font-medium text-arena-ink">
                {t('pairing', { home: fixture.match.player_1_name, away: fixture.match.player_2_name })}
              </span>
              {fixture.match.status === 'completed' && (
                <span className="flex-none font-semibold tabular-nums text-arena-ink">
                  {score(fixture)}
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-xs">
              <span
                className={`rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide ${
                  live
                    ? 'bg-arena-accent text-white'
                    : 'border border-arena-border text-arena-ink-secondary'
                }`}
              >
                {enumLabel(enums, 'matchStatus', fixture.match.status)}
              </span>
              <span className="text-arena-ink-secondary">
                <When fixture={fixture} />
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Body of the `?board=pulse|schedule` overlay for the isle route themes:
 * the full standings behind the pulse board, the active stage's fixtures
 * behind the schedule board. The plaza has its own glass register
 * (`BoardFocusPanel`); the tables here are the shared section kit's — same
 * rows, same tiebreak-free contract values, in the viewer's language.
 *
 * Server component; pure props-in, no data fetching.
 */
export default function BoardPanel({ kind, league, stages, standings, fixtures, locale = 'en' }: BoardPanelProps) {
  const t = createTranslator(worldMessages, locale);
  const enums = createTranslator(enumMessages, locale);
  const active = currentStage(stages);
  const live = fixtures.find((fixture) => fixture.match.status === 'in_progress') ?? null;

  if (kind === 'pulse') {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-arena-ink-secondary">
          {league.name}
          {active ? ` · ${active.name}` : ''} · {t('pulse.trainers', { count: league.participant_count })}
        </p>
        {live && (
          <p className={`px-3 py-2 text-arena-ink ${PANEL_INSET}`}>
            <span className="font-semibold text-arena-live">{t('board.liveNow')}</span>{' '}
            {t('pairing', { home: live.match.player_1_name, away: live.match.player_2_name })}
          </p>
        )}
        {standings.length === 0 ? (
          <p className="text-arena-ink-secondary">{t('board.noCompleted')}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t('standings.caption')}</caption>
            <thead className={TABLE_HEAD}>
              <tr>
                <th scope="col" className="w-10 px-2 py-1.5 font-semibold">#</th>
                <th scope="col" className="px-2 py-1.5 font-semibold">{t('standings.trainer')}</th>
                <th scope="col" className="w-16 px-2 py-1.5 text-right font-semibold">{t('standings.winLoss')}</th>
                <th scope="col" className="w-14 px-2 py-1.5 text-right font-semibold">{t('standings.points')}</th>
                <th scope="col" className="w-16 px-2 py-1.5 text-right font-semibold">{t('standings.move')}</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row, index) => (
                <tr key={row.player_id} className="border-b border-arena-border/60 last:border-b-0">
                  <th
                    scope="row"
                    className="px-2 py-1.5 text-left font-heading font-bold text-arena-accent-strong"
                  >
                    {index + 1}
                  </th>
                  <td className="max-w-[10rem] truncate px-2 py-1.5 font-medium text-arena-ink">
                    {row.player_name}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-arena-ink-secondary">
                    {row.wins}–{row.losses}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-arena-ink">
                    {row.points}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {row.rank_change === null || row.rank_change === 0 ? (
                      <span className="text-xs text-arena-ink-secondary" aria-label={t('standings.noMovement')}>
                        —
                      </span>
                    ) : (
                      <span
                        className={`text-xs font-bold ${row.rank_change > 0 ? 'text-arena-live' : 'text-arena-accent-strong'}`}
                        aria-label={t(row.rank_change > 0 ? 'standings.up' : 'standings.down', {
                          count: Math.abs(row.rank_change),
                        })}
                      >
                        {row.rank_change > 0 ? `▲${row.rank_change}` : `▼${-row.rank_change}`}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  const stageFixtures = active ? fixtures.filter((f) => f.stageId === active.id) : fixtures;
  const open = stageFixtures.filter((f) => f.match.status !== 'completed');
  const played = stageFixtures
    .filter((f) => f.match.status === 'completed')
    .sort((a, b) => (b.match.date_played ?? '').localeCompare(a.match.date_played ?? ''));

  return (
    <div className="space-y-4 text-sm">
      <p className="text-arena-ink-secondary">
        {league.name}
        {active ? ` · ${t('board.matchdayLine', { stage: active.name, round: active.current_round })}` : ''}
      </p>
      <section aria-label={t('board.upcomingFixtures')}>
        <h3 className="font-heading text-xs font-bold uppercase tracking-wide text-arena-accent-strong">
          {t('board.upcoming')}
        </h3>
        {open.length === 0 ? (
          <p className="mt-2 text-arena-ink-secondary">{t('schedule.nothingScheduled')}</p>
        ) : (
          <FixtureRows fixtures={open} t={t} enums={enums} />
        )}
      </section>
      <section aria-label={t('board.completedFixtures')}>
        <h3 className="font-heading text-xs font-bold uppercase tracking-wide text-arena-accent-strong">
          {t('board.results')}
        </h3>
        {played.length === 0 ? (
          <p className="mt-2 text-arena-ink-secondary">{t('board.noResultsYet')}</p>
        ) : (
          <FixtureRows fixtures={played} t={t} enums={enums} />
        )}
      </section>
    </div>
  );
}
