'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Player, PlayerRegistration } from '@/types/player';
import type { ApiResponse, ApiResult } from '@/types/api';
import Button from '@/components/ui/Button';
import GuestBadge from '@/components/shared/GuestBadge';
import Select from '@/components/ui/Select';
import SkewChip from '@/components/ui/SkewChip';
import AdminDialog from '@/components/admin/AdminDialog';
import AdminEmpty from '@/components/admin/AdminEmpty';
import { CELL, NAME_CELL, ROW, TABLE, TABLE_FRAME, TBODY, TH, TOUCH } from '@/components/admin/admin-table';
import { CHOICE, CHOICE_OFF, CHOICE_ON, FOCUS } from '@/components/admin/match-styles';
import { TablePagination } from '@/components/ui/Table';
import SortIcon from '@/components/admin/SortIcon';
import { cn } from '@/lib/utils/cn';
import Input from '@/components/ui/Input';
import Alert from '@/components/ui/Alert';
import { useT } from '@/i18n/client';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { uiMessages } from '@/i18n/messages/ui';
import type { PlayerSortColumn } from '@/lib/players/player-sort';
import { playerStatusMachine } from '@/lib/players/player-status-state';
import { cycleColumnSort } from '@/lib/ui/table-params';
import {
  RosterActionAlert,
  RosterLoadError,
  apiError,
  useRosterErrorText,
  type RosterActionNotice,
  type RosterError,
} from './RosterNotices';
import { RosterStatusCell } from './RosterStatusCell';
import {
  buildRosterSearch,
  lastPage,
  localDateTimeToIso,
  openDialog,
  parseRosterUrl,
  roleConfirmKind,
  rosterQuery,
  rosterView,
  type RosterConfirmKind,
  type RosterUrlState,
} from './roster-helpers';

interface PlayerRosterProps {
  /** The superadmin: the only viewer who may grant or revoke the admin and creator roles. */
  canManageCreators: boolean;
  /**
   * The superadmin's own player row for a viewer who is not the superadmin: the API refuses every
   * edit of it, so the roster offers no Edit control there. Null for the superadmin and when none exists.
   */
  protectedPlayerId?: string | null;
}

/** `GET /api/players`: one page of the directory plus the exact number of matching players. */
type PlayersPage = ApiResponse<Player[]> & { total?: number };

/** Wait this long after the last keystroke before the search hits the server. */
const SEARCH_DEBOUNCE_MS = 300;
/** The guest-link picker lists at most this many accounts per search. */
const LINK_PICKER_LIMIT = 50;

/** Whether the roster offers the moderation action `event` for this player: the admin moves of `playerStatusMachine`. */
function canModerate(player: Player, event: 'suspend' | 'ban' | 'reinstate'): boolean {
  return playerStatusMachine.transitionsFrom(player.status, 'admin').some((t) => t.event === event);
}

/** The confirm button colour: red where the click is hard to undo, plain where it only restores. */
const CONFIRM_VARIANT: Record<RosterConfirmKind, 'danger' | 'primary'> = {
  makeAdmin: 'danger',
  removeAdmin: 'danger',
  makeCreator: 'primary',
  removeCreator: 'danger',
  delete: 'danger',
  reinstate: 'primary',
};

const FIELD = `min-h-11 w-full rounded-poke-md border border-hairline-strong bg-surface px-2 py-1 text-body text-fg sm:min-h-9 ${FOCUS}`;
const ACT = `rounded-sm px-1 font-[550] underline-offset-2 hover:underline min-h-11 sm:min-h-0 ${FOCUS}`;

/** One JSON request to a players route; a network or parse failure throws. */
async function requestJson(url: string, init?: RequestInit): Promise<ApiResult<unknown>> {
  const res = await fetch(url, init);
  return (await res.json()) as ApiResult<unknown>;
}

function patchPlayer(id: string, body: object): Promise<ApiResult<unknown>> {
  return requestJson(`/api/players/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The request behind a confirmed dialog. */
function confirmedRequest(kind: RosterConfirmKind, player: Player): Promise<ApiResult<unknown>> {
  switch (kind) {
    case 'makeAdmin':
    case 'removeAdmin':
      return patchPlayer(player.id, { is_admin: !player.is_admin });
    case 'makeCreator':
    case 'removeCreator':
      return patchPlayer(player.id, { is_creator: !player.is_creator });
    case 'delete':
      return requestJson(`/api/players/${player.id}`, { method: 'DELETE' });
    case 'reinstate':
      return requestJson(`/api/admin/players/${player.id}/unsuspend`, { method: 'POST' });
  }
}

/**
 * `update(patch)` for the roster's URL state: merges the patch (or the function's result) into
 * the state and hands the new query string to `replace`. It merges into a ref moved on every
 * update, so two updates in one tick (a debounced search right after a sort click) compose
 * instead of the second dropping the first.
 */
function useRosterUpdate(url: RosterUrlState, replace: (search: string) => void) {
  const urlRef = useRef(url);
  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  return useCallback(
    (patch: Partial<RosterUrlState> | ((current: RosterUrlState) => Partial<RosterUrlState>)) => {
      const next = { ...urlRef.current, ...(typeof patch === 'function' ? patch(urlRef.current) : patch) };
      urlRef.current = next;
      replace(buildRosterSearch(next));
    },
    [replace],
  );
}

export default function PlayerRoster({ canManageCreators, protectedPlayerId = null }: PlayerRosterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The URL is the source of truth for the search, the sort, the page and the page size.
  const url = useMemo(() => parseRosterUrl(searchParams ?? new URLSearchParams()), [searchParams]);
  const replaceSearch = useCallback(
    (search: string) => router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false }),
    [router, pathname],
  );
  const update = useRosterUpdate(url, replaceSearch);
  const { page, perPage } = url;
  const search = url.q.trim();
  // null = the directory's default order (name, ascending); the server applies the order.
  const sortKey = url.sort?.key ?? null;
  const sortDirection = url.sort?.direction ?? null;
  const sort = useMemo(
    () => (sortKey && sortDirection ? { key: sortKey, direction: sortDirection } : null),
    [sortKey, sortDirection],
  );

  const [players, setPlayers] = useState<Player[]>([]);
  const [total, setTotal] = useState(0);
  // The search box: local text, sent to the URL (and so the server) after a pause.
  const [searchInput, setSearchInput] = useState(url.q);
  // The q this box last put in the URL, and the URL q last seen: a URL q that this box did not
  // send (back / forward, a link) replaces the text; the echo of our own send does not.
  const [sentQ, setSentQ] = useState(url.q);
  const [seenQ, setSeenQ] = useState(url.q);
  if (url.q !== seenQ) {
    setSeenQ(url.q);
    if (url.q !== sentQ) {
      setSentQ(url.q);
      setSearchInput(url.q);
    }
  }
  // `loaded` flips once the first request settles; later requests keep the table mounted.
  const [loaded, setLoaded] = useState(false);
  // Some request returned rows: a later failed refresh then keeps those rows on screen.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [fetching, setFetching] = useState(false);
  const latestRequest = useRef(0);
  const t = useT(adminCoreMessages);
  const tui = useT(uiMessages);
  const errorMessage = useRosterErrorText();
  // Why the directory could not be loaded; apart from `actionNotice`, which never touches the rows.
  const [loadError, setLoadError] = useState<RosterError | null>(null);
  // A failed row action or add; stays until dismissed or the next action.
  const [actionNotice, setActionNotice] = useState<RosterActionNotice | null>(null);
  // A failure from inside an open dialog; shown in the dialog, not behind it.
  const [dialogError, setDialogError] = useState<RosterError | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', ps_username: '' });

  // Admin / creator / delete / reinstate confirmation
  const [pendingConfirm, setPendingConfirm] = useState<{ kind: RosterConfirmKind; player: Player } | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Suspend dialog state
  const [suspendTarget, setSuspendTarget] = useState<Player | null>(null);
  const [suspendUntil, setSuspendUntil] = useState('');
  const [suspendAction, setSuspendAction] = useState<'suspend' | 'ban'>('suspend');
  const [banReason, setBanReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const [linkGuest, setLinkGuest] = useState<Player | null>(null);
  const [linkSourceId, setLinkSourceId] = useState('');
  const [linkSearch, setLinkSearch] = useState('');
  const [linkResults, setLinkResults] = useState<Player[]>([]);
  const [linking, setLinking] = useState(false);

  const fetchPlayers = useCallback(async () => {
    // Only the newest request may write state: a slow answer to an older
    // search or page must not overwrite a newer one.
    const requestId = ++latestRequest.current;
    let steppingBack = false;
    setFetching(true);
    try {
      const res = await fetch(`/api/players?${rosterQuery({ page, perPage, search, sort })}`);
      const json = (await res.json()) as ApiResult<Player[]> | PlayersPage;
      if (requestId !== latestRequest.current) return;
      if (json.success) {
        const count = 'total' in json && typeof json.total === 'number' ? json.total : json.data.length;
        if (json.data.length === 0 && count > 0 && page > 1) {
          // The last row of the last page went away (or the link names a page past the end):
          // step back to the new last page, which reloads.
          steppingBack = true;
          update({ page: lastPage(count, perPage) });
          return;
        }
        setLoadError(null);
        setPlayers(json.data);
        setTotal(count);
        setHasLoadedOnce(true);
      } else {
        setLoadError(apiError(json));
      }
    } catch {
      if (requestId === latestRequest.current) setLoadError({ local: 'loadFailed' });
    } finally {
      if (requestId === latestRequest.current) {
        setFetching(false);
        if (!steppingBack) setLoaded(true);
      }
    }
  }, [page, perPage, search, sort, update]);

  useEffect(() => {
    fetchPlayers();
  }, [fetchPlayers]);

  // Typing filters the whole directory on the server, after a short pause.
  useEffect(() => {
    const next = searchInput.trim();
    if (next === sentQ.trim()) return;
    const handle = setTimeout(() => {
      setSentQ(next);
      update({ q: next, page: 1 });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput, sentQ, update]);

  // The guest-link picker searches the directory itself: the roster page only
  // holds one page of players, so the account to merge may not be on it.
  useEffect(() => {
    if (!linkGuest) return;
    let cancelled = false;
    const handle = setTimeout(
      async () => {
        try {
          const query = rosterQuery({ page: 1, perPage: LINK_PICKER_LIMIT, search: linkSearch });
          const res = await fetch(`/api/players?${query}`);
          const json = (await res.json()) as ApiResult<Player[]>;
          if (cancelled) return;
          if (json.success) {
            setDialogError(null);
            setLinkResults(json.data);
          } else {
            setDialogError(apiError(json));
          }
        } catch {
          if (!cancelled) setDialogError({ local: 'loadFailed' });
        }
      },
      linkSearch ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [linkGuest, linkSearch]);

  const retryLoad = () => {
    // Nothing was ever loaded: go back to the loading line instead of the stale failure.
    if (!hasLoadedOnce) setLoaded(false);
    void fetchPlayers();
  };

  // Ordering is the server's job (the table only holds one page): a header click
  // cycles asc, desc, default and restarts at the first page.
  const handleSort = useCallback(
    (column: string) => update((current) => ({ sort: cycleColumnSort(current.sort, column), page: 1 })),
    [update],
  );

  /**
   * Runs one row action. A failure (an API error or a thrown network error) becomes the action
   * notice and never touches the roster itself; the previous notice is cleared first.
   * Resolves true when the request succeeded.
   */
  const runAction = useCallback(
    async (kind: RosterActionNotice['kind'], name: string, request: () => Promise<ApiResult<unknown>>) => {
      setActionNotice(null);
      try {
        const json = await request();
        if (json.success) return true;
        setActionNotice({ kind, name, error: apiError(json) });
      } catch {
        setActionNotice({ kind, name, error: { local: 'actionFailed' } });
      }
      return false;
    },
    [],
  );

  const handleAdd = async (data: PlayerRegistration) => {
    const ok = await runAction('add', data.name, () =>
      requestJson('/api/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    );
    if (ok) {
      setShowForm(false);
      fetchPlayers();
    }
  };

  const askConfirm = useCallback((kind: RosterConfirmKind, player: Player) => {
    setPendingConfirm({ kind, player });
  }, []);

  const handleConfirm = async () => {
    if (!pendingConfirm || confirming) return;
    const { kind, player } = pendingConfirm;
    setConfirming(true);
    const ok = await runAction('action', player.name, () => confirmedRequest(kind, player));
    setConfirming(false);
    setPendingConfirm(null);
    if (ok) fetchPlayers();
  };

  const openSuspendDialog = useCallback((player: Player) => {
    setDialogError(null);
    setSuspendTarget(player);
    setSuspendUntil('');
    setBanReason('');
    setSuspendAction('suspend');
  }, []);

  const openBanDialog = useCallback((player: Player) => {
    setDialogError(null);
    setSuspendTarget(player);
    setSuspendUntil('');
    setBanReason('');
    setSuspendAction('ban');
  }, []);

  const closeDialog = () => {
    setDialogError(null);
    setSuspendTarget(null);
    setSuspendUntil('');
    setBanReason('');
  };

  const handleSuspend = async () => {
    // The picker holds wall-clock time in this browser's zone; send the instant it means.
    const suspendedUntilIso = localDateTimeToIso(suspendUntil);
    if (!suspendTarget || !suspendedUntilIso) return;
    setActionLoading(true);
    setActionNotice(null);
    setDialogError(null);
    try {
      const res = await fetch(`/api/admin/players/${suspendTarget.id}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'suspend', suspended_until: suspendedUntilIso }),
      });
      const json = (await res.json()) as ApiResult<Player>;
      if (json.success) {
        closeDialog();
        fetchPlayers();
      } else {
        setDialogError(apiError(json));
      }
    } catch {
      setDialogError({ local: 'suspendFailed' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleBan = async () => {
    if (!suspendTarget || !banReason.trim()) return;
    setActionLoading(true);
    setActionNotice(null);
    setDialogError(null);
    try {
      const res = await fetch(`/api/admin/players/${suspendTarget.id}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'ban', ban_reason: banReason }),
      });
      const json = (await res.json()) as ApiResult<Player>;
      if (json.success) {
        closeDialog();
        fetchPlayers();
      } else {
        setDialogError(apiError(json));
      }
    } catch {
      setDialogError({ local: 'banFailed' });
    } finally {
      setActionLoading(false);
    }
  };

  const linkCandidates = linkResults.filter(
    (p) =>
      !p.is_guest &&
      p.id !== linkGuest?.id &&
      (p.discord_id || p.auth_user_id) &&
      // The claim refuses a banned or suspended source (SOURCE_NOT_ACTIVE): do not offer one.
      p.status === 'active',
  );

  const handleLinkAccount = async () => {
    if (!linkGuest || !linkSourceId) return;
    setLinking(true);
    setActionNotice(null);
    setDialogError(null);
    try {
      const res = await fetch(`/api/players/${linkGuest.id}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_player_id: linkSourceId }),
      });
      const json = (await res.json()) as ApiResult<Player>;
      if (json.success) {
        setLinkGuest(null);
        setLinkSourceId('');
        fetchPlayers();
      } else {
        setDialogError(apiError(json));
      }
    } catch {
      setDialogError({ local: 'linkFailed' });
    } finally {
      setLinking(false);
    }
  };

  const startEditing = useCallback((player: Player) => {
    setEditingId(player.id);
    setEditForm({
      name: player.name,
      ps_username: player.ps_username,
    });
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return;
    const payload = { name: editForm.name, ps_username: editForm.ps_username };
    const name = players.find((p) => p.id === editingId)?.name ?? editForm.name;
    // A failed save keeps the row in edit mode with its input.
    if (await runAction('action', name, () => patchPlayer(editingId, payload))) {
      setEditingId(null);
      fetchPlayers();
    }
  }, [editForm, editingId, fetchPlayers, players, runAction]);

  const view = rosterView({ loaded, hasLoadedOnce, hasLoadError: loadError !== null });
  if (view === 'loading') return <p className="text-fg-muted">{t('players.loading')}</p>;
  // The first load failed: no rows, and no telling an empty directory from an unreachable one.
  if (view === 'blocked' && loadError) return <RosterLoadError error={loadError} onRetry={retryLoad} />;

  const dialog = openDialog(suspendTarget, suspendAction);

  const sortable: { key: PlayerSortColumn; header: string }[] = [
    { key: 'name', header: t('players.columns.name') },
    { key: 'discord_id', header: t('players.columns.discordId') },
    { key: 'ps_username', header: t('players.columns.psUsername') },
    { key: 'status', header: t('players.columns.status') },
  ];
  const totalPages = Math.max(1, lastPage(total, perPage));
  const editingRow = (player: Player) => editingId === player.id;

  const roleChip = (player: Player, role: 'is_admin' | 'is_creator') => {
    const on = role === 'is_admin' ? player.is_admin : player.is_creator;
    const label =
      role === 'is_admin'
        ? on ? t('players.roles.admin') : t('players.roles.player')
        : on ? t('players.roles.creator') : '—';
    const chip = <SkewChip tone={on ? (role === 'is_admin' ? 'accent' : 'tier-1') : 'neutral'}>{label}</SkewChip>;
    if (editingRow(player) || !canManageCreators) return chip;
    return (
      <button
        type="button"
        onClick={() => askConfirm(roleConfirmKind(player, role), player)}
        className={cn('inline-flex min-h-11 items-center rounded-sm sm:min-h-0', FOCUS)}
      >
        {chip}
      </button>
    );
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 sm:max-w-sm">
          <Input
            label={t('players.search.label')}
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('players.search.placeholder')}
            maxLength={100}
          />
        </div>
        <Button variant="primary" onClick={() => setShowForm(!showForm)} className={TOUCH}>
          {showForm ? t('players.cancel') : t('players.addPlayer')}
        </Button>
      </div>

      {showForm && <AddPlayerForm onSubmit={handleAdd} />}

      {actionNotice && <RosterActionAlert notice={actionNotice} onDismiss={() => setActionNotice(null)} />}
      {loadError && <RosterLoadError error={loadError} onRetry={retryLoad} />}

      <div role="group" aria-label={t('players.sortBy')} className="mb-3 flex flex-wrap items-center gap-2 xl:hidden">
        <span className="text-caption text-fg-muted">{t('players.sortBy')}</span>
        {sortable.map((column) => (
          <button
            key={column.key}
            type="button"
            onClick={() => handleSort(column.key)}
            aria-pressed={sortKey === column.key}
            className={cn(CHOICE, sortKey === column.key ? CHOICE_ON : CHOICE_OFF)}
          >
            {column.header}
            <SortIcon active={sortKey === column.key} direction={sortDirection} />
          </button>
        ))}
      </div>

      <div aria-busy={fetching} className={fetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        {players.length === 0 ? (
          <AdminEmpty
            title={search ? t('players.noMatches') : t('players.empty')}
            hint={search ? t('players.noMatchesHint') : t('players.emptyHint')}
            data-roster-empty
          />
        ) : (
          <div className={TABLE_FRAME}>
            <table className={TABLE} data-roster-table>
              <caption className="sr-only">{t('players.title')}</caption>
              <thead className="max-xl:hidden xl:table-header-group">
                <tr>
                  {sortable.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      className={TH}
                      aria-sort={sortKey === column.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      <button
                        type="button"
                        onClick={() => handleSort(column.key)}
                        className={cn('inline-flex items-center gap-1 rounded-sm hover:text-fg', FOCUS, sortKey === column.key && 'text-fg')}
                      >
                        <span>{column.header}</span>
                        <SortIcon active={sortKey === column.key} direction={sortDirection} />
                      </button>
                    </th>
                  ))}
                  <th scope="col" className={TH}>{t('players.columns.admin')}</th>
                  <th scope="col" className={TH}>{t('players.columns.creator')}</th>
                  <th scope="col" className={cn(TH, 'xl:text-right')}>{t('players.columns.actions')}</th>
                </tr>
              </thead>
              <tbody className={TBODY}>
                {players.map((player) => (
                  <tr key={player.id} className={ROW}>
                    <td className={NAME_CELL}>
                      {editingRow(player) ? (
                        <input
                          value={editForm.name}
                          onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                          aria-label={t('players.columns.name')}
                          className={FIELD}
                        />
                      ) : (
                        <span className="inline-flex flex-wrap items-center gap-2 break-words text-subtitle text-fg xl:text-body xl:font-[550]">
                          {player.name}
                          {player.is_guest && <GuestBadge />}
                        </span>
                      )}
                    </td>
                    <td data-label={t('players.columns.discordId')} className={CELL}>
                      <span className="min-w-0 break-all text-fg-muted">{player.discord_id ?? '—'}</span>
                    </td>
                    <td data-label={t('players.columns.psUsername')} className={CELL}>
                      {editingRow(player) ? (
                        <input
                          value={editForm.ps_username}
                          onChange={(e) => setEditForm((f) => ({ ...f, ps_username: e.target.value }))}
                          aria-label={t('players.columns.psUsername')}
                          className={FIELD}
                        />
                      ) : (
                        <span className="min-w-0 break-words text-fg">{player.ps_username || '—'}</span>
                      )}
                    </td>
                    <td data-label={t('players.columns.status')} className={CELL}>
                      <RosterStatusCell player={player} />
                    </td>
                    <td data-label={t('players.columns.admin')} className={CELL}>
                      {roleChip(player, 'is_admin')}
                    </td>
                    <td data-label={t('players.columns.creator')} className={CELL}>
                      {roleChip(player, 'is_creator')}
                    </td>
                    <td className="block max-xl:col-span-2 max-xl:border-t max-xl:border-hairline max-xl:pt-2 xl:table-cell xl:px-3 xl:py-3 xl:align-top xl:text-right">
                      <span className="flex flex-wrap gap-x-3 gap-y-1 xl:justify-end">
                        {editingRow(player) ? (
                          <>
                            <button type="button" onClick={handleSaveEdit} className={cn(ACT, 'text-win')}>
                              {t('players.rowActions.save')}
                            </button>
                            <button type="button" onClick={() => setEditingId(null)} className={cn(ACT, 'text-fg-muted')}>
                              {t('players.rowActions.cancel')}
                            </button>
                          </>
                        ) : (
                          <>
                            {player.id !== protectedPlayerId && (
                              <button type="button" onClick={() => startEditing(player)} className={cn(ACT, 'text-accent-ink')}>
                                {t('players.rowActions.edit')}
                              </button>
                            )}
                            {player.is_guest && (
                              <button
                                type="button"
                                onClick={() => {
                                  setDialogError(null);
                                  setLinkGuest(player);
                                  setLinkSourceId('');
                                  setLinkSearch('');
                                  setLinkResults([]);
                                }}
                                className={cn(ACT, 'text-accent-ink')}
                              >
                                {t('players.rowActions.linkAccount')}
                              </button>
                            )}
                            {player.id !== protectedPlayerId && (
                              <>
                                {canModerate(player, 'reinstate') && (
                                  <button type="button" onClick={() => askConfirm('reinstate', player)} className={cn(ACT, 'text-win')}>
                                    {t('players.rowActions.reinstate')}
                                  </button>
                                )}
                                {canModerate(player, 'suspend') && (
                                  <button type="button" onClick={() => openSuspendDialog(player)} className={cn(ACT, 'text-fg')}>
                                    {t('players.rowActions.suspend')}
                                  </button>
                                )}
                                {canModerate(player, 'ban') && (
                                  <button type="button" onClick={() => openBanDialog(player)} className={cn(ACT, 'text-loss')}>
                                    {t('players.rowActions.ban')}
                                  </button>
                                )}
                                <button type="button" onClick={() => askConfirm('delete', player)} className={cn(ACT, 'text-loss')}>
                                  {t('players.rowActions.delete')}
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 && (
          <TablePagination
            className="mt-3"
            page={page}
            totalPages={totalPages}
            perPage={perPage}
            totalItems={total}
            onPageChange={(next) => update({ page: next })}
            onPerPageChange={(size) => update({ perPage: size, page: 1 })}
          />
        )}
      </div>

      <AdminDialog
        open={pendingConfirm !== null}
        onClose={() => {
          if (!confirming) setPendingConfirm(null);
        }}
        title={pendingConfirm ? t(`players.confirm.${pendingConfirm.kind}.title`, { name: pendingConfirm.player.name }) : ''}
        size="sm"
      >
        {pendingConfirm && (
          <>
            <p className="mb-5 text-body text-fg-muted">
              {t(`players.confirm.${pendingConfirm.kind}.body`, { name: pendingConfirm.player.name })}
            </p>
            <div className="flex flex-wrap justify-end gap-3">
              <Button variant="ghost" className={TOUCH} onClick={() => setPendingConfirm(null)} disabled={confirming}>
                {tui('confirmDialog.cancel')}
              </Button>
              <Button variant={CONFIRM_VARIANT[pendingConfirm.kind]} className={TOUCH} onClick={handleConfirm} loading={confirming}>
                {t(`players.confirm.${pendingConfirm.kind}.confirm`)}
              </Button>
            </div>
          </>
        )}
      </AdminDialog>

      <AdminDialog
        open={linkGuest !== null}
        onClose={() => setLinkGuest(null)}
        title={linkGuest ? t('players.link.title', { name: linkGuest.name }) : ''}
      >
        <div className="space-y-4">
          <p className="text-body text-fg-muted">{t('players.link.body')}</p>
          {dialogError && <Alert variant="error">{errorMessage(dialogError)}</Alert>}
          <Input
            label={t('players.link.searchLabel')}
            type="search"
            value={linkSearch}
            onChange={(e) => {
              setLinkSearch(e.target.value);
              setLinkSourceId('');
            }}
            placeholder={t('players.link.searchPlaceholder')}
            maxLength={100}
          />
          {linkSearch && linkCandidates.length === 0 && (
            <p className="text-body text-fg-muted">{t('players.link.noMatches')}</p>
          )}
          <Select value={linkSourceId} onChange={(e) => setLinkSourceId(e.target.value)} aria-label={t('players.link.selectPlaceholder')}>
            <option value="">{t('players.link.selectPlaceholder')}</option>
            {linkCandidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <div className="flex flex-wrap justify-end gap-3 border-t border-hairline pt-4">
            <Button variant="ghost" className={TOUCH} onClick={() => setLinkGuest(null)}>
              {t('players.cancel')}
            </Button>
            <Button variant="primary" className={TOUCH} disabled={!linkSourceId || linking} onClick={handleLinkAccount}>
              {linking ? t('players.link.linking') : t('players.link.submit')}
            </Button>
          </div>
        </div>
      </AdminDialog>

      <AdminDialog
        open={suspendTarget !== null && dialog === 'suspend'}
        onClose={closeDialog}
        title={suspendTarget ? t('players.suspend.title', { name: suspendTarget.name }) : ''}
      >
        <div className="space-y-4">
          <p className="text-body text-fg-muted">{t('players.suspend.body')}</p>
          {dialogError && <Alert variant="error">{errorMessage(dialogError)}</Alert>}
          <Input
            label={t('players.suspend.untilLabel')}
            type="datetime-local"
            value={suspendUntil}
            onChange={(e) => setSuspendUntil(e.target.value)}
            required
          />
          <div className="flex flex-wrap justify-end gap-3 border-t border-hairline pt-4">
            <Button variant="ghost" className={TOUCH} onClick={closeDialog}>
              {t('players.cancel')}
            </Button>
            <Button variant="secondary" className={TOUCH} onClick={handleSuspend} disabled={!localDateTimeToIso(suspendUntil) || actionLoading}>
              {actionLoading ? t('players.suspend.submitting') : t('players.suspend.submit')}
            </Button>
          </div>
        </div>
      </AdminDialog>

      <AdminDialog
        open={suspendTarget !== null && dialog === 'ban'}
        onClose={closeDialog}
        title={suspendTarget ? t('players.ban.title', { name: suspendTarget.name }) : ''}
      >
        <div className="space-y-4">
          <p className="text-body text-fg-muted">{t('players.ban.body')}</p>
          {dialogError && <Alert variant="error">{errorMessage(dialogError)}</Alert>}
          <Input
            label={t('players.ban.reasonLabel')}
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
            placeholder={t('players.ban.reasonPlaceholder')}
            required
          />
          <div className="flex flex-wrap justify-end gap-3 border-t border-hairline pt-4">
            <Button variant="ghost" className={TOUCH} onClick={closeDialog}>
              {t('players.cancel')}
            </Button>
            <Button variant="danger" className={TOUCH} onClick={handleBan} disabled={!banReason.trim() || actionLoading}>
              {actionLoading ? t('players.ban.submitting') : t('players.ban.submit')}
            </Button>
          </div>
        </div>
      </AdminDialog>
    </div>
  );
}

function AddPlayerForm({ onSubmit }: { onSubmit: (data: PlayerRegistration) => void }) {
  const [name, setName] = useState('');
  const [discordId, setDiscordId] = useState('');
  const [psUsername, setPsUsername] = useState('');
  const [isGuest, setIsGuest] = useState(false);
  const t = useT(adminCoreMessages);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isGuest) {
      onSubmit({ name, is_guest: true, ps_username: psUsername || undefined });
      return;
    }
    onSubmit({
      name,
      discord_id: discordId,
      ps_username: psUsername || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="mb-6 space-y-3 rounded-poke-lg border border-hairline bg-surface p-4">
      <label className="flex min-h-11 items-center gap-2 text-body text-fg sm:min-h-0">
        <input type="checkbox" checked={isGuest} onChange={(e) => setIsGuest(e.target.checked)} className="size-4 accent-[var(--accent-fill)]" />
        {t('players.form.guest')}
      </label>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Input label={t('players.form.name')} value={name} onChange={(e) => setName(e.target.value)} required />
        {!isGuest && (
          <Input label={t('players.form.discordId')} value={discordId} onChange={(e) => setDiscordId(e.target.value)} required />
        )}
        <Input label={t('players.form.psUsername')} value={psUsername} onChange={(e) => setPsUsername(e.target.value)} />
      </div>
      <Button type="submit" variant="primary" className={TOUCH}>
        {isGuest ? t('players.form.addGuest') : t('players.form.addPlayer')}
      </Button>
    </form>
  );
}
