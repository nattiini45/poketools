'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Player, PlayerRegistration } from '@/types/player';
import type { ApiResponse, ApiResult } from '@/types/api';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import GuestBadge from '@/components/shared/GuestBadge';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Alert from '@/components/ui/Alert';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Modal from '@/components/ui/Modal';
import Table, { type Column } from '@/components/ui/Table';
import { useT } from '@/i18n/client';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import type { PlayerSortColumn } from '@/lib/players/player-sort';
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
  canManageCreators: boolean;
}

/** `GET /api/players`: one page of the directory plus the exact number of matching players. */
type PlayersPage = ApiResponse<Player[]> & { total?: number };

/** Wait this long after the last keystroke before the search hits the server. */
const SEARCH_DEBOUNCE_MS = 300;
/** The guest-link picker lists at most this many accounts per search. */
const LINK_PICKER_LIMIT = 50;

/** The confirm button colour: red where the click is hard to undo, plain where it only restores. */
const CONFIRM_VARIANT: Record<RosterConfirmKind, 'danger' | 'primary'> = {
  makeAdmin: 'danger',
  removeAdmin: 'danger',
  makeCreator: 'primary',
  removeCreator: 'danger',
  delete: 'danger',
  reinstate: 'primary',
};

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

export default function PlayerRoster({ canManageCreators }: PlayerRosterProps) {
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
  const errorMessage = useRosterErrorText();
  // Why the directory could not be loaded; apart from `actionNotice`, which never touches the rows.
  const [loadError, setLoadError] = useState<RosterError | null>(null);
  // A failed row action or add; stays until dismissed or the next action.
  const [actionNotice, setActionNotice] = useState<RosterActionNotice | null>(null);
  // A failure from inside an open dialog; shown in the dialog, not behind it.
  const [dialogError, setDialogError] = useState<RosterError | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', discord_id: '', ps_username: '' });

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
      discord_id: player.discord_id ?? '',
      ps_username: player.ps_username,
    });
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return;
    // Email-only players have no Discord ID — omit the empty field so
    // validation doesn't reject the update.
    const payload = {
      ...editForm,
      discord_id: editForm.discord_id.trim() || undefined,
    };
    const name = players.find((p) => p.id === editingId)?.name ?? editForm.name;
    // A failed save keeps the row in edit mode with its input.
    if (await runAction('action', name, () => patchPlayer(editingId, payload))) {
      setEditingId(null);
      fetchPlayers();
    }
  }, [editForm, editingId, fetchPlayers, players, runAction]);

  const rosterColumns = useMemo((): Column<Player>[] => [
    {
      key: 'name' satisfies PlayerSortColumn,
      header: t('players.columns.name'),
      sortable: true,
      render: (player) =>
        editingId === player.id ? (
          <input
            value={editForm.name}
            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full border border-poke-border rounded-poke-md px-2 py-1 text-sm bg-poke-surface text-poke-text-primary"
          />
        ) : (
          <span className="inline-flex items-center gap-2 text-poke-text-primary">
            {player.name}
            {player.is_guest && <GuestBadge />}
          </span>
        ),
    },
    {
      key: 'discord_id' satisfies PlayerSortColumn,
      header: t('players.columns.discordId'),
      sortable: true,
      render: (player) =>
        editingId === player.id ? (
          <input
            value={editForm.discord_id}
            onChange={(e) => setEditForm((f) => ({ ...f, discord_id: e.target.value }))}
            className="w-full border border-poke-border rounded-poke-md px-2 py-1 text-sm bg-poke-surface text-poke-text-primary"
          />
        ) : (
          <span className="text-sm text-poke-text-secondary">{player.discord_id ?? '—'}</span>
        ),
    },
    {
      key: 'ps_username' satisfies PlayerSortColumn,
      header: t('players.columns.psUsername'),
      sortable: true,
      render: (player) =>
        editingId === player.id ? (
          <input
            value={editForm.ps_username}
            onChange={(e) => setEditForm((f) => ({ ...f, ps_username: e.target.value }))}
            className="w-full border border-poke-border rounded-poke-md px-2 py-1 text-sm bg-poke-surface text-poke-text-primary"
          />
        ) : (
          <span className="text-poke-text-primary">{player.ps_username || '—'}</span>
        ),
    },
    {
      key: 'status' satisfies PlayerSortColumn,
      header: t('players.columns.status'),
      sortable: true,
      render: (player) => <RosterStatusCell player={player} />,
    },
    {
      key: 'admin',
      header: t('players.columns.admin'),
      render: (player) =>
        editingId === player.id ? (
          <Badge variant={player.is_admin ? 'green' : 'gray'}>
            {player.is_admin ? t('players.roles.admin') : t('players.roles.player')}
          </Badge>
        ) : (
          <button type="button" onClick={() => askConfirm(roleConfirmKind(player, 'is_admin'), player)}>
            <Badge variant={player.is_admin ? 'green' : 'gray'}>
              {player.is_admin ? t('players.roles.admin') : t('players.roles.player')}
            </Badge>
          </button>
        ),
    },
    {
      key: 'creator',
      header: t('players.columns.creator'),
      render: (player) =>
        editingId === player.id ? (
          <Badge variant={player.is_creator ? 'purple' : 'gray'}>
            {player.is_creator ? t('players.roles.creator') : '—'}
          </Badge>
        ) : canManageCreators ? (
          <button type="button" onClick={() => askConfirm(roleConfirmKind(player, 'is_creator'), player)}>
            <Badge variant={player.is_creator ? 'purple' : 'gray'}>
              {player.is_creator ? t('players.roles.creator') : '—'}
            </Badge>
          </button>
        ) : (
          <Badge variant={player.is_creator ? 'purple' : 'gray'}>
            {player.is_creator ? t('players.roles.creator') : '—'}
          </Badge>
        ),
    },
    {
      key: 'actions',
      header: t('players.columns.actions'),
      render: (player) =>
        editingId === player.id ? (
          <span className="space-x-2">
            <button type="button" onClick={handleSaveEdit} className="text-poke-green text-sm hover:underline">
              {t('players.rowActions.save')}
            </button>
            <button type="button" onClick={() => setEditingId(null)} className="text-poke-text-muted text-sm hover:underline">
              {t('players.rowActions.cancel')}
            </button>
          </span>
        ) : (
          <span className="space-x-2">
            <button type="button" onClick={() => startEditing(player)} className="text-poke-blue text-sm hover:underline">
              {t('players.rowActions.edit')}
            </button>
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
                className="text-poke-blue text-sm hover:underline"
              >
                {t('players.rowActions.linkAccount')}
              </button>
            )}
            {player.status !== 'active' ? (
              <button type="button" onClick={() => askConfirm('reinstate', player)} className="text-poke-green text-sm hover:underline">
                {t('players.rowActions.reinstate')}
              </button>
            ) : (
              <>
                <button type="button" onClick={() => openSuspendDialog(player)} className="text-poke-yellow text-sm hover:underline">
                  {t('players.rowActions.suspend')}
                </button>
                <button type="button" onClick={() => openBanDialog(player)} className="text-poke-danger text-sm hover:underline">
                  {t('players.rowActions.ban')}
                </button>
              </>
            )}
            <button type="button" onClick={() => askConfirm('delete', player)} className="text-poke-danger text-sm hover:underline">
              {t('players.rowActions.delete')}
            </button>
          </span>
        ),
    },
  ], [
    askConfirm,
    canManageCreators,
    editForm,
    editingId,
    handleSaveEdit,
    openBanDialog,
    openSuspendDialog,
    startEditing,
    t,
  ]);

  const view = rosterView({ loaded, hasLoadedOnce, hasLoadError: loadError !== null });
  if (view === 'loading') return <p className="text-poke-text-muted">{t('players.loading')}</p>;
  // The first load failed: no rows, and no telling an empty directory from an unreachable one.
  if (view === 'blocked' && loadError) return <RosterLoadError error={loadError} onRetry={retryLoad} />;

  const dialog = openDialog(suspendTarget, suspendAction);

  return (
    <div>
      <Button
        variant="primary"
        size="sm"
        onClick={() => setShowForm(!showForm)}
        className="mb-4"
      >
        {showForm ? t('players.cancel') : t('players.addPlayer')}
      </Button>

      {showForm && <AddPlayerForm onSubmit={handleAdd} />}

      <div className="mb-4 max-w-sm">
        <Input
          label={t('players.search.label')}
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t('players.search.placeholder')}
          maxLength={100}
        />
      </div>

      {actionNotice && <RosterActionAlert notice={actionNotice} onDismiss={() => setActionNotice(null)} />}
      {loadError && <RosterLoadError error={loadError} onRetry={retryLoad} />}

      <div aria-busy={fetching} className={fetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <Table
          columns={rosterColumns}
          data={players}
          keyExtractor={(player) => player.id}
          emptyMessage={search ? t('players.noMatches') : t('players.empty')}
          clientEngine={false}
          sort={sort}
          onSort={handleSort}
          page={page}
          perPage={perPage}
          totalItems={total}
          onPageChange={(next) => update({ page: next })}
          onPerPageChange={(size) => update({ perPage: size, page: 1 })}
        />
      </div>

      {pendingConfirm && (
        <ConfirmDialog
          open
          onClose={() => {
            if (!confirming) setPendingConfirm(null);
          }}
          onConfirm={handleConfirm}
          title={t(`players.confirm.${pendingConfirm.kind}.title`, { name: pendingConfirm.player.name })}
          message={t(`players.confirm.${pendingConfirm.kind}.body`, { name: pendingConfirm.player.name })}
          confirmLabel={t(`players.confirm.${pendingConfirm.kind}.confirm`)}
          confirmVariant={CONFIRM_VARIANT[pendingConfirm.kind]}
          loading={confirming}
        />
      )}

      {/* Link guest account */}
      {linkGuest && (
        <Modal
          open
          onClose={() => setLinkGuest(null)}
          title={t('players.link.title', { name: linkGuest.name })}
        >
          <div className="space-y-4">
            <p className="text-sm text-poke-text-secondary">{t('players.link.body')}</p>
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
              <p className="text-sm text-poke-text-muted">{t('players.link.noMatches')}</p>
            )}
            <select
              value={linkSourceId}
              onChange={(e) => setLinkSourceId(e.target.value)}
              className="w-full text-sm bg-poke-surface border border-poke-border rounded-poke-md px-2 py-2"
            >
              <option value="">{t('players.link.selectPlaceholder')}</option>
              {linkCandidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setLinkGuest(null)}>
                {t('players.cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!linkSourceId || linking}
                onClick={handleLinkAccount}
              >
                {linking ? t('players.link.linking') : t('players.link.submit')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Suspend Dialog */}
      {suspendTarget && dialog === 'suspend' && (
        <Modal
          open={true}
          onClose={closeDialog}
          title={t('players.suspend.title', { name: suspendTarget.name })}
        >
          <div className="space-y-4">
            <p className="text-sm text-poke-text-secondary">{t('players.suspend.body')}</p>
            {dialogError && <Alert variant="error">{errorMessage(dialogError)}</Alert>}
            <Input
              label={t('players.suspend.untilLabel')}
              type="datetime-local"
              value={suspendUntil}
              onChange={e => setSuspendUntil(e.target.value)}
              required
            />
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={closeDialog}>{t('players.cancel')}</Button>
              <Button
                variant="secondary"
                onClick={handleSuspend}
                disabled={!localDateTimeToIso(suspendUntil) || actionLoading}
              >
                {actionLoading ? t('players.suspend.submitting') : t('players.suspend.submit')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Ban Dialog */}
      {suspendTarget && dialog === 'ban' && (
        <Modal
          open={true}
          onClose={closeDialog}
          title={t('players.ban.title', { name: suspendTarget.name })}
        >
          <div className="space-y-4">
            <p className="text-sm text-poke-text-secondary">{t('players.ban.body')}</p>
            {dialogError && <Alert variant="error">{errorMessage(dialogError)}</Alert>}
            <Input
              label={t('players.ban.reasonLabel')}
              value={banReason}
              onChange={e => setBanReason(e.target.value)}
              placeholder={t('players.ban.reasonPlaceholder')}
              required
            />
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={closeDialog}>{t('players.cancel')}</Button>
              <Button
                variant="danger"
                onClick={handleBan}
                disabled={!banReason.trim() || actionLoading}
              >
                {actionLoading ? t('players.ban.submitting') : t('players.ban.submit')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
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
    <Card variant="muted" className="mb-6">
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-poke-text-secondary">
          <input
            type="checkbox"
            checked={isGuest}
            onChange={(e) => setIsGuest(e.target.checked)}
          />
          {t('players.form.guest')}
        </label>
        <Input
          label={t('players.form.name')}
          value={name}
          onChange={e => setName(e.target.value)}
          required
        />
        {!isGuest && (
          <Input
            label={t('players.form.discordId')}
            value={discordId}
            onChange={e => setDiscordId(e.target.value)}
            required
          />
        )}
        <Input
          label={t('players.form.psUsername')}
          value={psUsername}
          onChange={e => setPsUsername(e.target.value)}
        />
        <Button type="submit" variant="primary" size="sm">
          {isGuest ? t('players.form.addGuest') : t('players.form.addPlayer')}
        </Button>
      </form>
    </Card>
  );
}