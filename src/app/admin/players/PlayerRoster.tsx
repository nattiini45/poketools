'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Player, PlayerRegistration, PlayerStatus } from '@/types/player';
import type { ApiResponse, ApiResult } from '@/types/api';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import GuestBadge from '@/components/shared/GuestBadge';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Alert from '@/components/ui/Alert';
import Modal from '@/components/ui/Modal';
import Table, { type Column } from '@/components/ui/Table';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin, errorsPlayers } from '@/i18n/messages/errors';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { LocalTime } from '@/i18n/LocalTime';
import type { TablePageSize } from '@/lib/ui/table-params';
import {
  DEFAULT_ROSTER_PAGE_SIZE,
  lastPage,
  localDateTimeToIso,
  openDialog,
  rosterQuery,
} from './roster-helpers';

interface PlayerRosterProps {
  canManageCreators: boolean;
}

function statusVariant(status: PlayerStatus): 'green' | 'yellow' | 'red' {
  switch (status) {
    case 'active': return 'green';
    case 'suspended': return 'yellow';
    case 'banned': return 'red';
  }
}

type LocalError = 'loadFailed' | 'suspendFailed' | 'banFailed' | 'linkFailed';
/** An API failure (translated by its code) or a local message key; never translated text. */
type RosterError = { api: ApiErrorLike } | { local: LocalError };

function apiError(json: unknown): RosterError {
  return { api: toApiErrorLike(json) };
}

/** `GET /api/players`: one page of the directory plus the exact number of matching players. */
type PlayersPage = ApiResponse<Player[]> & { total?: number };

/** Wait this long after the last keystroke before the search hits the server. */
const SEARCH_DEBOUNCE_MS = 300;
/** The guest-link picker lists at most this many accounts per search. */
const LINK_PICKER_LIMIT = 50;

export default function PlayerRoster({ canManageCreators }: PlayerRosterProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<TablePageSize>(DEFAULT_ROSTER_PAGE_SIZE);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  // `loaded` flips once the first request settles; later requests keep the table mounted.
  const [loaded, setLoaded] = useState(false);
  const [fetching, setFetching] = useState(false);
  const latestRequest = useRef(0);
  const t = useT(adminCoreMessages);
  const errorText = useApiErrorText(errorsPlayers, errorsAdmin);
  const [error, setError] = useState<RosterError | null>(null);
  // A failure from inside an open dialog; shown in the dialog, not behind it.
  const [dialogError, setDialogError] = useState<RosterError | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', discord_id: '', ps_username: '' });

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
    setFetching(true);
    try {
      const res = await fetch(`/api/players?${rosterQuery({ page, perPage, search })}`);
      const json = (await res.json()) as ApiResult<Player[]> | PlayersPage;
      if (requestId !== latestRequest.current) return;
      if (json.success) {
        const count = 'total' in json && typeof json.total === 'number' ? json.total : json.data.length;
        if (json.data.length === 0 && count > 0 && page > 1) {
          // The last row of the last page went away: step back to the new last page.
          setPage(lastPage(count, perPage));
          return;
        }
        setError(null);
        setPlayers(json.data);
        setTotal(count);
      } else {
        setError(apiError(json));
      }
    } catch {
      if (requestId === latestRequest.current) setError({ local: 'loadFailed' });
    } finally {
      if (requestId === latestRequest.current) {
        setFetching(false);
        setLoaded(true);
      }
    }
  }, [page, perPage, search]);

  useEffect(() => {
    fetchPlayers();
  }, [fetchPlayers]);

  // Typing filters the whole directory on the server, after a short pause.
  useEffect(() => {
    const next = searchInput.trim();
    if (next === search) return;
    const handle = setTimeout(() => {
      setSearch(next);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput, search]);

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

  const handleAdd = async (data: PlayerRegistration) => {
    const res = await fetch('/api/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = (await res.json()) as ApiResult<Player>;
    if (json.success) {
      setShowForm(false);
      fetchPlayers();
    } else {
      setError(apiError(json));
    }
  };

  const handleToggleAdmin = useCallback(async (player: Player) => {
    const res = await fetch(`/api/players/${player.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_admin: !player.is_admin }),
    });
    const json = (await res.json()) as ApiResult<Player>;
    if (json.success) {
      fetchPlayers();
    } else {
      setError(apiError(json));
    }
  }, [fetchPlayers]);

  const handleToggleCreator = useCallback(async (player: Player) => {
    const res = await fetch(`/api/players/${player.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_creator: !player.is_creator }),
    });
    const json = (await res.json()) as ApiResult<Player>;
    if (json.success) {
      fetchPlayers();
    } else {
      setError(apiError(json));
    }
  }, [fetchPlayers]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm(t('players.confirmDelete'))) return;
    const res = await fetch(`/api/players/${id}`, { method: 'DELETE' });
    const json = (await res.json()) as ApiResult<null>;
    if (json.success) {
      fetchPlayers();
    } else {
      setError(apiError(json));
    }
  }, [fetchPlayers, t]);

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

  const handleUnsuspend = useCallback(async (player: Player) => {
    if (!confirm(t('players.confirmReinstate', { name: player.name }))) return;
    const res = await fetch(`/api/admin/players/${player.id}/unsuspend`, {
      method: 'POST',
    });
    const json = (await res.json()) as ApiResult<Player>;
    if (json.success) {
      fetchPlayers();
    } else {
      setError(apiError(json));
    }
  }, [fetchPlayers, t]);

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
    const res = await fetch(`/api/players/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as ApiResult<Player>;
    if (json.success) {
      setEditingId(null);
      fetchPlayers();
    } else {
      setError(apiError(json));
    }
  }, [editForm, editingId, fetchPlayers]);

  const rosterColumns = useMemo((): Column<Player>[] => [
    {
      key: 'name',
      header: t('players.columns.name'),
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
      key: 'discord',
      header: t('players.columns.discordId'),
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
      key: 'ps',
      header: t('players.columns.psUsername'),
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
      key: 'status',
      header: t('players.columns.status'),
      render: (player) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant(player.status)}>
            {t(`players.status.${player.status}`)}
          </Badge>
          {player.status === 'suspended' && player.suspended_until && (
            <span className="text-xs text-poke-text-muted">
              {t('players.until')}{' '}
              <LocalTime value={player.suspended_until} preset="dateTimeYear" />
            </span>
          )}
        </span>
      ),
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
          <button type="button" onClick={() => handleToggleAdmin(player)}>
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
          <button type="button" onClick={() => handleToggleCreator(player)}>
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
              <button type="button" onClick={() => handleUnsuspend(player)} className="text-poke-green text-sm hover:underline">
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
            <button type="button" onClick={() => handleDelete(player.id)} className="text-poke-danger text-sm hover:underline">
              {t('players.rowActions.delete')}
            </button>
          </span>
        ),
    },
  ], [
    canManageCreators,
    editForm,
    editingId,
    handleDelete,
    handleSaveEdit,
    handleToggleAdmin,
    handleToggleCreator,
    handleUnsuspend,
    openBanDialog,
    openSuspendDialog,
    startEditing,
    t,
  ]);

  if (!loaded) return <p className="text-poke-text-muted">{t('players.loading')}</p>;

  const dialog = openDialog(suspendTarget, suspendAction);
  const errorMessage = (e: RosterError) => ('api' in e ? errorText(e.api) : t(`players.${e.local}`));

  return (
    <div>
      {error && (
        <Alert variant="error" className="mb-4">
          {errorMessage(error)}
        </Alert>
      )}

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

      <div aria-busy={fetching} className={fetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <Table
          columns={rosterColumns}
          data={players}
          keyExtractor={(player) => player.id}
          emptyMessage={search ? t('players.noMatches') : t('players.empty')}
          clientEngine={false}
          page={page}
          perPage={perPage}
          totalItems={total}
          onPageChange={setPage}
          onPerPageChange={(size) => {
            setPerPage(size);
            setPage(1);
          }}
        />
      </div>

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