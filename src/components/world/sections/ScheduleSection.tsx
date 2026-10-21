import Link from 'next/link';
import SectionShell from '@/components/world/SectionShell';
import { PANEL, TABLE_HEAD, FOCUS_RING } from '@/components/world/panel';
import { createTranslator } from '@/i18n/core';
import { enumLabel } from '@/i18n/content/enum-label';
import { LocalTime } from '@/i18n/LocalTime';
import { enumMessages } from '@/i18n/messages/enums';
import { worldMessages } from '@/i18n/messages/world';
import type { ThemeRouteData, ThemeSectionCopy, WorldLocaleProps } from './types';

/**
 * #schedule — the competitive record in the viewer's language: upcoming fixtures grouped by
 * stage, the latest results with scores, and the full standings table.
 *
 * Server component reading only the contract's rows — no read-time
 * `battle_stats` scan. Every fixture links to its stable match URL, and the
 * standings render in full rather than as a preview, so this section is the
 * complete task surface for the schedule even with WebGL unavailable.
 */

/** Results are capped so a long season stays scannable; the cap is disclosed. */
const RESULTS_CAP = 10;

type Fixture = ThemeRouteData['fixtures'][number];

/** Kickoff (else played-at) in the viewer's zone — never formatted on the server (§1.5 T2). */
function When({ fixture }: { fixture: Fixture }) {
  const stamp = fixture.match.scheduled_at ?? fixture.match.date_played;
  if (!stamp) return <>—</>;
  return <LocalTime value={stamp} preset="dateTimeYear" />;
}

function matchHref(fixture: Fixture): string {
  return `/tournaments/${fixture.match.tournament_id}/matches/${fixture.match.id}`;
}

function score(fixture: Fixture): string {
  const home = fixture.match.games.filter((g) => g.winner_id === fixture.match.player_1_id).length;
  const away = fixture.match.games.filter((g) => g.winner_id === fixture.match.player_2_id).length;
  return `${home}:${away}`;
}

/** Group by stage name, preserving the order stages first appear. */
function byStage(fixtures: Fixture[]): [string, Fixture[]][] {
  const order: string[] = [];
  const grouped = new Map<string, Fixture[]>();
  for (const fixture of fixtures) {
    const key = fixture.stageName;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(fixture);
    else {
      grouped.set(key, [fixture]);
      order.push(key);
    }
  }
  return order.map((stage) => [stage, grouped.get(stage) ?? []]);
}

export default function ScheduleSection({
  data,
  copy,
  locale = 'en',
}: {
  data: ThemeRouteData;
  copy: ThemeSectionCopy;
} & WorldLocaleProps) {
  const t = createTranslator(worldMessages, locale);
  const enums = createTranslator(enumMessages, locale);
  const { fixtures, standings } = data;

  const upcoming = byStage(
    fixtures
      .filter((f) => f.match.status !== 'completed')
      .sort((a, b) => (a.match.scheduled_at ?? '').localeCompare(b.match.scheduled_at ?? '')),
  );
  const completedFixtures = fixtures
    .filter((f) => f.match.status === 'completed')
    .sort((a, b) => (b.match.date_played ?? '').localeCompare(a.match.date_played ?? ''));
  const results = completedFixtures.slice(0, RESULTS_CAP);

  return (
    <SectionShell id="schedule" heading={t('schedule.heading')}>
      <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
        <div className={`${PANEL} p-5`}>
          <h3 className="font-heading text-sm font-bold uppercase tracking-wide text-arena-accent-strong">
            {t('schedule.upcoming', { where: copy.scheduleUpcomingPainted })}
          </h3>
          {upcoming.length === 0 ? (
            <p className="mt-3 text-sm text-arena-ink-secondary">{t('schedule.nothingScheduled')}</p>
          ) : (
            <div className="mt-3 space-y-4">
              {upcoming.map(([stage, rows]) => (
                <section key={stage} aria-label={t('schedule.stageFixtures', { stage })}>
                  <h4 className="font-heading text-xs font-bold uppercase tracking-wide text-arena-ink-secondary">
                    {stage}
                  </h4>
                  <ul className="mt-1.5 space-y-2">
                    {rows.map((fixture) => (
                      <li key={fixture.match.id} className="text-sm">
                        <Link
                          href={matchHref(fixture)}
                          className={`font-semibold text-arena-ink underline-offset-2 hover:underline ${FOCUS_RING}`}
                        >
                          {t('pairing', { home: fixture.match.player_1_name, away: fixture.match.player_2_name })}
                        </Link>
                        <span className="block text-xs text-arena-ink-secondary">
                          <When fixture={fixture} /> · {enumLabel(enums, 'matchStatus', fixture.match.status)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        <div className={`${PANEL} p-5`}>
          <h3 className="font-heading text-sm font-bold uppercase tracking-wide text-arena-accent-strong">
            {t('schedule.latestResults')}
          </h3>
          {results.length === 0 ? (
            <p className="mt-3 text-sm text-arena-ink-secondary">{t('noResults')}</p>
          ) : (
            <>
              <ul className="mt-3 space-y-2">
                {results.map((fixture) => (
                  <li key={fixture.match.id} className="flex items-baseline gap-2 text-sm">
                    <Link
                      href={matchHref(fixture)}
                      className={`flex-1 font-semibold text-arena-ink underline-offset-2 hover:underline ${FOCUS_RING}`}
                    >
                      {t('pairing', { home: fixture.match.player_1_name, away: fixture.match.player_2_name })}
                    </Link>
                    <span className="font-heading font-bold text-arena-accent-strong">
                      {score(fixture)}
                    </span>
                  </li>
                ))}
              </ul>
              {completedFixtures.length > results.length && (
                <p className="mt-3 text-xs text-arena-ink-secondary">
                  {t('schedule.showingRecent', { shown: results.length, total: completedFixtures.length })}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className={`${PANEL} mt-4 max-w-5xl overflow-hidden`}>
        <h3 className="border-b border-arena-border px-5 py-3 font-heading text-sm font-bold uppercase tracking-wide text-arena-accent-strong">
          {t('schedule.fullStandings')}
        </h3>
        {standings.length === 0 ? (
          <p className="px-5 py-4 text-sm text-arena-ink-secondary">{t('noResults')}</p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">{t('standings.caption')}</caption>
            <thead className={TABLE_HEAD}>
              <tr>
                <th scope="col" className="w-12 px-5 py-2 text-left font-semibold">
                  #
                </th>
                <th scope="col" className="px-2 py-2 text-left font-semibold">
                  {t('standings.trainer')}
                </th>
                <th scope="col" className="w-20 px-2 py-2 text-right font-semibold">
                  {t('standings.winLoss')}
                </th>
                <th scope="col" className="w-16 px-2 py-2 text-right font-semibold">
                  {t('standings.points')}
                </th>
                <th scope="col" className="w-20 px-5 py-2 text-right font-semibold">
                  {t('standings.move')}
                </th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row, i) => (
                <tr
                  key={row.player_id}
                  className="border-b border-arena-border/60 last:border-b-0 odd:bg-arena-elevated/40"
                >
                  <th
                    scope="row"
                    className="px-5 py-2 text-left font-heading font-bold text-arena-accent-strong"
                  >
                    {i + 1}
                  </th>
                  <td className="px-2 py-2 font-semibold text-arena-ink">{row.player_name}</td>
                  <td className="px-2 py-2 text-right text-arena-ink-secondary">
                    {row.wins}–{row.losses}
                  </td>
                  <td className="px-2 py-2 text-right font-heading font-bold text-arena-ink">
                    {row.points}
                  </td>
                  <td className="px-5 py-2 text-right">
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
    </SectionShell>
  );
}
