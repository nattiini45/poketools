'use client';

import { useMemo } from 'react';
import Table, { type Column } from '@/components/ui/Table';
import { WikiEmptyState, WikiSection, WikiUsageBar } from '@/components/wiki/WikiParts';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { wikiMessages } from '@/i18n/messages/wiki';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import type { PokemonDetailStats, PokemonPlayerRow } from '@/types/game';

interface WikiUsageStatsProps {
  /** The stats of the page's one scope picker (the stats section above); this block has no controls of its own. */
  stats: PokemonDetailStats;
  loading: boolean;
  playerId: string;
  /** A row of the breakdown narrows the page to that player. */
  onSelectPlayer(playerId: string): void;
}

/** Battle stats of a Pokémon: item usage and the player breakdown, for the scope picked in the stats section. */
export default function WikiUsageStats({ stats, loading, playerId, onSelectPlayer }: WikiUsageStatsProps) {
  const t = useT(wikiMessages);
  const dl = useDataLocale();
  const formatter = useFormatter();
  const hasData = stats.total_appearances > 0;

  const playerColumns = useMemo((): Column<PokemonPlayerRow>[] => [
    {
      key: 'player',
      header: t('usage.player'),
      sortable: true,
      sortValue: (p) => p.player_name,
      render: (player) => (
        <button
          type="button"
          onClick={() => onSelectPlayer(player.player_id)}
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
      sortValue: (p) => p.koed_rate,
      render: (player) => (
        <span className="font-mono tabular-nums text-fg-muted">{formatter.percentOf(player.koed_rate)}</span>
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
  ], [t, formatter, onSelectPlayer]);

  return (
    <WikiSection title={t('usage.battleStats')}>
      {!loading && hasData ? (
        <>
          {stats.items.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-subtitle font-[550] text-fg">{t('usage.itemUsage')}</h3>
              <ul className="flex flex-col gap-2.5 rounded-poke-lg border border-hairline bg-surface p-4">
                {stats.items.map((item) => (
                  <WikiUsageBar
                    key={item.name}
                    label={localizeItem(item.name, dl)}
                    percent={item.usage_percent}
                    value={formatter.percentOf(item.usage_percent)}
                  />
                ))}
              </ul>
            </div>
          )}

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
      ) : !loading ? (
        <WikiEmptyState title={t('usage.noDataPokemon')} hint={t('usage.noDataPokemonHint')} />
      ) : null}
    </WikiSection>
  );
}
