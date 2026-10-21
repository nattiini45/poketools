'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import Table, { type Column } from '@/components/ui/Table';
import type { StandingsRow } from '@/types/game';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import GymTypedName from '@/components/shared/GymTypedName';
import { useT } from '@/i18n/client';
import { statsMessages } from '@/i18n/messages/stats';

interface StandingsTableProps {
  standings: StandingsRow[];
}

function compareStandingsRows(a: StandingsRow, b: StandingsRow): number {
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (a.losses !== b.losses) return a.losses - b.losses;
  return (b.game_wins - b.game_losses) - (a.game_wins - a.game_losses);
}

export default function StandingsTable({ standings }: StandingsTableProps) {
  const t = useT(statsMessages);
  const rankedStandings = useMemo(
    () => [...standings].sort(compareStandingsRows),
    [standings],
  );

  const columns: Column<StandingsRow>[] = [
    {
      key: 'rank',
      header: '#',
      width: '2.5rem',
      render: (_row: StandingsRow, i: number) => (
        <span className="text-poke-text-muted">{i + 1}</span>
      ),
    },
    {
      key: 'player_name',
      header: t('standings.player'),
      sortable: true,
      sortValue: (row) => row.player_name.toLowerCase(),
      render: (row: StandingsRow) => (
        <Link
          href={`/players/${row.player_id}`}
          className="flex items-center gap-2 font-medium hover:text-poke-blue transition-colors"
        >
          <PlayerAvatar avatarUrl={row.player_avatar_url} name={row.player_name} size={20} />
          <GymTypedName name={row.player_name} gymType={row.gym_type ?? null} />
        </Link>
      ),
    },
    {
      key: 'wins',
      header: t('standings.wins'),
      align: 'center' as const,
      sortable: true,
      sortValue: (row) => row.wins,
      render: (row: StandingsRow) => (
        <span className="text-poke-green">{row.wins}</span>
      ),
    },
    {
      key: 'losses',
      header: t('standings.losses'),
      align: 'center' as const,
      sortable: true,
      sortValue: (row) => row.losses,
      render: (row: StandingsRow) => (
        <span className="text-poke-danger">{row.losses}</span>
      ),
    },
    {
      key: 'game_wins',
      header: t('standings.gameWins'),
      align: 'center' as const,
      sortable: true,
      sortValue: (row) => row.game_wins,
    },
    {
      key: 'game_losses',
      header: t('standings.gameLosses'),
      align: 'center' as const,
      sortable: true,
      sortValue: (row) => row.game_losses,
    },
    {
      key: 'diff',
      header: t('standings.diff'),
      align: 'center' as const,
      sortable: true,
      sortValue: (row) => row.game_wins - row.game_losses,
      render: (row: StandingsRow) => {
        const diff = row.game_wins - row.game_losses;
        return (
          <span className={`font-medium ${
            diff > 0 ? 'text-poke-green' : diff < 0 ? 'text-poke-danger' : 'text-poke-text-muted'
          }`}>
            {diff > 0 ? '+' : ''}{diff}
          </span>
        );
      },
    },
  ];

  return (
    <Table
      columns={columns}
      data={rankedStandings}
      keyExtractor={(row) => row.player_id}
      emptyMessage={t('standings.empty')}
      animated
    />
  );
}
