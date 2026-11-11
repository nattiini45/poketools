import Link from 'next/link';
import WorkspaceCard from '@/components/admin/WorkspaceCard';
import ItemIcon from '@/components/ui/ItemIcon';
import EditableDescription from '@/components/shared/EditableDescription';
import ReadinessCard from '@/components/format-studio/attach/ReadinessCard';
import { getFormatter, getT } from '@/i18n/server';
import { DEFAULT_CONTENT_LOCALE } from '@/i18n/config';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { languageMessages } from '@/i18n/messages/language';
import { loadLeagueFormatState } from '@/lib/format-studio/readiness-loader';
import { leagueAttention } from '@/lib/league-admin/attention';
import { leagueAdminHref } from '@/lib/league-admin/tabs';
import { cn } from '@/lib/utils/cn';
import type { LeagueAdminPanelContext } from './context';

const TEXT_LINK = 'inline-flex min-h-11 items-center font-[550] text-accent-ink hover:underline sm:min-h-0';

/**
 * Overview tab (the default): what the league needs and the league at a glance. In reading order (one column on a
 * phone): the readiness checklist of a custom league that has not started, the attention list, the facts and the
 * description. From `lg` up the facts (and the readiness checklist) sit in a rail on the right.
 *
 * Renders from the league row alone, with one exception: a custom league also reads its attached format and the
 * start signals in one wave (`loadLeagueFormatState`) for the readiness checklist. The attention list is decided
 * from the row (`leagueAttention`): it names what is missing and links the tab that fixes it. The dates fact links to
 * the Settings tab, where the dates are edited; every viewer of this page is a league admin and the Settings tab
 * exists for every format, so the link needs no capability check of its own.
 */
export async function overviewPanel({ id, league, t }: LeagueAdminPanelContext) {
  const [tEnum, tLanguage, formatter, formatState] = await Promise.all([
    getT(enumMessages),
    getT(languageMessages),
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

  const counts: { term: string; value: number; href: string; label: string }[] = [
    {
      term: t('overview.participants'),
      value: league.participant_count,
      href: leagueAdminHref(id, 'participants'),
      label: t('overview.openParticipants'),
    },
    { term: t('overview.phases'), value: league.tournament_count, href: leagueAdminHref(id, 'phases'), label: t('overview.openPhases') },
  ];
  const facts: { term: string; value: string; edit?: { href: string; label: string } }[] = [
    { term: t('overview.format'), value: enumLabel(tEnum, 'formatType', league.format_type) },
    ...(battleFormat ? [{ term: t('overview.battleFormat'), value: battleFormat }] : []),
    { term: t('overview.ruleset'), value: league.ruleset_name ?? t('overview.noRuleset') },
    { term: t('overview.status'), value: enumLabel(tEnum, 'seasonStatus', league.status) },
    {
      term: t('overview.dates'),
      value: dates,
      edit: { href: leagueAdminHref(id, 'settings'), label: t('overview.editDates') },
    },
    { term: t('overview.language'), value: tLanguage(`names.${league.language ?? DEFAULT_CONTENT_LOCALE}`) },
  ];

  const showReadiness = formatState !== null && !formatState.started;
  const attention = leagueAttention(league);
  // The readiness checklist is the to-do list of a custom league that has not started; a second, empty list beside it says nothing.
  const showAttention = attention.length > 0 || !showReadiness;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr] lg:items-start">
      {showReadiness && (
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <ReadinessCard result={formatState.readiness} seasonId={id} />
        </div>
      )}

      {showAttention && (
        <WorkspaceCard
          headingId="league-overview-attention"
          icon="vs-seeker"
          title={t('overview.attention.title')}
          className="lg:col-start-1 lg:row-start-1"
        >
          {attention.length === 0 ? (
            <p className="flex items-center gap-3 text-body text-fg-muted" data-admin-overview-attention="none">
              <ItemIcon item="poke-doll" />
              {t('overview.attention.none')}
            </p>
          ) : (
            <ul className="-my-3 divide-y divide-hairline" data-admin-overview-attention="open">
              {attention.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-0 py-3 text-body" data-attention-item={item.id}>
                  <span className="min-w-0 text-fg">{t(`overview.attention.items.${item.id}`)}</span>
                  <Link href={item.href} className={TEXT_LINK}>
                    {t(`overview.attention.actions.${item.id}`)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </WorkspaceCard>
      )}

      <WorkspaceCard
        headingId="league-overview-facts"
        icon="town-map"
        title={t('overview.title')}
        className={cn('lg:col-start-2', showReadiness ? 'lg:row-start-2' : 'lg:row-span-2 lg:row-start-1')}
      >
        <dl className="grid grid-cols-2 gap-x-3" data-admin-overview-facts>
          {counts.map((count) => (
            <div key={count.term} className="relative mb-2 min-w-0 rounded-poke-md bg-sunken px-3 py-2.5">
              <dt className="text-caption text-fg-muted">{count.term}</dt>
              <dd className="font-heading text-display text-fg tabular-nums">{count.value}</dd>
              <Link
                href={count.href}
                aria-label={count.label}
                className="absolute inset-0 rounded-poke-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus"
              />
            </div>
          ))}
          {facts.map((fact) => (
            <div key={fact.term} className="col-span-2 flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 border-b border-hairline py-2.5 last:border-b-0">
              <dt className="text-caption text-fg-muted">{fact.term}</dt>
              <dd className="min-w-0 break-words text-right text-body text-fg">
                {fact.value}
                {fact.edit && (
                  <Link href={fact.edit.href} className={cn(TEXT_LINK, 'ml-2')}>
                    {fact.edit.label}
                  </Link>
                )}
              </dd>
            </div>
          ))}
        </dl>
        <Link href={`/leagues/${id}`} className={cn(TEXT_LINK, 'mt-2 text-body')}>
          {t('overview.publicPage')}
        </Link>
      </WorkspaceCard>

      <WorkspaceCard
        headingId="league-overview-description"
        icon="weakness-policy"
        title={t('description.title')}
        className={cn('lg:col-start-1', showAttention ? 'lg:row-start-2' : 'lg:row-span-2 lg:row-start-1')}
      >
        <p className="mb-3 text-caption text-fg-muted">{t('description.subtitle')}</p>
        <EditableDescription resourceType="season" resourceId={id} initialValue={league.description} />
      </WorkspaceCard>
    </div>
  );
}
