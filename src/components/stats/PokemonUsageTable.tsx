'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';
import PokemonLink from '@/components/shared/PokemonLink';
import AnimatedSprite from '@/components/shared/AnimatedSprite';
import Table, { type Column, type TablePaginationLabels } from '@/components/ui/Table';
import { useDataLocale, useFormatter, useMessages } from '@/i18n/client';
import { statsMessages } from '@/i18n/messages/stats';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { foldForSearch } from '@/lib/pkmn/i18n/search';
import type { PokemonUsageRow } from '@/types/game';
import { fixedNumber, fixedPercent } from './stat-format';

/**
 * Column headers and the empty state. The defaults come from the `stats`
 * namespace (`usage`) in the viewer's language; a `labels` prop overrides them.
 */
export interface PokemonUsageTableLabels {
  pokemon: string;
  usage: string;
  /** Games the Pokémon was on a team (the kill ranking's "Teams" count). */
  teams: string;
  efficiency: string;
  kos: string;
  koedRate: string;
  bringRate: string;
  leadRate: string;
  winRate: string;
  empty: string;
  /** The table's pagination chrome; absent keeps `Table`'s English. */
  pagination?: TablePaginationLabels;
}

/**
 * The English labels.
 * @deprecated Pass no `labels` to get the viewer's language; kept for callers that still pass it.
 */
export const DEFAULT_POKEMON_USAGE_LABELS: PokemonUsageTableLabels = { ...statsMessages.en.usage };

interface PokemonUsageTableProps {
  data: PokemonUsageRow[];
  isDoubles?: boolean;
  labels?: PokemonUsageTableLabels;
}

export default function PokemonUsageTable({
  data,
  isDoubles = false,
  labels: labelsOverride,
}: PokemonUsageTableProps) {
  const localized = useMessages(statsMessages).usage;
  const labels: PokemonUsageTableLabels = labelsOverride ?? localized;
  const dl = useDataLocale();
  const f = useFormatter();
  const percent = (value: number | null) => (value !== null ? fixedPercent(f, value) : '—');

  const columns: Column<PokemonUsageRow>[] = [
    {
      key: 'rank',
      header: '#',
      width: '2.5rem',
      render: (_row, i) => <span className="text-poke-text-muted">{i + 1}</span>,
    },
    {
      key: 'pokemon_name',
      header: labels.pokemon,
      sortable: true,
      sortValue: (row) => foldForSearch(localizeSpecies(row.pokemon_name, dl)),
      render: (row) => (
        <PokemonLink name={row.pokemon_name}>
          <AnimatedSprite>
            <PokemonSprite name={row.pokemon_name} size={24} />
          </AnimatedSprite>
          <span className="font-medium">{localizeSpecies(row.pokemon_name, dl)}</span>
        </PokemonLink>
      ),
    },
    {
      key: 'usage_percent',
      header: labels.usage,
      align: 'left',
      sortable: true,
      sortValue: (row) => row.usage_percent,
      render: (row) => <UsageBar value={row.usage_percent} label={fixedPercent(f, row.usage_percent)} />,
    },
    {
      key: 'total_appearances',
      header: labels.teams,
      align: 'center',
      sortable: true,
      sortValue: (row) => row.total_appearances,
      render: (row) => (
        <span className="text-poke-text-secondary">{row.total_appearances}</span>
      ),
    },
    {
      key: 'efficiency',
      header: labels.efficiency,
      align: 'center',
      sortable: true,
      sortValue: (row) => row.efficiency ?? -1,
      render: (row) => (row.efficiency != null ? fixedNumber(f, row.efficiency, 2) : '—'),
    },
    {
      key: 'kos_dealt',
      header: labels.kos,
      align: 'center',
      sortable: true,
      sortValue: (row) => row.kos_dealt,
    },
    {
      key: 'koed_rate',
      header: labels.koedRate,
      align: 'center',
      sortable: true,
      sortValue: (row) => row.koed_rate,
      render: (row) => percent(row.koed_rate),
    },
    ...(isDoubles
      ? [
          {
            key: 'bring_rate',
            header: labels.bringRate,
            align: 'center' as const,
            sortable: true,
            sortValue: (row: PokemonUsageRow) => row.bring_rate ?? -1,
            render: (row: PokemonUsageRow) => percent(row.bring_rate),
          },
          {
            key: 'lead_rate',
            header: labels.leadRate,
            align: 'center' as const,
            sortable: true,
            sortValue: (row: PokemonUsageRow) => row.lead_rate ?? -1,
            render: (row: PokemonUsageRow) => percent(row.lead_rate),
          },
        ]
      : []),
    {
      key: 'win_rate',
      header: labels.winRate,
      align: 'center',
      sortable: true,
      sortValue: (row) => row.win_rate ?? -1,
      render: (row) => percent(row.win_rate),
    },
  ];

  return (
    <Table
      columns={columns}
      data={data}
      keyExtractor={(row) => row.pokemon_name}
      emptyMessage={labels.empty}
      labels={labels.pagination}
      animated
      defaultSort={{ key: 'usage_percent', direction: 'desc' }}
    />
  );
}

function UsageBar({ value, label }: { value: number; label: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-2 bg-poke-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-poke-blue rounded-full"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-xs">{label}</span>
    </div>
  );
}
