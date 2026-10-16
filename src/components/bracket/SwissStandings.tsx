'use client';

import Link from 'next/link';
import { useT } from '@/i18n/client';
import { bracketMessages } from '@/i18n/messages/bracket';
import Table, { type Column } from '@/components/ui/Table';
import type { Standing } from '@/lib/tournament/types';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import GymTypedName from '@/components/shared/GymTypedName';

interface SwissStandingsProps {
  standings: Standing[];
}

export default function SwissStandings({ standings }: SwissStandingsProps) {
  const t = useT(bracketMessages);
  const columns: Column<Standing>[] = [
    {
      key: 'rank',
      header: '#',
      width: '2.5rem',
      render: (_row: Standing, i: number) => (
        <span className="text-poke-text-muted">{i + 1}</span>
      ),
    },
    {
      key: 'player_name',
      header: t('standings.player'),
      sortable: true,
      sortValue: (row) => row.player_name.toLowerCase(),
      render: (row: Standing) => (
        <Link
          href={`/players/${row.player_id}`}
          className="flex items-center gap-2 font-medium hover:text-poke-blue transition-colors"
        >
          <PlayerAvatar avatarUrl={row.player_avatar_url} name={row.player_name} size={20} />
          <GymTypedName name={row.player_name} gymType={row.gym_type} />
        </Link>
      ),
    },
    {
      key: 'wins',
      header: t('standings.wins'),
      align: 'center' as const,
      sortable: true,
      sortValue: (row) => row.wins,
      render: (row: Standing) => (
        <span className="text-poke-green">{row.wins}</span>
      ),
    },
    {
      key: 'losses',
      header: t('standings.losses'),
      align: 'center' as const,
      sortable: true,
      sortValue: (row) => row.losses,
      render: (row: Standing) => (
        <span className="text-poke-danger">{row.losses}</span>
      ),
    },
    {
      key: 'draws',
      header: t('standings.draws'),
      align: 'center' as const,
      sortable: true,
      sortValue: (row) => row.draws,
      render: (row: Standing) => (
        <span className="text-poke-text-muted">{row.draws}</span>
      ),
    },
    {
      key: 'points',
      header: t('standings.points'),
      align: 'center' as const,
      sortable: true,
      sortValue: (row) => row.points,
      render: (row: Standing) => (
        <span className="font-medium">{row.points}</span>
      ),
    },
    {
      key: 'buchholz',
      header: t('standings.buchholz'),
      align: 'center' as const,
      sortable: true,
      sortValue: (row) => row.buchholz,
      render: (row: Standing) => (
        <span className="text-poke-text-secondary">{row.buchholz}</span>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      data={standings}
      keyExtractor={(row) => row.player_id}
      defaultSort={{ key: 'points', direction: 'desc' }}
    />
  );
}
