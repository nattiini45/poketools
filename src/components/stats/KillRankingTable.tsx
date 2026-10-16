'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';
import PokemonLink from '@/components/shared/PokemonLink';
import AnimatedSprite from '@/components/shared/AnimatedSprite';
import Table, { type Column, type TablePaginationLabels } from '@/components/ui/Table';
import { useDataLocale, useFormatter, useMessages } from '@/i18n/client';
import { statsMessages } from '@/i18n/messages/stats';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { foldForSearch } from '@/lib/pkmn/i18n/search';
import type { KillRankingRow } from '@/types/game';
import { fixedNumber } from './stat-format';

/**
 * Column headers and the empty state. The defaults come from the `stats`
 * namespace (`kills`) in the viewer's language; a `labels` prop overrides them.
 */
export interface KillRankingTableLabels {
  pokemon: string;
  kos: string;
  koed: string;
  diff: string;
  /** Games the Pokémon was on a team. */
  teams: string;
  /** Games the Pokémon was brought into battle. */
  brought: string;
  efficiency: string;
  empty: string;
  /** The table's pagination chrome; absent keeps `Table`'s English. */
  pagination?: TablePaginationLabels;
}

/**
 * The English labels.
 * @deprecated Pass no `labels` to get the viewer's language; kept for callers that still pass it.
 */
export const DEFAULT_KILL_RANKING_LABELS: KillRankingTableLabels = { ...statsMessages.en.kills };

interface KillRankingTableProps {
  data: KillRankingRow[];
  labels?: KillRankingTableLabels;
}

export default function KillRankingTable({ data, labels: labelsOverride }: KillRankingTableProps) {
  const localized = useMessages(statsMessages).kills;
  const labels: KillRankingTableLabels = labelsOverride ?? localized;
  const dl = useDataLocale();
  const f = useFormatter();
  const columns: Column<KillRankingRow>[] = [
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
      key: 'kos_dealt',
      header: labels.kos,
      align: 'center',
      sortable: true,
      sortValue: (row) => row.kos_dealt,
      render: (row) => (
        <span className="text-poke-green font-medium">{row.kos_dealt}</span>
      ),
    },
    {
      key: 'times_koed',
      header: labels.koed,
      align: 'center',
      sortable: true,
      sortValue: (row) => row.times_koed,
      render: (row) => (
        <span className="text-poke-danger font-medium">{row.times_koed}</span>
      ),
    },
    {
      key: 'kill_differential',
      header: labels.diff,
      align: 'center',
      sortable: true,
      sortValue: (row) => row.kill_differential,
      render: (row) => {
        const val = row.kill_differential;
        const color =
          val > 0 ? 'text-poke-green' : val < 0 ? 'text-poke-danger' : 'text-poke-text-muted';
        const prefix = val > 0 ? '+' : '';
        return (
          <span className={`font-semibold ${color}`}>
            {prefix}
            {val}
          </span>
        );
      },
    },
    {
      key: 'times_in_team',
      header: labels.teams,
      align: 'center',
      sortable: true,
      sortValue: (row) => row.times_in_team,
      render: (row) => (
        <span className="text-poke-text-secondary">{row.times_in_team}</span>
      ),
    },
    {
      key: 'participations',
      header: labels.brought,
      align: 'center',
      sortable: true,
      sortValue: (row) => row.participations,
      render: (row) => (
        <span className="text-poke-text-secondary">{row.participations}</span>
      ),
    },
    {
      key: 'efficiency',
      header: labels.efficiency,
      align: 'center',
      sortable: true,
      sortValue: (row) => row.efficiency,
      render: (row) => (
        <span className="text-poke-text-secondary font-medium">
          {fixedNumber(f, row.efficiency, 2)}
        </span>
      ),
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
      defaultSort={{ key: 'kos_dealt', direction: 'desc' }}
    />
  );
}
