'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Table, { type Column } from '@/components/ui/Table';
import { useDataLocale, useT } from '@/i18n/client';
import { wikiMessages } from '@/i18n/messages/wiki';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { ApiResult } from '@/types/api';
import type { MoveUsageResponse, PokemonFilterOptions } from '@/types/game';

type ScopeFilter = 'all_time' | 'league' | 'tournament';

interface MoveUsageEntry {
  pokemon_name: string;
  move_name: string;
  count: number;
}

interface ScopeOption {
  id: string;
  name: string;
}

export interface MoveUsageScopeOptions {
  leagues: ScopeOption[];
  tournaments: ScopeOption[];
}

export interface MoveUsageViewRequest {
  moveName: string;
  scopeType: ScopeFilter;
  scopeId: string;
  /** Also fetch the league/tournament options (once per move). */
  withScopeOptions: boolean;
}

export interface MoveUsageViewResult {
  /** This move's rows, highest count first; null when the stats request failed. */
  rows: MoveUsageEntry[] | null;
  /** Null when not requested, when nobody used the move, or when the lookup failed. */
  scopeOptions: MoveUsageScopeOptions | null;
}

/** True when the scope needs a league/tournament id before it can be queried. */
export function moveUsageScopeNeedsId(scopeType: ScopeFilter, scopeId: string): boolean {
  return scopeType !== 'all_time' && scopeId.length === 0;
}

/** The last view whose request settled, and whether its stats request failed. */
export interface SettledMoveUsageView {
  key: string;
  failed: boolean;
}

/**
 * What the widget shows for the current view. A view whose stats request
 * failed is 'failed', never 'ready': the rows still in state belong to the
 * previous view and must not be shown under the newly selected scope. A
 * league/tournament scope still waiting for an id (`viewKey` null) keeps the
 * previous view on screen: its rows, or its failure (after a failed first
 * load the rows are empty, and 'ready' would claim the move has no data).
 * With nothing settled yet it is 'loading': no view has answered, so the
 * widget makes no claim about the move's data.
 */
export function moveUsageViewStatus(
  viewKey: string | null,
  settled: SettledMoveUsageView | null,
): 'loading' | 'failed' | 'ready' {
  if (viewKey === null) return settled === null ? 'loading' : settled.failed ? 'failed' : 'ready';
  if (settled?.key !== viewKey) return 'loading';
  return settled.failed ? 'failed' : 'ready';
}

/** The single `/api/stats` URL one view of the widget requests (server-filtered to this move). */
export function buildMoveUsageStatsUrl(
  moveName: string,
  scopeType: ScopeFilter,
  scopeId: string,
): string {
  const params = new URLSearchParams({ view: 'moves', scope: scopeType, move: moveName });
  if (scopeId) params.set('scope_id', scopeId);
  return `/api/stats?${params}`;
}

/**
 * Load one view of the widget with exactly one `/api/stats` request. The
 * `move=` filter makes the server return only this move's rows. When scope
 * options are wanted, the Pokémon that used the move most supplies them
 * through `/api/pokemon/<name>/filters` (the leagues and tournaments it has
 * aggregates in); there is no second stats request to discover them.
 */
export async function loadMoveUsageView(
  request: MoveUsageViewRequest,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<MoveUsageViewResult> {
  const { moveName, scopeType, scopeId, withScopeOptions } = request;

  let rows: MoveUsageEntry[] | null = null;
  try {
    const res = await fetchImpl(buildMoveUsageStatsUrl(moveName, scopeType, scopeId), { signal });
    const json = (await res.json()) as ApiResult<MoveUsageResponse>;
    if (json.success) {
      // The server already filtered by move; the check keeps the widget correct
      // against a server that predates the `move=` filter.
      rows = (json.data?.rows ?? [])
        .filter((row) => row.move_name === moveName)
        .map((row) => ({ pokemon_name: row.pokemon_name, move_name: row.move_name, count: row.count }));
    } else {
      console.error('[WikiMoveUsageStats] stats request failed:', json.error);
    }
  } catch (err) {
    // An abort is routine (the view changed); offline or an unreadable
    // response is a failure the caller shows as such.
    if (!signal?.aborted) console.error('[WikiMoveUsageStats] stats request failed:', err);
    return { rows: null, scopeOptions: null };
  }

  const topUser = rows?.[0]?.pokemon_name;
  if (!withScopeOptions || !topUser) return { rows, scopeOptions: null };

  try {
    const res = await fetchImpl(`/api/pokemon/${encodeURIComponent(topUser)}/filters`, { signal });
    const json = (await res.json()) as ApiResult<PokemonFilterOptions>;
    if (!json.success) return { rows, scopeOptions: null };
    return {
      rows,
      scopeOptions: {
        leagues: json.data.leagues ?? [],
        tournaments: json.data.tournaments ?? [],
      },
    };
  } catch {
    // Scope options are optional; the all-time view still renders.
    return { rows, scopeOptions: null };
  }
}

interface WikiMoveUsageStatsProps {
  moveName: string;
}

export default function WikiMoveUsageStats({ moveName }: WikiMoveUsageStatsProps) {
  const t = useT(wikiMessages);
  const dl = useDataLocale();
  const [filteredData, setFilteredData] = useState<MoveUsageEntry[]>([]);
  const [scopeType, setScopeType] = useState<ScopeFilter>('all_time');
  const [scopeId, setScopeId] = useState('');
  const [scopeOptions, setScopeOptions] = useState<MoveUsageScopeOptions>({
    leagues: [],
    tournaments: [],
  });
  // The last view whose request settled; `loading` is derived from it, so the
  // effect never sets state synchronously.
  const [settled, setSettled] = useState<SettledMoveUsageView | null>(null);
  // The move whose scope options are loaded (set only when a response lands,
  // so a StrictMode double-invoke or an aborted request retries them).
  const scopeOptionsMoveRef = useRef<string | null>(null);

  const needsId = moveUsageScopeNeedsId(scopeType, scopeId);
  const viewKey = needsId ? null : `${moveName}|${scopeType}|${scopeId}`;
  const status = moveUsageViewStatus(viewKey, settled);
  const loading = status === 'loading';

  // One stats request per view. A league/tournament scope waits for an id
  // (the API rejects it without one), and the previous view stays on screen.
  useEffect(() => {
    if (viewKey === null) return;
    const controller = new AbortController();
    const withScopeOptions = scopeOptionsMoveRef.current !== moveName;

    void loadMoveUsageView(
      { moveName, scopeType, scopeId, withScopeOptions },
      fetch,
      controller.signal,
    ).then((view) => {
      if (controller.signal.aborted) return;
      if (view.rows) setFilteredData(view.rows);
      if (view.scopeOptions) {
        scopeOptionsMoveRef.current = moveName;
        setScopeOptions(view.scopeOptions);
      }
      setSettled({ key: viewKey, failed: view.rows === null });
    });

    return () => controller.abort();
  }, [viewKey, moveName, scopeType, scopeId]);

  const handleScopeChange = (newScope: ScopeFilter) => {
    setScopeType(newScope);
    setScopeId('');
  };

  const usageColumns = useMemo((): Column<MoveUsageEntry>[] => [
    {
      key: 'pokemon',
      header: t('usage.pokemon'),
      sortable: true,
      sortValue: (e) => localizeSpecies(e.pokemon_name, dl),
      render: (entry) => (
        <span className="font-medium text-poke-text-primary">{localizeSpecies(entry.pokemon_name, dl)}</span>
      ),
    },
    {
      key: 'count',
      header: t('usage.timesUsed'),
      align: 'right',
      sortable: true,
      sortValue: (e) => e.count,
      render: (entry) => (
        <span className="text-poke-text-secondary">{entry.count}</span>
      ),
    },
  ], [t, dl]);

  const totalUses = filteredData.reduce((sum, e) => sum + e.count, 0);

  return (
    <div className="space-y-4">
      <h2 className="font-heading text-sm font-semibold text-poke-text-secondary uppercase tracking-wide">
        {t('usage.battleUsage')}
      </h2>

      {/* Filter Bar */}
      <div className="bg-poke-surface border border-poke-border rounded-poke-lg p-3 shadow-poke-sm">
        <div className="flex flex-wrap gap-3 items-end">
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

          {scopeType === 'league' && scopeOptions.leagues.length > 0 && (
            <div>
              <label className="block text-xs text-poke-text-secondary mb-1">{t('usage.league')}</label>
              <select
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                className="px-2 py-1.5 border border-poke-border rounded-poke-sm text-sm bg-poke-surface text-poke-text-primary"
              >
                <option value="">{t('usage.selectLeague')}</option>
                {scopeOptions.leagues.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
          )}

          {scopeType === 'tournament' && scopeOptions.tournaments.length > 0 && (
            <div>
              <label className="block text-xs text-poke-text-secondary mb-1">{t('usage.tournament')}</label>
              <select
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                className="px-2 py-1.5 border border-poke-border rounded-poke-sm text-sm bg-poke-surface text-poke-text-primary"
              >
                <option value="">{t('usage.selectTournament')}</option>
                {scopeOptions.tournaments.map((tournament) => (
                  <option key={tournament.id} value={tournament.id}>{tournament.name}</option>
                ))}
              </select>
            </div>
          )}

          {loading && (
            <span className="text-xs text-poke-text-muted animate-pulse pb-1.5">{t('usage.loading')}</span>
          )}
        </div>
      </div>

      {/* Usage Content */}
      {status === 'failed' ? (
        <div className="bg-poke-surface border border-poke-border rounded-poke-lg p-6 text-center shadow-poke-sm">
          <p className="text-poke-text-muted text-sm">{t('usage.loadFailed')}</p>
          <p className="text-xs text-poke-text-muted mt-1">
            {t('usage.loadFailedHint')}
          </p>
        </div>
      ) : !loading && filteredData.length > 0 ? (
        <div className="bg-poke-surface border border-poke-border rounded-poke-lg shadow-poke-sm overflow-hidden p-4 space-y-3">
          <div className="text-xs text-poke-text-muted">
            {t('usage.usedAcross', { count: totalUses, pokemonCount: filteredData.length })}
          </div>
          <Table
            columns={usageColumns}
            data={filteredData}
            keyExtractor={(entry) => entry.pokemon_name}
            emptyMessage={t('usage.noDataMove')}
            defaultSort={{ key: 'count', direction: 'desc' }}
          />
        </div>
      ) : !loading ? (
        <div className="bg-poke-surface border border-poke-border rounded-poke-lg p-6 text-center shadow-poke-sm">
          <p className="text-poke-text-muted text-sm">{t('usage.noDataMove')}</p>
          <p className="text-xs text-poke-text-muted mt-1">
            {t('usage.noDataMoveHint')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
