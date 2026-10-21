'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Card from '@/components/ui/Card';
import Table, { type Column } from '@/components/ui/Table';
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
          className="text-poke-text-primary font-medium hover:text-poke-blue transition-colors text-left"
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
        <span className="text-poke-text-secondary">{player.games}</span>
      ),
    },
    {
      key: 'win_rate',
      header: t('usage.winRate'),
      align: 'center',
      sortable: true,
      sortValue: (p) => p.win_rate ?? -1,
      render: (player) => (
        <span className="text-poke-text-secondary">
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
        <span className="text-poke-text-secondary">{player.kos_dealt}</span>
      ),
    },
    {
      key: 'koed',
      header: t('usage.koedRate'),
      align: 'center',
      sortable: true,
      sortValue: (p) => p.koed_rate ?? -1,
      render: (player) => (
        <span className="text-poke-text-secondary">
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
        <span className="text-poke-text-secondary">
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
        <span className="text-poke-text-secondary">
          {player.lead_rate !== null ? formatter.percentOf(player.lead_rate) : '—'}
        </span>
      ),
    },
  ], [t, formatter]);

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <div className="bg-poke-surface border border-poke-border rounded-poke-xl p-4 shadow-poke">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Scope type */}
          <div>
            <label className="block text-xs text-poke-text-secondary mb-1">{t('usage.scope')}</label>
            <select
              value={scopeType}
              onChange={(e) => handleScopeChange(e.target.value as ScopeFilter)}
              className="px-2 py-1.5 border border-poke-border rounded-poke-sm text-sm bg-poke-surface text-poke-text-primary"
            >
              <option value="all_time">{t('usage.allTime')}</option>
              <option value="league">{t('usage.league')}</option>
              <option value="tournament">{t('usage.tournament')}</option>
            </select>
          </div>

          {/* Specific scope selector */}
          {scopeType === 'league' && filters && (
            <div>
              <label className="block text-xs text-poke-text-secondary mb-1">{t('usage.league')}</label>
              <select
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                className="px-2 py-1.5 border border-poke-border rounded-poke-sm text-sm bg-poke-surface text-poke-text-primary"
              >
                <option value="">{t('usage.selectLeague')}</option>
                {filters.leagues.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
          )}

          {scopeType === 'tournament' && filters && (
            <div>
              <label className="block text-xs text-poke-text-secondary mb-1">{t('usage.tournament')}</label>
              <select
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                className="px-2 py-1.5 border border-poke-border rounded-poke-sm text-sm bg-poke-surface text-poke-text-primary"
              >
                <option value="">{t('usage.selectTournament')}</option>
                {filters.tournaments.map((tournament) => (
                  <option key={tournament.id} value={tournament.id}>{tournament.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Player filter */}
          {filters && filters.players.length > 0 && (
            <div>
              <label className="block text-xs text-poke-text-secondary mb-1">{t('usage.player')}</label>
              <select
                value={playerId}
                onChange={(e) => setPlayerId(e.target.value)}
                className="px-2 py-1.5 border border-poke-border rounded-poke-sm text-sm bg-poke-surface text-poke-text-primary"
              >
                <option value="">{t('usage.allPlayers')}</option>
                {filters.players.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {loading && (
            <span className="text-xs text-poke-text-muted animate-pulse pb-1.5">{t('usage.loading')}</span>
          )}
        </div>
      </div>

      {/* Stat Cards */}
      {hasData ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label={t('usage.usageRate')} value={formatter.percentOf(stats.usage_percent)} />
            <StatCard label={t('usage.winRate')} value={pct(stats.win_rate)} />
            <StatCard label={t('usage.kos')} value={formatter.number(stats.kos_dealt)} />
            <StatCard label={t('usage.koedRate')} value={formatter.percentOf(stats.koed_rate)} />
            <StatCard label={t('usage.bringRate')} value={pct(stats.bring_rate)} />
            <StatCard label={t('usage.leadRate')} value={pct(stats.lead_rate)} />
          </div>

          <div className="text-xs text-poke-text-muted">
            {t('usage.appearances', {
              count: stats.total_appearances,
              games: t('usage.gamesCount', { count: stats.total_games_in_scope }),
            })}
          </div>

          {/* Move Usage */}
          {stats.moves.length > 0 && (
            <Card variant="outlined" padding="md">
              <h3 className="text-sm font-heading font-semibold text-poke-text-secondary uppercase tracking-wide mb-3">
                {t('usage.moveUsage')}
              </h3>
              <div className="space-y-2">
                {stats.moves.map((move) => (
                  <div key={move.name} className="flex items-center gap-3">
                    <span className="w-32 text-sm font-medium text-poke-text-primary truncate">
                      {localizeMove(move.name, dl)}
                    </span>
                    <div className="flex-1 h-2 bg-poke-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-poke-blue rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(move.usage_percent, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-poke-text-muted w-16 text-right">
                      {formatter.percentOf(move.usage_percent)} ({formatter.number(move.count)})
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Player Breakdown */}
          {!playerId && stats.players.length > 0 && (
            <Card variant="outlined" padding="md">
              <h3 className="text-sm font-heading font-semibold text-poke-text-secondary uppercase tracking-wide mb-3">
                {t('usage.playerBreakdown')}
              </h3>
              <Table
                columns={playerColumns}
                data={stats.players}
                keyExtractor={(player) => player.player_id}
                emptyMessage={t('usage.noPlayerData')}
              />
            </Card>
          )}
        </>
      ) : (
        <div className="bg-poke-surface border border-poke-border rounded-poke-xl p-8 text-center shadow-poke">
          <p className="text-poke-text-muted">{t('usage.noDataPokemon')}</p>
          <p className="text-xs text-poke-text-muted mt-1">
            {t('usage.noDataPokemonHintFuture')}
          </p>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-poke-surface border border-poke-border rounded-poke-lg p-3 text-center shadow-poke-sm">
      <div className="text-lg font-heading font-bold text-poke-text-primary">{value}</div>
      <div className="text-xs text-poke-text-muted font-heading">{label}</div>
    </div>
  );
}
