import Link from 'next/link';
import type { ReactNode } from 'react';
import SectionShell from '@/components/world/SectionShell';
import { PANEL, PANEL_INSET, FOCUS_RING } from '@/components/world/panel';
import { leagueDraftHref } from '@/lib/season/format-utils';
import { currentStage } from '@/components/world/sections/rules-context';
import { createTranslator } from '@/i18n/core';
import { enumLabel } from '@/i18n/content/enum-label';
import { LocalTime } from '@/i18n/LocalTime';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { worldEvoligaMessages } from '@/i18n/messages/world/evoliga';
import type { SeasonWithDetails } from '@/types/season';
import type { TournamentWithDetails } from '@/types/tournament';
import type { Standing } from '@/lib/tournament/types';
import type { LeagueFixture } from '@/lib/supabase/queries/league-standings';
import type { EvoligaLocaleProps } from './types';

interface PulseSectionProps extends EvoligaLocaleProps {
  league: SeasonWithDetails;
  stages: TournamentWithDetails[];
  standings: Standing[];
  fixtures: LeagueFixture[];
  /** True only when a draft pool exists for the season (a bound list alone is not enough). */
  hasDraftPool: boolean;
  /** The league page's hub (standings, matches, group stage, playoffs …), under the pulse panels. */
  children?: ReactNode;
}

/**
 * Status chip in the world's own dialect: `--world-live` for a running
 * season, the accent for one that has not started, a quiet outline for one
 * that is over. Kept local rather than using the shared `Badge` primitive so
 * the arena palette stays coherent inside the world shell. The label is the
 * shared `enums.seasonStatus` wording.
 */
function StatusChip({ status, label }: { status: string; label: string }) {
  const tone =
    status === 'active'
      ? 'border-arena-live text-arena-live'
      : status === 'upcoming'
        ? 'border-arena-accent text-arena-accent-strong'
        : 'border-arena-border text-arena-ink-secondary';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone}`}
    >
      {status === 'active' && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-arena-live motion-safe:animate-pulse"
        />
      )}
      {label}
    </span>
  );
}

/**
 * #pulse — season pulse: season identity, current stage, next fixture,
 * top-3 standings snapshot, and the draft room CTA when a pool exists and
 * the format has a draft page (`leagueDraftHref`: EPB the arena, the plain
 * draft format `/draft`, singles/doubles none — the plaza is reachable for
 * any format by pin or `?world=plaza`).
 * Server component; renders from page-loaded data only, in the viewer's language.
 */
export default function PulseSection({
  league,
  stages,
  standings,
  fixtures,
  hasDraftPool,
  children,
  locale,
}: PulseSectionProps) {
  const t = createTranslator(worldEvoligaMessages, locale);
  const common = createTranslator(commonMessages, locale);
  const glossary = createTranslator(glossaryMessages, locale);
  const enums = createTranslator(enumMessages, locale);
  const stage = currentStage(stages);

  const nextFixture =
    fixtures
      .filter((f) => f.match.status === 'scheduled' || f.match.status === 'in_progress')
      .sort((a, b) =>
        (a.match.scheduled_at ?? '').localeCompare(b.match.scheduled_at ?? ''),
      )[0] ?? null;

  const top3 = standings.filter((s) => s.wins + s.losses + s.draws > 0).slice(0, 3);
  const draftHref = hasDraftPool ? leagueDraftHref(league.id, league.format_type) : null;

  return (
    <SectionShell id="pulse" heading={t('pulse.heading')} after={children}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className={`${PANEL} p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-heading text-base font-semibold text-arena-ink">
              {league.name}
            </h3>
            <StatusChip status={league.status} label={enumLabel(enums, 'seasonStatus', league.status)} />
          </div>

          <dl className="mt-4 space-y-2 text-sm text-arena-ink-secondary">
            <div className="flex justify-between gap-4">
              <dt>{t('pulse.participants')}</dt>
              <dd className="font-semibold text-arena-ink">{league.participant_count}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>{t('pulse.currentStage')}</dt>
              <dd className="text-right text-arena-ink">
                {stage ? stage.name : t('pulse.noStage')}
              </dd>
            </div>
            {league.ruleset_name && (
              <div className="flex justify-between gap-4">
                <dt>{t('pulse.ruleset')}</dt>
                <dd className="text-right text-arena-ink">{league.ruleset_name}</dd>
              </div>
            )}
          </dl>

          {draftHref && (
            <Link
              href={draftHref}
              className={`mt-5 inline-flex items-center rounded-lg border border-arena-accent bg-arena-accent px-4 py-2 text-sm font-semibold text-arena-surface transition-colors duration-150 hover:bg-arena-accent-strong hover:border-arena-accent-strong motion-reduce:transition-none ${FOCUS_RING}`}
            >
              {glossary('draft.draftRoom')}
            </Link>
          )}
        </div>

        <div className="space-y-4">
          <div className={`${PANEL} p-5`}>
            <h3 className="font-heading text-sm font-semibold uppercase tracking-wide text-arena-ink-secondary">
              {t('pulse.nextMatch')}
            </h3>
            {nextFixture ? (
              <div className="mt-2">
                <p className="text-base text-arena-ink">
                  {nextFixture.match.player_1_name}
                  <span className="mx-2 text-arena-ink-secondary">{common('versus')}</span>
                  {nextFixture.match.player_2_name}
                </p>
                <p className="mt-1 text-xs text-arena-ink-secondary">
                  {nextFixture.stageName}
                  {nextFixture.match.scheduled_at && (
                    <>
                      {' · '}
                      <LocalTime value={nextFixture.match.scheduled_at} preset="date" />
                    </>
                  )}
                  {nextFixture.match.status === 'in_progress' && (
                    <span className="ml-2 font-semibold text-arena-live">{t('pulse.liveNow')}</span>
                  )}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-arena-ink-secondary">{t('pulse.noOpenMatches')}</p>
            )}
          </div>

          <div className={`${PANEL} p-5`}>
            <h3 className="font-heading text-sm font-semibold uppercase tracking-wide text-arena-ink-secondary">
              {t('pulse.tableTop')}
            </h3>
            {top3.length === 0 ? (
              <p className="mt-2 text-sm text-arena-ink-secondary">{t('noCompleted')}</p>
            ) : (
              <ol className="mt-3 space-y-1.5">
                {top3.map((row, index) => (
                  <li
                    key={row.player_id}
                    className={`flex items-center justify-between gap-2 ${PANEL_INSET} px-3 py-2 text-sm`}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          index === 0
                            ? 'bg-arena-accent text-arena-surface'
                            : 'border border-arena-border text-arena-ink-secondary'
                        }`}
                      >
                        {index + 1}
                      </span>
                      <span className="truncate text-arena-ink">{row.player_name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-arena-ink-secondary">
                      {row.wins}-{row.losses}-{row.draws} ·{' '}
                      <span className="font-semibold text-arena-ink">{t('points', { points: row.points })}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
