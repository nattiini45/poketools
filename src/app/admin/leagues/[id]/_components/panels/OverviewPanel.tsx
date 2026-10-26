import Link from 'next/link';
import Section from '@/components/ui/Section';
import EditableDescription from '@/components/shared/EditableDescription';
import ReadinessCard from '@/components/format-studio/attach/ReadinessCard';
import { getFormatter, getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { loadLeagueFormatState } from '@/lib/format-studio/readiness-loader';
import { leagueAdminHref } from '@/lib/league-admin/tabs';
import type { LeagueAdminPanelContext } from './context';

/**
 * Overview tab (the default): the league at a glance and its description. The dates fact links to the
 * Settings tab, where the dates are edited; every viewer of this page is a league admin and the Settings tab
 * exists for every format, so the link needs no capability check of its own.
 * Renders from the league row alone, with one exception: a custom league also reads its attached format and the
 * start signals in one wave, and shows the readiness checklist ("Ready to start?") until it has started. Every
 * other league type makes no read of its own.
 */
export async function overviewPanel({ id, league, t }: LeagueAdminPanelContext) {
  const [tEnum, formatter, formatState] = await Promise.all([
    getT(enumMessages),
    getFormatter(),
    league.format_type === 'custom' ? loadLeagueFormatState(league) : Promise.resolve(null),
  ]);
  // Calendar days (Postgres `date`): zone-free, so the server may format them.
  const start = league.start_date ? formatter.calendarDate(league.start_date) : null;
  const end = league.end_date ? formatter.calendarDate(league.end_date) : null;
  const dates =
    start && end
      ? t('overview.dateRange', { start, end })
      : start
        ? t('overview.startOnly', { start })
        : end
          ? t('overview.endOnly', { end })
          : t('overview.noDates');

  // The battle format, where the league type fixes it (point buy plays singles); a draft league takes it
  // from its ruleset, so it is not repeated here.
  const battleFormat =
    league.format_type === 'doubles'
      ? t('overview.battleFormatDoubles')
      : league.format_type === 'singles' || league.format_type === 'evolution_point_buy'
        ? t('overview.battleFormatSingles')
        : null;

  const facts: { term: string; value: string; edit?: { href: string; label: string } }[] = [
    { term: t('overview.format'), value: enumLabel(tEnum, 'formatType', league.format_type) },
    ...(battleFormat ? [{ term: t('overview.battleFormat'), value: battleFormat }] : []),
    { term: t('overview.ruleset'), value: league.ruleset_name ?? t('overview.noRuleset') },
    { term: t('overview.status'), value: enumLabel(tEnum, 'seasonStatus', league.status) },
    { term: t('overview.participants'), value: String(league.participant_count) },
    { term: t('overview.phases'), value: String(league.tournament_count) },
    {
      term: t('overview.dates'),
      value: dates,
      edit: { href: leagueAdminHref(id, 'settings'), label: t('overview.editDates') },
    },
  ];

  return (
    <>
      {formatState !== null && !formatState.started && <ReadinessCard result={formatState.readiness} seasonId={id} />}

      <Section title={t('overview.title')}>
        <div className="space-y-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2" data-admin-overview-facts>
            {facts.map((fact) => (
              <div key={fact.term} className="min-w-0">
                <dt className="text-xs font-heading text-poke-text-muted">{fact.term}</dt>
                <dd className="text-sm text-poke-text-primary break-words">
                  {fact.value}
                  {fact.edit && (
                    <Link
                      href={fact.edit.href}
                      className="ml-2 inline-flex min-h-11 items-center font-medium text-poke-blue hover:underline sm:min-h-0"
                    >
                      {fact.edit.label}
                    </Link>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <Link
            href={`/leagues/${id}`}
            className="inline-flex min-h-11 items-center text-sm font-medium text-poke-blue hover:underline sm:min-h-0"
          >
            {t('overview.publicPage')}
          </Link>
        </div>
      </Section>

      <Section title={t('description.title')} subtitle={t('description.subtitle')}>
        <EditableDescription resourceType="season" resourceId={id} initialValue={league.description} />
      </Section>
    </>
  );
}
