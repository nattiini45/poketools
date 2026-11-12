'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Table, { type Column } from '@/components/ui/Table';
import { WikiEmptyState, WikiSelect, WikiStatStrip, WikiUsageBar } from '@/components/wiki/WikiParts';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { wikiMessages } from '@/i18n/messages/wiki';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import type { PokemonDetailStats, PokemonFilterOptions, PokemonPlayerRow } from '@/types/game';

interface PokemonDetailClientProps {
  pokemonName: string;
  initialStats: PokemonDetailStats;
}

type ScopeFilter = 'all_time' | 'league' | 'tournament';

export default function PokemonDetailClient({
  pokemonName,
  initialStats,
}: PokemonDetailClientProps) {
  const t = useT(wikiMessages);
  const dl = useDataLocale();
  const formatter = useFormatter();
  const [stats, setStats] = useState<PokemonDetailStats>(initialStats);
  const [filters, setFilters] = useState<PokemonFilterOptions | null>(null);
  const [scopeType, setScopeType] = useState<ScopeFilter>('all_time');
  const [scopeId, setScopeId] = useState<string>('');
  const [playerId, setPlayerId] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Fetch filter options on mount
  useEffect(() => {
    async function fetchFilters() {
      try {
        const res = await fetch(`/api/pokemon/${encodeURIComponent(pokemonName)}/filters`);
        const json = await res.json();
        if (json.success) {
          setFilters(json.data);
        }
      } catch {
        // Filters are optional — page still works without them
      }
    }
    fetchFilters();
  }, [pokemonName]);

  // Fetch stats when filters change
  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('scope', scopeType);
      if (scopeId) params.set('scope_id', scopeId);
      if (playerId) params.set('player_id', playerId);

      const res = await fetch(
        `/api/pokemon/${encodeURIComponent(pokemonName)}/stats?${params}`
      );
      const json = await res.json();
      if (json.success) {
        setStats(json.data);
      }
    } catch {
      // Keep existing stats on error
    } finally {
      setLoading(false);
    }
  }, [pokemonName, scopeType, scopeId, playerId]);

  // Re-fetch when filters change (but not on initial mount)
  useEffect(() => {
    // Skip initial fetch — we have initialStats from the server
    if (scopeType === 'all_time' && !scopeId && !playerId) return;
    fetchStats();
  }, [fetchStats, scopeType, scopeId, playerId]);

  const handleScopeChange = (newScope: ScopeFilter) => {
    setScopeType(newScope);
    setScopeId(''); // Reset specific scope when type changes
  };

  const hasData = stats.total_appearances > 0;
  const pct = (value: number | null): string => (value !== null ? formatter.percentOf(value) : '—');

  const playerColumns = useMemo((): Column<PokemonPlayerRow>[] => [
    {
      key: 'player',
      header: t('usage.player'),
      sortable: true,
      sortValue: (p) => p.player_name,
      render: (player) => (
        <button
          type="button"
          onClick={() => setPlayerId(player.player_id)}
          className="rounded-poke-sm text-left font-[550] text-fg hover:text-accent-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-transparent focus-visible:ring-2 focus-visible:ring-ring"
        >
          {player.player_name ?? t('usage.unknownPlayer')}
        </button>
      ),
    },
    {
      key: 'games',
      header: t('usage.games'),
      align: 'center',
      sortable: true,
      sortValue: (p) => p.games,
      render: (player) => (
        <span className="font-mono tabular-nums text-fg-muted">{player.games}</span>
      ),
    },
    {
      key: 'win_rate',
      header: t('usage.winRate'),
      align: 'center',
      sortable: true,
      sortValue: (p) => p.win_rate ?? -1,
      render: (player) => (
        <span className="font-mono tabular-nums text-fg-muted">
          {player.win_rate !== null ? formatter.percentOf(player.win_rate) : '—'}
        </span>
      ),
    },
    {
      key: 'kos',
      header: t('usage.kos'),
      align: 'center',
      sortable: true,
      sortValue: (p) => p.kos_dealt,
      render: (player) => (
        <span className="font-mono tabular-nums text-fg-muted">{player.kos_dealt}</span>
      ),
    },
    {
      key: 'koed',
      header: t('usage.koedRate'),
      align: 'center',
      sortable: true,
      sortValue: (p) => p.koed_rate ?? -1,
      render: (player) => (
        <span className="font-mono tabular-nums text-fg-muted">
          {player.koed_rate !== null ? formatter.percentOf(player.koed_rate) : '—'}
        </span>
      ),
    },
    {
      key: 'bring',
      header: t('usage.bringRate'),
      align: 'center',
      sortable: true,
      sortValue: (p) => p.bring_rate ?? -1,
      render: (player) => (
        <span className="font-mono tabular-nums text-fg-muted">
          {player.bring_rate !== null ? formatter.percentOf(player.bring_rate) : '—'}
        </span>
      ),
    },
    {
      key: 'lead',
      header: t('usage.leadRate'),
      align: 'center',
      sortable: true,
      sortValue: (p) => p.lead_rate ?? -1,
      render: (player) => (
        <span className="font-mono tabular-nums text-fg-muted">
          {player.lead_rate !== null ? formatter.percentOf(player.lead_rate) : '—'}
        </span>
      ),
    },
  ], [t, formatter]);

  return (
    <div className="flex flex-col gap-4">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Scope type */}
        <WikiSelect
          label={t('usage.scope')}
          value={scopeType}
          onChange={(e) => handleScopeChange(e.target.value as ScopeFilter)}
        >
          <option value="all_time">{t('usage.allTime')}</option>
          <option value="league">{t('usage.league')}</option>
          <option value="tournament">{t('usage.tournament')}</option>
        </WikiSelect>

        {/* Specific scope selector */}
        {scopeType === 'league' && filters && (
          <WikiSelect label={t('usage.league')} value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
            <option value="">{t('usage.selectLeague')}</option>
            {filters.leagues.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </WikiSelect>
        )}

        {scopeType === 'tournament' && filters && (
          <WikiSelect label={t('usage.tournament')} value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
            <option value="">{t('usage.selectTournament')}</option>
            {filters.tournaments.map((tournament) => (
              <option key={tournament.id} value={tournament.id}>{tournament.name}</option>
            ))}
          </WikiSelect>
        )}

        {/* Player filter */}
        {filters && filters.players.length > 0 && (
          <WikiSelect label={t('usage.player')} value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
            <option value="">{t('usage.allPlayers')}</option>
            {filters.players.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </WikiSelect>
        )}

        {loading && (
          <span role="status" className="pb-2 text-caption text-fg-muted motion-safe:animate-pulse">{t('usage.loading')}</span>
        )}
      </div>

      {/* Stat Cards */}
      {hasData ? (
        <>
          <WikiStatStrip
            className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
            stats={[
              { label: t('usage.usageRate'), value: formatter.percentOf(stats.usage_percent) },
              { label: t('usage.winRate'), value: pct(stats.win_rate) },
              { label: t('usage.kos'), value: formatter.number(stats.kos_dealt) },
              { label: t('usage.koedRate'), value: formatter.percentOf(stats.koed_rate) },
              { label: t('usage.bringRate'), value: pct(stats.bring_rate) },
              { label: t('usage.leadRate'), value: pct(stats.lead_rate) },
            ]}
          />

          <p className="text-caption text-fg-muted">
            {t('usage.appearances', {
              count: stats.total_appearances,
              games: t('usage.gamesCount', { count: stats.total_games_in_scope }),
            })}
          </p>

          {/* Move Usage */}
          {stats.moves.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-subtitle font-[550] text-fg">{t('usage.moveUsage')}</h3>
              <ul className="flex flex-col gap-2.5 rounded-poke-lg border border-hairline bg-surface p-4">
                {stats.moves.map((move) => (
                  <WikiUsageBar
                    key={move.name}
                    label={localizeMove(move.name, dl)}
                    percent={move.usage_percent}
                    value={`${formatter.percentOf(move.usage_percent)} (${formatter.number(move.count)})`}
                  />
                ))}
              </ul>
            </div>
          )}

          {/* Player Breakdown */}
          {!playerId && stats.players.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-subtitle font-[550] text-fg">{t('usage.playerBreakdown')}</h3>
              <Table
                columns={playerColumns}
                data={stats.players}
                keyExtractor={(player) => player.player_id}
                emptyMessage={t('usage.noPlayerData')}
              />
            </div>
          )}
        </>
      ) : (
        <WikiEmptyState title={t('usage.noDataPokemon')} hint={t('usage.noDataPokemonHintFuture')} />
      )}
    </div>
  );
}
