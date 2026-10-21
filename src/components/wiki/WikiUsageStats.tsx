'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Card from '@/components/ui/Card';
import Table, { type Column } from '@/components/ui/Table';
import ScopeSelector from '@/components/shared/ScopeSelector';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { wikiMessages } from '@/i18n/messages/wiki';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import {
  wikiScopeToInsights,
  insightsScopeToWiki,
  type WikiUsageScopeType,
} from '@/lib/wiki/scope-bridge';
import type { InsightsScope } from '@/lib/insights/scope';
import type { PokemonDetailStats, PokemonFilterOptions, PokemonPlayerRow } from '@/types/game';

interface WikiUsageStatsProps {
  pokemonName: string;
}

export default function WikiUsageStats({ pokemonName }: WikiUsageStatsProps) {
  const t = useT(wikiMessages);
  const dl = useDataLocale();
  const formatter = useFormatter();
  const [stats, setStats] = useState<PokemonDetailStats | null>(null);
  const [filters, setFilters] = useState<PokemonFilterOptions | null>(null);
  const [scopeType, setScopeType] = useState<WikiUsageScopeType>('all_time');
  const [scopeId, setScopeId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [loading, setLoading] = useState(true);

  // Fetch filter options on mount
  useEffect(() => {
    void fetch(`/api/pokemon/${encodeURIComponent(pokemonName)}/filters`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setFilters(json.data);
      })
      .catch(() => { /* filters are optional */ });
  }, [pokemonName]);

  // Fetch stats
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
      if (json.success) setStats(json.data);
    } catch {
      // Keep existing stats on error
    } finally {
      setLoading(false);
    }
  }, [pokemonName, scopeType, scopeId, playerId]);

  // Fetch on mount and when filters change
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const leagueOptions = useMemo(
    () => filters?.leagues.map((l) => ({ id: l.id, name: l.name })) ?? [],
    [filters],
  );
  const tournamentOptions = useMemo(
    () => filters?.tournaments.map((tournament) => ({ id: tournament.id, name: tournament.name })) ?? [],
    [filters],
  );

  const insightsScope: InsightsScope = wikiScopeToInsights(scopeType, scopeId);

  const handleInsightsScopeChange = (next: InsightsScope) => {
    const wiki = insightsScopeToWiki(next);
    setScopeType(wiki.scopeType);
    setScopeId(wiki.scopeId);
  };

  const hasData = stats && stats.total_appearances > 0;
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
          className="text-poke-text-primary font-medium hover:text-poke-blue transition-colors text-left text-sm"
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
        <span className="text-poke-text-secondary text-sm">{player.games}</span>
      ),
    },
    {
      key: 'win_rate',
      header: t('usage.winRate'),
      align: 'center',
      sortable: true,
      sortValue: (p) => p.win_rate ?? -1,
      render: (player) => (
        <span className="text-poke-text-secondary text-sm">
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
        <span className="text-poke-text-secondary text-sm">{player.kos_dealt}</span>
      ),
    },
    {
      key: 'koed',
      header: t('usage.koedRate'),
      align: 'center',
      sortable: true,
      sortValue: (p) => p.koed_rate,
      render: (player) => (
        <span className="text-poke-text-secondary text-sm">{formatter.percentOf(player.koed_rate)}</span>
      ),
    },
    {
      key: 'bring',
      header: t('usage.bringRate'),
      align: 'center',
      sortable: true,
      sortValue: (p) => p.bring_rate ?? -1,
      render: (player) => (
        <span className="text-poke-text-secondary text-sm">
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
        <span className="text-poke-text-secondary text-sm">
          {player.lead_rate !== null ? formatter.percentOf(player.lead_rate) : '—'}
        </span>
      ),
    },
  ], [t, formatter]);

  return (
    <div className="space-y-4">
      <h2 className="font-heading text-sm font-semibold text-poke-text-secondary uppercase tracking-wide">
        {t('usage.battleStats')}
      </h2>

      {/* Filter Bar */}
      <div className="bg-poke-surface border border-poke-border rounded-poke-lg p-3 shadow-poke-sm">
        <div className="flex flex-wrap gap-3 items-end">
          {filters && (
            <ScopeSelector
              scope={insightsScope}
              leagues={leagueOptions}
              tournaments={tournamentOptions}
              onScopeChange={handleInsightsScopeChange}
            />
          )}

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

      {/* Stats Content */}
      {!loading && hasData && stats ? (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
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

          {/* Move Usage & Item Usage side by side */}
          {(stats.moves.length > 0 || stats.items.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Move Usage */}
              {stats.moves.length > 0 && (
                <Card variant="outlined" padding="md">
                  <h3 className="text-xs font-heading font-semibold text-poke-text-secondary uppercase tracking-wide mb-2">
                    {t('usage.moveUsage')}
                  </h3>
                  <div className="space-y-1.5">
                    {stats.moves.map((move) => (
                      <div key={move.name} className="flex items-center gap-2">
                        <span className="w-28 text-xs font-medium text-poke-text-primary truncate">
                          {localizeMove(move.name, dl)}
                        </span>
                        <div className="flex-1 h-1.5 bg-poke-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-poke-blue rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(move.usage_percent, 100)}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-poke-text-muted w-14 text-right">
                          {formatter.percentOf(move.usage_percent)}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Item Usage */}
              {stats.items.length > 0 && (
                <Card variant="outlined" padding="md">
                  <h3 className="text-xs font-heading font-semibold text-poke-text-secondary uppercase tracking-wide mb-2">
                    {t('usage.itemUsage')}
                  </h3>
                  <div className="space-y-1.5">
                    {stats.items.map((item) => (
                      <div key={item.name} className="flex items-center gap-2">
                        <span className="w-28 text-xs font-medium text-poke-text-primary truncate">
                          {localizeItem(item.name, dl)}
                        </span>
                        <div className="flex-1 h-1.5 bg-poke-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-400 rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(item.usage_percent, 100)}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-poke-text-muted w-14 text-right">
                          {formatter.percentOf(item.usage_percent)}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* Player Breakdown */}
          {!playerId && stats.players.length > 0 && (
            <Card variant="outlined" padding="md">
              <h3 className="text-xs font-heading font-semibold text-poke-text-secondary uppercase tracking-wide mb-2">
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
      ) : !loading ? (
        <div className="bg-poke-surface border border-poke-border rounded-poke-lg p-6 text-center shadow-poke-sm">
          <p className="text-poke-text-muted text-sm">{t('usage.noDataPokemon')}</p>
          <p className="text-xs text-poke-text-muted mt-1">
            {t('usage.noDataPokemonHint')}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-poke-surface border border-poke-border rounded-poke-lg p-2 text-center shadow-poke-sm">
      <div className="text-base font-heading font-bold text-poke-text-primary">{value}</div>
      <div className="text-[11px] text-poke-text-muted font-heading">{label}</div>
    </div>
  );
}
