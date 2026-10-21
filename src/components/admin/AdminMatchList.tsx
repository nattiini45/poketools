'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import type { MatchWithTournament } from '@/lib/supabase/queries/matches';
import type { ApiResult } from '@/types/api';
import MatchStatusBadge from '@/components/match/MatchStatusBadge';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import Skeleton from '@/components/ui/Skeleton';
import { getButtonClasses } from '@/components/ui/Button';
import { AnimatedList, AnimatedListItem } from '@/components/shared/AnimatedList';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { shellMessages } from '@/i18n/messages/shell';
import { errorsAdmin } from '@/i18n/messages/errors';
import type shellEn from '@/i18n/messages/shell/en';

type StatusFilterKey = keyof typeof shellEn.admin.matches.status;

/** Status tabs: the API filter value and its label key in `shell.admin.matches.status`. */
const STATUS_FILTERS: { value: string; labelKey: StatusFilterKey }[] = [
  { value: '', labelKey: 'all' },
  { value: 'scheduled', labelKey: 'scheduled' },
  { value: 'in_progress', labelKey: 'in_progress' },
  { value: 'pending_confirmation', labelKey: 'pending_confirmation' },
  { value: 'completed', labelKey: 'completed' },
  { value: 'disputed', labelKey: 'disputed' },
];

interface TournamentOption {
  id: string;
  name: string;
  season_name: string | null;
}

const PAGE_SIZE = 100;

export default function AdminMatchList() {
  const t = useT(shellMessages);
  const errorText = useApiErrorText(errorsAdmin);
  const [matches, setMatches] = useState<MatchWithTournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [tournamentFilter, setTournamentFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  // The API's error (or a load failure without one); translated at render.
  const [error, setError] = useState<{ kind: 'api'; error: ApiErrorLike } | { kind: 'loadFailed' } | null>(null);
  const [page, setPage] = useState(0);

  // Fetch tournament list on mount for dropdown
  useEffect(() => {
    void fetch('/api/tournaments')
      .then(res => res.json())
      .then((result: ApiResult<TournamentOption[]>) => {
        if (result.success) setTournaments(result.data);
      })
      .catch(() => {});
  }, []);

  const fetchMatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (tournamentFilter) params.set('tournament_id', tournamentFilter);

      const res = await fetch(`/api/admin/matches?${params}`);
      const result: ApiResult<MatchWithTournament[]> = await res.json();
      if (result.success) {
        setMatches(result.data);
      } else {
        setError({ kind: 'api', error: toApiErrorLike(result) });
      }
    } catch {
      setError({ kind: 'loadFailed' });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, tournamentFilter]);

  useEffect(() => {
    fetchMatches();
  }, [fetchMatches]);

  // Reset page when filters or search change
  useEffect(() => {
    setPage(0);
  }, [searchQuery, statusFilter, tournamentFilter]);

  // Client-side search filtering
  const filteredMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return matches;
    return matches.filter(m =>
      m.player_1_name.toLowerCase().includes(q) ||
      m.player_2_name.toLowerCase().includes(q) ||
      m.tournament_name.toLowerCase().includes(q) ||
      m.id.toLowerCase().startsWith(q)
    );
  }, [matches, searchQuery]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredMatches.length / PAGE_SIZE));
  const pagedMatches = filteredMatches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Group tournaments by season for <optgroup>
  const tournamentGroups = useMemo(() => {
    const standalone: TournamentOption[] = [];
    const bySeasonMap = new Map<string, TournamentOption[]>();

    for (const t of tournaments) {
      if (t.season_name) {
        const group = bySeasonMap.get(t.season_name) ?? [];
        group.push(t);
        bySeasonMap.set(t.season_name, group);
      } else {
        standalone.push(t);
      }
    }

    return { standalone, bySeason: Array.from(bySeasonMap.entries()) };
  }, [tournaments]);

  return (
    <div className="space-y-4">
      {/* Search + Tournament Filter row */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-poke-text-muted pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('admin.matches.searchPlaceholder')}
            className="w-full pl-9 pr-3 py-2 border border-poke-border bg-poke-surface rounded-poke-md text-sm text-poke-text-primary placeholder:text-poke-text-muted focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors"
          />
        </div>
        <select
          value={tournamentFilter}
          onChange={e => setTournamentFilter(e.target.value)}
          className="border border-poke-border bg-poke-surface rounded-poke-md px-3 py-2 text-sm text-poke-text-primary focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors sm:w-64"
        >
          <option value="">{t('admin.matches.allTournaments')}</option>
          {tournamentGroups.standalone.map(tournament => (
            <option key={tournament.id} value={tournament.id}>{tournament.name}</option>
          ))}
          {tournamentGroups.bySeason.map(([seasonName, seasonTournaments]) => (
            <optgroup key={seasonName} label={seasonName}>
              {seasonTournaments.map(tournament => (
                <option key={tournament.id} value={tournament.id}>{tournament.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 border-b border-poke-border overflow-x-auto">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={`px-3 py-2 text-xs font-heading font-medium border-b-2 transition-colors whitespace-nowrap ${
              statusFilter === f.value
                ? 'border-poke-accent text-poke-accent'
                : 'border-transparent text-poke-text-muted hover:text-poke-text-primary'
            }`}
          >
            {t(`admin.matches.status.${f.labelKey}`)}
          </button>
        ))}
      </div>

      {error && (
        <Alert variant="error">
          {error.kind === 'loadFailed' ? t('admin.matches.loadFailed') : errorText(error.error)}
        </Alert>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} height="72px" rounded="lg" />
          ))}
        </div>
      ) : filteredMatches.length === 0 ? (
        <p className="text-sm text-poke-text-muted">
          {searchQuery ? t('admin.matches.noSearchResults') : t('admin.matches.none')}
        </p>
      ) : (
        <>
          <AnimatedList className="space-y-2">
            {pagedMatches.map((m) => {
              const canSubmit =
                m.status === 'scheduled' || m.status === 'in_progress';
              const matchHref = `/tournaments/${m.tournament_id}/matches/${m.id}`;
              return (
                <AnimatedListItem key={m.id}>
                  <Link href={matchHref} className="block group">
                    <Card variant="outlined" padding="sm" className="transition-colors group-hover:border-poke-border-focus">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-heading font-medium text-sm text-poke-text-primary truncate group-hover:text-poke-accent transition-colors">
                            {t('admin.matches.versus', { player1: m.player_1_name, player2: m.player_2_name })}
                          </span>
                          {m.winner_name && (
                            <span className="text-xs text-poke-green shrink-0">
                              {t('admin.matches.winner', { name: m.winner_name })}
                            </span>
                          )}
                        </div>
                        <MatchStatusBadge status={m.status} />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-poke-text-muted truncate">
                          {m.tournament_name}
                        </span>
                        <div className="flex gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                          <Link
                            href={`/admin/matches/${m.id}`}
                            className={getButtonClasses('ghost', 'sm')}
                          >
                            {t('admin.matches.override')}
                          </Link>
                          {canSubmit && (
                            <Link
                              href={`/dashboard/submit/${m.id}`}
                              className={getButtonClasses('secondary', 'sm')}
                            >
                              {t('admin.matches.submitResult')}
                            </Link>
                          )}
                          {canSubmit && (
                            <Link
                              href={`/dashboard/match-prep/${m.id}`}
                              className={getButtonClasses('ghost', 'sm')}
                            >
                              {t('admin.matches.viewPrep')}
                            </Link>
                          )}
                        </div>
                      </div>
                    </Card>
                  </Link>
                </AnimatedListItem>
              );
            })}
          </AnimatedList>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-poke-text-muted">
                {t('admin.matches.summary', { count: filteredMatches.length, page: page + 1, pages: totalPages })}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className={`${getButtonClasses('ghost', 'sm')} disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  {t('admin.matches.previous')}
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className={`${getButtonClasses('ghost', 'sm')} disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  {t('admin.matches.next')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
