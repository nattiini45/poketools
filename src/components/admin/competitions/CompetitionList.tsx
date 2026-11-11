'use client';

/**
 * The competition list (redesign A4): the one view behind /admin/leagues, /admin/tournaments, their archived pages and
 * the league trash. League and Tournament are segmented links, Active, Archived and Trash are filter links, and all
 * of them are plain links between those five URLs: the server page renders and reads exactly what it did before, and
 * this component adds no fetch. The search filters the rows the page already loaded, in the browser.
 *
 * A list view shows its rows as a table (name, format, status, players, dates, next action); below `xl` each row
 * is a stacked card. The trash view renders its own panel as `children` (the restore and rebuild logic stays in
 * `LeagueTrashPanel`) inside the same frame and filters it with the same search through `useCompetitionQuery`.
 * Trash exists for leagues only, and only the superadmin gets the link (`canViewTrash`, from the live access read).
 *
 * Empty per view ("No archived leagues"), and "Nothing matches" when only the search emptied the list.
 */
import { useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewChip, { type SkewChipTone } from '@/components/ui/SkewChip';
import SkewPlate from '@/components/ui/SkewPlate';
import { cn } from '@/lib/utils/cn';
import { useFormatter, useT } from '@/i18n/client';
import { adminCompetitionsMessages } from '@/i18n/messages/admin-competitions';
import {
  competitionHref,
  rowMatchesQuery,
  type CompetitionKind,
  type CompetitionRow,
  type CompetitionView,
} from '@/lib/admin/competition-list';
import { CompetitionQueryProvider } from './competition-query';
import CompetitionEmpty from './CompetitionEmpty';
import { ACTION_CELL, CELL, NAME_CELL, ROW, TABLE, TABLE_FRAME, TBODY, TH, THEAD, TOUCH } from './table-styles';

type Props = {
  kind: CompetitionKind;
  /** The superadmin's trash link (leagues only). */
  canViewTrash?: boolean;
} & (
  | { view: 'active' | 'archived'; rows: readonly CompetitionRow[]; children?: never }
  | { view: 'trash'; children: ReactNode; rows?: never }
);

const STATUS_TONE: Record<CompetitionRow['status'], SkewChipTone> = {
  active: 'live',
  upcoming: 'accent',
  completed: 'neutral',
};

const KIND_ICON = { league: 'poke-ball', tournament: 'kings-rock' } as const;

const NEW_HREF = { league: '/admin/leagues/new', tournament: '/admin/tournaments/new' } as const;

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink';

/** A league's dates (calendar days), or when a tournament, which has none, was created. */
function RowDates({ kind, row }: { kind: CompetitionKind; row: CompetitionRow }) {
  const t = useT(adminCompetitionsMessages);
  const f = useFormatter();
  if (kind === 'tournament') return <>{t('dates.created', { date: f.instant(row.createdAt, 'date') })}</>;
  if (row.startDate && row.endDate) {
    return <>{t('dates.range', { start: f.calendarDate(row.startDate), end: f.calendarDate(row.endDate) })}</>;
  }
  if (row.startDate) return <>{t('dates.from', { date: f.calendarDate(row.startDate) })}</>;
  if (row.endDate) return <>{t('dates.until', { date: f.calendarDate(row.endDate) })}</>;
  return <>{t('dates.none')}</>;
}

export default function CompetitionList(props: Props) {
  const { kind, view, canViewTrash = false } = props;
  const t = useT(adminCompetitionsMessages);
  const searchId = useId();
  const [query, setQuery] = useState('');

  const trashAllowed = kind === 'league' && canViewTrash;
  const views: CompetitionView[] = trashAllowed ? ['active', 'archived', 'trash'] : ['active', 'archived'];
  const otherKind: CompetitionKind = kind === 'league' ? 'tournament' : 'league';

  const rows = props.view === 'trash' ? [] : props.rows;
  const shown = rows.filter((row) => rowMatchesQuery(row, query));
  const searching = query.trim() !== '';

  return (
    <div className="space-y-4" data-competition-list data-kind={kind} data-view={view}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <nav aria-label={t('kind.label')} className="flex gap-2" data-competition-kinds>
          {(['league', 'tournament'] as const).map((entry) => {
            const current = entry === kind;
            return (
              <Link
                key={entry}
                href={competitionHref(entry, entry === otherKind && view === 'trash' ? 'active' : view)}
                prefetch={false}
                aria-current={current ? 'page' : undefined}
                className={cn('inline-flex min-h-11 items-center rounded-poke-sm sm:min-h-0', FOCUS)}
              >
                <SkewPlate variant="tab" active={current}>
                  <span className="inline-flex items-center gap-2">
                    <ItemIcon item={KIND_ICON[entry]} size={24} className="-my-1" />
                    {t(`kind.${entry}`)}
                  </span>
                </SkewPlate>
              </Link>
            );
          })}
        </nav>

        <nav aria-label={t('view.label')} className="flex flex-wrap gap-1" data-competition-views>
          {views.map((entry) => {
            const current = entry === view;
            return (
              <Link
                key={entry}
                href={competitionHref(kind, entry)}
                prefetch={false}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-poke-md px-3 text-body sm:min-h-0 sm:py-1.5',
                  'motion-safe:transition-colors motion-safe:duration-(--motion-fast)',
                  current ? 'bg-selected font-[550] text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
                  FOCUS,
                )}
              >
                {t(`view.${entry}`)}
              </Link>
            );
          })}
        </nav>

        <div className="relative w-full sm:ml-auto sm:w-72" role="search">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
          <Input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t('search.label')}
            placeholder={t('search.placeholder')}
            autoComplete="off"
            className="pl-9"
          />
        </div>
      </div>

      {props.view !== 'trash' && (
        <p className="text-caption text-fg-muted" aria-live="polite" data-competition-count>
          {searching
            ? t('count.filtered', { shown: shown.length, total: rows.length })
            : t(`count.${kind}`, { count: rows.length })}
        </p>
      )}

      {props.view === 'trash' ? (
        <CompetitionQueryProvider value={query}>{props.children}</CompetitionQueryProvider>
      ) : rows.length === 0 ? (
        <CompetitionEmpty title={t(`empty.${kind}.${props.view}.title`)} hint={t(`empty.${kind}.${props.view}.hint`)} data-competition-empty={props.view}>
          {props.view === 'active' && (
            <Button asChild variant="primary" size="sm" className={TOUCH}>
              <Link href={NEW_HREF[kind]}>{t(`new.${kind}`)}</Link>
            </Button>
          )}
        </CompetitionEmpty>
      ) : shown.length === 0 ? (
        <CompetitionEmpty title={t('empty.noMatches.title', { query: query.trim() })} hint={t('empty.noMatches.hint')} data-competition-empty="search">
          <Button variant="secondary" size="sm" className={TOUCH} onClick={() => setQuery('')}>
            {t('search.clear')}
          </Button>
        </CompetitionEmpty>
      ) : (
        <div className={TABLE_FRAME}>
          <table className={TABLE} data-competition-table>
            <caption className="sr-only">{t(`caption.${kind}`)}</caption>
            <thead className={THEAD}>
              <tr>
                {(['name', 'format', 'status', 'players', 'dates', 'nextAction'] as const).map((column) => (
                  <th key={column} scope="col" className={TH}>
                    {t(`columns.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={TBODY}>
              {shown.map((row) => (
                <tr key={row.id} className={ROW} data-competition-row={row.id}>
                  <th scope="row" className={cn(NAME_CELL, 'font-normal')}>
                    <Link href={row.href} className={cn('font-[550] text-fg hover:text-accent-ink hover:underline underline-offset-2', FOCUS)}>
                      {row.name}
                    </Link>
                    {row.test && (
                      <SkewChip className="ml-2 align-middle">{t('row.test')}</SkewChip>
                    )}
                    <span className="block text-caption font-normal text-fg-muted">{row.detail}</span>
                  </th>
                  <td data-label={t('columns.format')} className={CELL}>
                    <span>
                      {row.formatLabel}
                      {row.rulesetName && (
                        <span className="text-caption text-fg-muted xl:block">
                          <span aria-hidden="true" className="mx-1.5 xl:hidden">
                            ·
                          </span>
                          {row.rulesetName}
                        </span>
                      )}
                    </span>
                  </td>
                  <td data-label={t('columns.status')} className={CELL}>
                    <span className="flex flex-wrap gap-1.5">
                      <SkewChip tone={STATUS_TONE[row.status]}>{row.statusLabel}</SkewChip>
                      {row.archived && <SkewChip>{t('row.archived')}</SkewChip>}
                    </span>
                  </td>
                  <td data-label={t('columns.players')} className={CELL}>
                    <span className="font-heading text-title tabular-nums text-fg">{row.players}</span>
                  </td>
                  <td data-label={t('columns.dates')} className={cn(CELL, 'text-fg-muted xl:whitespace-nowrap')}>
                    <span>
                      <RowDates kind={kind} row={row} />
                    </span>
                  </td>
                  <td className={ACTION_CELL}>
                    <Button asChild variant="secondary" size="sm" className={TOUCH}>
                      <Link href={row.actionHref} aria-label={t('actionLabel', { action: t(`action.${row.action}`), name: row.name })}>
                        {t(`action.${row.action}`)}
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
