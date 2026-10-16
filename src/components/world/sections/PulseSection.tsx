import Link from 'next/link';
import type { ReactNode } from 'react';
import SectionShell from '@/components/world/SectionShell';
import { PANEL, PANEL_INSET, FOCUS_RING } from '@/components/world/panel';
import { leagueDraftHref } from '@/lib/season/format-utils';
import { createTranslator } from '@/i18n/core';
import { LocalTime } from '@/i18n/LocalTime';
import { worldMessages } from '@/i18n/messages/world';
import { currentStage } from './rules-context';
import type { ThemeRouteData, ThemeSectionCopy, WorldLocaleProps } from './types';

/**
 * #pulse — the league's pulse: masthead, stage and matchday, the top of the
 * table with rank movement, the live match, the next kickoff, and the
 * draft-room call to action.
 *
 * Server component; every value arrives on the contract. The draft-room CTA is
 * gated on `hasDraftPool` — a real pool row — and never inferred from a bound
 * point-buy list, so a league that has a list but no pool does not advertise a
 * room that cannot open. It is gated on the format too (`leagueDraftHref`):
 * Evolution Point Buy opens the arena (`/draft-room`), the plain draft format
 * its draft page (`/draft`), and singles/doubles get no CTA even with a pool
 * row, because pool creation does not check the format.
 *
 * `children` (the league page's hub: standings, matches, group tables,
 * playoffs, insights, rules) renders under the masthead, outside the reveal
 * choreography (SectionShell `after`); the dev preview passes none.
 */
export default function PulseSection({
  data,
  copy,
  children,
  locale = 'en',
}: {
  data: ThemeRouteData;
  copy: ThemeSectionCopy;
  children?: ReactNode;
} & WorldLocaleProps) {
  const t = createTranslator(worldMessages, locale);
  const { league, stages, standings, fixtures, participants, hasDraftPool } = data;
  // The stage every world names (`currentStage`): active, else the next to
  // play, else (a finished league) the last.
  const active = currentStage(stages);
  const live = fixtures.find((fixture) => fixture.match.status === 'in_progress') ?? null;
  const next =
    fixtures
      .filter((f) => f.match.status === 'scheduled' && f.match.scheduled_at)
      .sort((a, b) => (a.match.scheduled_at ?? '').localeCompare(b.match.scheduled_at ?? ''))[0] ??
    null;
  const top = standings.slice(0, 4);
  const completed = fixtures.filter((f) => f.match.status === 'completed').length;
  const draftHref = hasDraftPool ? leagueDraftHref(league.id, league.format_type) : null;

  return (
    <SectionShell id="pulse" heading={t('pulse.heading')} after={children}>
      <div className={`max-w-4xl ${PANEL} p-6`}>
        <p className="font-heading text-xs font-bold uppercase tracking-wide text-arena-accent-strong">
          {t('pulse.kicker', { place: copy.place })}
        </p>
        <h3 className="mt-1 font-heading text-3xl font-bold tracking-tight text-arena-ink">
          {league.name}
        </h3>
        <p className="mt-2 text-sm text-arena-ink-secondary">
          {active
            ? t('pulse.stageLine', {
                stage: active.name,
                round: active.current_round,
                status: t.dynamic(`pulse.stageStatus.${active.status}`, undefined, active.status),
              })
            : t('pulse.noStage')}{' '}
          {t('pulse.trainers', { count: participants.length })} ·{' '}
          {t('pulse.matchesPlayed', { count: completed })}
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className={`${PANEL_INSET} p-4`}>
            <h4 className="font-heading text-sm font-bold uppercase tracking-wide text-arena-ink-secondary">
              {t('pulse.topOfTable')}
            </h4>
            <ul className="mt-2 space-y-1.5">
              {top.length === 0 && (
                <li className="text-sm text-arena-ink-secondary">{t('noResults')}</li>
              )}
              {top.map((row, i) => (
                <li key={row.player_id} className="flex items-center gap-3 text-sm">
                  <span className="w-5 font-heading font-bold text-arena-accent-strong">
                    {i + 1}
                  </span>
                  <span className="flex-1 font-semibold text-arena-ink">{row.player_name}</span>
                  {row.rank_change !== null && row.rank_change !== 0 && (
                    <span
                      className={`text-xs font-bold ${row.rank_change > 0 ? 'text-arena-live' : 'text-arena-accent-strong'}`}
                    >
                      {row.rank_change > 0 ? `▲${row.rank_change}` : `▼${-row.rank_change}`}
                    </span>
                  )}
                  <span className="w-14 text-right text-arena-ink-secondary">
                    {row.wins}–{row.losses}
                  </span>
                  <span className="w-10 text-right font-heading font-bold text-arena-ink">
                    {row.points}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-arena-ink-secondary">
              <Link
                href="#schedule"
                className={`underline underline-offset-2 hover:text-arena-ink ${FOCUS_RING}`}
              >
                {t('pulse.fullStandings')}
              </Link>
            </p>
          </div>

          <div className={`${PANEL_INSET} space-y-3 p-4`}>
            <h4 className="font-heading text-sm font-bold uppercase tracking-wide text-arena-ink-secondary">
              {t('pulse.nowNext')}
            </h4>
            {live ? (
              <p className="text-sm font-semibold text-arena-ink">
                <span className="mr-2 inline-block rounded bg-arena-accent px-1.5 py-0.5 text-xs font-bold uppercase text-white">
                  {t('pulse.live')}
                </span>
                <Link
                  href={`/tournaments/${live.match.tournament_id}/matches/${live.match.id}`}
                  className={`underline-offset-2 hover:underline ${FOCUS_RING}`}
                >
                  {t('pairing', { home: live.match.player_1_name, away: live.match.player_2_name })}
                </Link>
              </p>
            ) : (
              <p className="text-sm text-arena-ink-secondary">{t('pulse.noLive')}</p>
            )}
            {next?.match.scheduled_at && (
              <p className="text-sm text-arena-ink-secondary">
                {t.rich('pulse.nextKickoff', {
                  b: (chunks) => <strong className="font-semibold text-arena-ink">{chunks}</strong>,
                  home: next.match.player_1_name,
                  away: next.match.player_2_name,
                  // Viewer-zone time, hydration-safe (i18n-core §1.5 T2).
                  time: <LocalTime value={next.match.scheduled_at} preset="dateTimeYear" />,
                })}
              </p>
            )}
            {draftHref && (
              <p className="pt-1">
                <Link
                  href={draftHref}
                  className={`inline-flex items-center gap-2 rounded-lg bg-arena-accent px-3 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-arena-accent-strong motion-reduce:transition-none ${FOCUS_RING}`}
                >
                  {t('pulse.openDraftRoom')}
                  <span aria-hidden="true">→</span>
                </Link>
              </p>
            )}
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
