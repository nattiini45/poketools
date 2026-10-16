'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import PokemonSprite from '@/components/shared/PokemonSprite';
import RatingBadge from '@/components/gamification/RatingBadge';
import Table, { type Column } from '@/components/ui/Table';
import type { ApiResult } from '@/types/api';
import type { RatingLeaderboardEntry } from '@/types/rating';
import { useDataLocale, useT } from '@/i18n/client';
import { insightsMessages } from '@/i18n/messages/insights';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

const MIN_GAMES_OPTIONS = [5, 10, 20] as const;

interface LeaderboardContentProps {
  initialRows: RatingLeaderboardEntry[];
}

export default function LeaderboardContent({ initialRows }: LeaderboardContentProps) {
  const t = useT(insightsMessages);
  const dl = useDataLocale();
  const [minGames, setMinGames] = useState<number>(5);
  const [rows, setRows] = useState<RatingLeaderboardEntry[]>(initialRows);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (minGames === 5) {
      setRows(initialRows);
      return;
    }

    let active = true;
    setLoading(true);

    async function load() {
      try {
        const response = await fetch(`/api/ratings?min_games=${minGames}`);
        const json = (await response.json()) as ApiResult<RatingLeaderboardEntry[]>;
        if (!response.ok || !json.success) {
          throw new Error(!json.success ? json.error : 'Failed to load leaderboard');
        }
        if (active) {
          setRows(json.data);
        }
      } catch {
        if (active) {
          setRows([]);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [minGames, initialRows]);

  const columns: Column<RatingLeaderboardEntry>[] = [
    {
      key: 'rank',
      header: '#',
      width: '3rem',
      render: (_row, index) => (
        <span className="font-heading font-bold text-poke-text-primary">{index + 1}</span>
      ),
    },
    {
      key: 'player_name',
      header: t('leaderboard.player'),
      sortable: true,
      sortValue: (row) => row.player_name.toLowerCase(),
      render: (row) => (
        <Link
          href={`/players/${row.player_id}`}
          className="inline-flex items-center gap-2 hover:opacity-80"
        >
          <PlayerAvatar avatarUrl={row.player_avatar_url} name={row.player_name} size={30} />
          <span className="font-semibold text-poke-text-primary">{row.player_name}</span>
        </Link>
      ),
    },
    {
      key: 'rating',
      header: t('leaderboard.rating'),
      sortable: true,
      sortValue: (row) => row.rating,
      render: (row) => <RatingBadge rating={row.rating} rd={row.rd} size="sm" variant="tier" />,
    },
    {
      key: 'peak_rating',
      header: t('leaderboard.peak'),
      align: 'center',
      sortable: true,
      sortValue: (row) => row.peak_rating,
      render: (row) => (
        <span className="text-poke-text-secondary">{Math.round(row.peak_rating)}</span>
      ),
    },
    {
      key: 'wins',
      header: t('leaderboard.record'),
      align: 'center',
      sortable: true,
      sortValue: (row) => row.wins,
      render: (row) => (
        <span className="text-poke-text-secondary">
          {t('leaderboard.recordValue', { wins: row.wins, losses: row.losses, draws: row.draws })}
        </span>
      ),
    },
    {
      key: 'signatures',
      header: t('leaderboard.signatures'),
      render: (row) => (
        <div className="flex items-center gap-1">
          {row.signatures.slice(0, 6).map((signature) => (
            <Link
              key={`${row.player_id}-${signature.slot_number}-${signature.pokemon_name}`}
              href={`/pokemon/${encodeURIComponent(signature.pokemon_name)}`}
              title={localizeSpecies(signature.pokemon_name, dl)}
              aria-label={localizeSpecies(signature.pokemon_name, dl)}
              className="inline-flex hover:opacity-80 transition-opacity"
            >
              <PokemonSprite name={signature.pokemon_name} size={24} />
            </Link>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div className="bg-poke-surface border border-poke-border rounded-poke-xl p-4 sm:p-6 shadow-poke">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <p className="text-sm text-poke-text-secondary">{t('leaderboard.title')}</p>
        <label className="inline-flex items-center gap-2 text-sm text-poke-text-secondary">
          {t('leaderboard.minGames')}
          <select
            value={minGames}
            onChange={(event) => setMinGames(Number(event.target.value))}
            className="bg-poke-elevated border border-poke-border rounded-poke-md px-2 py-1 text-poke-text-primary"
          >
            {MIN_GAMES_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-poke-text-tertiary py-6 text-center">{t('leaderboard.loading')}</p>
      ) : (
        <Table
          columns={columns}
          data={rows}
          keyExtractor={(row) => row.player_id}
          emptyMessage={t('leaderboard.empty')}
          defaultSort={{ key: 'rating', direction: 'desc' }}
        />
      )}
    </div>
  );
}
