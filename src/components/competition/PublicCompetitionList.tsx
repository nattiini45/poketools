import type { ReactNode } from 'react';
import Link from 'next/link';
import ItemIcon from '@/components/ui/ItemIcon';
import LinkTabs, { type LinkTab } from '@/components/ui/LinkTabs';
import SkewChip, { type SkewChipTone } from '@/components/ui/SkewChip';
import SkewPlate from '@/components/ui/SkewPlate';
import type { ItemIconId } from '@/lib/pkmn/item-icons';
import { cn } from '@/lib/utils/cn';

export type CompetitionStatus = 'active' | 'upcoming' | 'completed';
export type CompetitionStatusFilter = 'all' | CompetitionStatus;

export const COMPETITION_STATUS_FILTERS: readonly CompetitionStatusFilter[] = ['all', 'active', 'upcoming', 'completed'];

/** The `?status=` value of a list page; anything unknown shows every competition. */
export function parseCompetitionStatusFilter(value: string | string[] | undefined): CompetitionStatusFilter {
  const single = Array.isArray(value) ? value[0] : value;
  return COMPETITION_STATUS_FILTERS.find((filter) => filter === single) ?? 'all';
}

export interface CompetitionListItem {
  id: string;
  href: string;
  name: string;
  status: CompetitionStatus;
  statusLabel: string;
  /** Format, ruleset and the like, joined with a middle dot. */
  meta: readonly string[];
  /** Counts on small plates ("8 players", "2 stages"). */
  stats: readonly string[];
  /** Extra badges after the plates (test league, doubles). */
  badges?: ReactNode;
  /** The date span, already formatted. */
  dates?: string;
}

const STATUS_TONE: Record<CompetitionStatus, SkewChipTone> = { active: 'live', upcoming: 'accent', completed: 'neutral' };
const STATUS_EDGE: Record<CompetitionStatus, string> = { active: 'bg-live', upcoming: 'bg-accent-fill', completed: 'bg-hairline-strong' };

interface PublicCompetitionListProps {
  items: readonly CompetitionListItem[];
  icon: ItemIconId;
  /** The path of the list page; the status tabs link to it with `?status=`. */
  basePath: string;
  filter: CompetitionStatusFilter;
  filterLabel: string;
  filterLabels: Record<CompetitionStatusFilter, string>;
  /** Shown when the list has no competition at all. */
  emptyText: string;
  /** Shown when the selected status has none. */
  emptyFilteredText: string;
  /** The link back to the whole list from an empty status. */
  showAllLabel: string;
}

/**
 * The public list of leagues or tournaments (plan §4.2, B1): link tabs by status over one list. The page reads
 * the whole list once (cached) and this filters it in memory, so a tab costs no query.
 */
export default function PublicCompetitionList({
  items,
  icon,
  basePath,
  filter,
  filterLabel,
  filterLabels,
  emptyText,
  emptyFilteredText,
  showAllLabel,
}: PublicCompetitionListProps) {
  if (items.length === 0) return <p className="text-body text-fg-muted">{emptyText}</p>;

  const tabs: LinkTab[] = COMPETITION_STATUS_FILTERS.map((key) => ({
    key,
    href: key === 'all' ? basePath : `${basePath}?status=${key}`,
    label: filterLabels[key],
    count: key === 'all' ? items.length : items.filter((item) => item.status === key).length,
  }));
  const shown = filter === 'all' ? items : items.filter((item) => item.status === filter);

  return (
    <div className="flex flex-col gap-4">
      <LinkTabs tabs={tabs} activeKey={filter} label={filterLabel} glideId={`${basePath}-status`} />
      {shown.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-poke-lg border border-hairline bg-surface p-5">
          <p className="text-body text-fg-muted">{emptyFilteredText}</p>
          <Link href={basePath} scroll={false} className="relative inline-flex rounded-[3px] text-body">
            <SkewPlate variant="button" tone="secondary">
              {showAllLabel}
            </SkewPlate>
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {shown.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="relative flex h-full items-start gap-4 overflow-hidden rounded-poke-lg border border-hairline bg-surface py-4 pl-5 pr-4 transition-colors duration-[80ms] hover:bg-elevated focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus"
              >
                <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', STATUS_EDGE[item.status])} />
                <ItemIcon item={icon} size={48} className="mt-0.5 hidden shrink-0 sm:block" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <h2 className="min-w-0 font-heading text-title text-fg [overflow-wrap:anywhere]">{item.name}</h2>
                    <SkewChip tone={STATUS_TONE[item.status]}>{item.statusLabel}</SkewChip>
                  </div>
                  {item.meta.length > 0 && <p className="mt-1 text-caption text-fg-muted">{item.meta.join(' · ')}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {item.stats.map((stat) => (
                      <SkewChip key={stat}>{stat}</SkewChip>
                    ))}
                    {item.badges}
                    {item.dates && <span className="ml-auto text-caption tabular-nums text-fg-muted">{item.dates}</span>}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
