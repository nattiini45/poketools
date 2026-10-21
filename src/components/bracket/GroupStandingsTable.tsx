'use client';

import Link from 'next/link';
import { useT } from '@/i18n/client';
import { bracketMessages } from '@/i18n/messages/bracket';
import Table, { type Column } from '@/components/ui/Table';
import type { Standing } from '@/lib/tournament/types';
import type { EvolutionStanding } from '@/lib/tournament/evolution-standings';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import GymTypedName from '@/components/shared/GymTypedName';

interface GroupStandingsTableProps {
  standings: Standing[];
  /** When true, show Evolution Points column and tie markers (EPB format) */
  showEvolutionColumns?: boolean;
}

function isEvolutionStanding(row: Standing): row is EvolutionStanding {
  return 'evolution_points' in row;
}

/**
 * Standings table for round robin groups.
 * EPB format adds Evolution Points and decision-match tie markers.
 * DecisionMatchPanel is mounted by the parent page/tabs — not here.
 */
export default function GroupStandingsTable({
  standings,
  showEvolutionColumns = false,
}: GroupStandingsTableProps) {
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
        <div className="flex items-center gap-2">
          <Link
            href={`/players/${row.player_id}`}
            className="flex items-center gap-2 font-medium hover:text-poke-blue transition-colors"
          >
            <PlayerAvatar avatarUrl={row.player_avatar_url} name={row.player_name} size={20} />
            <GymTypedName name={row.player_name} gymType={row.gym_type} />
          </Link>
          {showEvolutionColumns && isEvolutionStanding(row) && row.needs_decision_match && (
            <span
              className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-400"
              title={t('standings.tieTitle')}
            >
              {t('standings.tie')}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'games_played',
      header: t('standings.games'),
      align: 'center' as const,
      sortable: true,
      sortValue: (row) => row.games_played,
      render: (row: Standing) => (
        <span className="text-poke-text-secondary">{row.games_played}</span>
      ),
    },
    {
      key: 'wins',
      header: t('standings.wins'),
      align: 'center' as const,
      sortable: true,
      sortValue: (row) => row.wins,
      render: (row: Standing) => (
        <span className="text-poke-green font-medium">{row.wins}</span>
      ),
    },
    {
      key: 'losses',
      header: t('standings.losses'),
      align: 'center' as const,
      sortable: true,
      sortValue: (row) => row.losses,
      render: (row: Standing) => (
        <span className="text-poke-danger font-medium">{row.losses}</span>
      ),
    },
    {
      key: 'points',
      header: t('standings.points'),
      align: 'center' as const,
      sortable: true,
      sortValue: (row) => row.points,
      render: (row: Standing) => (
        <span className="font-semibold">{row.points}</span>
      ),
    },
    ...(showEvolutionColumns
      ? [{
          key: 'evolution_points',
          header: t('standings.evolutionPoints'),
          align: 'center' as const,
          sortable: true,
          sortValue: (row: Standing) => (isEvolutionStanding(row) ? row.evolution_points : 0),
          render: (row: Standing) => {
            const ep = isEvolutionStanding(row) ? row.evolution_points : 0;
            return <span className="font-medium text-cyan-400">{ep}</span>;
          },
        } satisfies Column<Standing>]
      : []),
    {
      key: 'kill_differential',
      header: t('standings.killDiff'),
      align: 'center' as const,
      sortable: true,
      sortValue: (row) => row.kill_differential,
      render: (row: Standing) => {
        const val = row.kill_differential;
        const color = val > 0 ? 'text-poke-green' : val < 0 ? 'text-poke-danger' : 'text-poke-text-muted';
        const prefix = val > 0 ? '+' : '';
        return <span className={`font-medium ${color}`}>{prefix}{val}</span>;
      },
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
