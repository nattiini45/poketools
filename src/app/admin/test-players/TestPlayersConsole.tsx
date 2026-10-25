'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import Section from '@/components/ui/Section';
import Table, { type Column } from '@/components/ui/Table';
import type { ApiError, ApiResult } from '@/types/api';
import type { Player } from '@/types/player';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsAdmin } from '@/i18n/messages/errors';
import { adminTestPlayersMessages } from '@/i18n/messages/admin-test-players';
import type { Translator } from '@/i18n/core';
import type en from '@/i18n/messages/admin-test-players/en';
import {
  errorText,
  noticeText,
  type ConsoleError,
  type ConsoleNotice,
  type PlayerActionKey,
} from './test-players-text';
import { confirmCopy, confirmationFor, type ConfirmCopy, type PendingConfirmation } from './test-players-confirm';

type TestPlayersTranslator = Translator<typeof en>;

interface MintedCredentials {
  email: string;
  password: string;
}

interface EnsureResponse {
  ensured: number;
  players: Player[];
}

/** The `remove_from_league` request body for one player and the season UUID typed in the console. */
export function removeFromSeasonPayload(
  player: Pick<Player, 'id'>,
  seasonId: string,
): { action: 'remove_from_league'; player_id: string; season_id: string } {
  return { action: 'remove_from_league', player_id: player.id, season_id: seasonId.trim() };
}

interface PlayerColumnDeps {
  t: TestPlayersTranslator;
  busyAction: string | null;
  seasonId: string;
  onPlayerAction: (player: Player, action: PlayerActionKey) => void;
  onRemoveFromSeason: (player: Player) => void;
}

/** The table columns; every row action acts on its own row's player. */
export function buildPlayerColumns(deps: PlayerColumnDeps): Column<Player>[] {
  const { t, busyAction, seasonId, onPlayerAction, onRemoveFromSeason } = deps;
  return [
    {
      key: 'name',
      header: t('table.name'),
      sortable: true,
      sortValue: (row) => row.name.toLowerCase(),
      render: (player) => (
        <>
          <span className="font-heading font-semibold text-poke-text-primary">{player.name}</span>
          <span className="ml-2 inline-flex items-center rounded-poke-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-poke-amber-ink">
            {t('table.testBadge')}
          </span>
        </>
      ),
    },
    {
      key: 'ps_username',
      header: t('table.psUsername'),
      sortable: true,
      sortValue: (row) => row.ps_username?.toLowerCase() ?? '',
      render: (player) => (
        <span className="font-mono text-xs">{player.ps_username || '—'}</span>
      ),
    },
    {
      key: 'login',
      header: t('table.login'),
      render: (player) => (
        <span className="text-xs">
          {player.auth_user_id ? (
            <span className="text-emerald-600">{t('table.loginEnabled')}</span>
          ) : (
            <span className="text-poke-text-muted">{t('table.loginDisabled')}</span>
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('table.actions'),
      render: (player) => (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={busyAction === `reset:${player.id}`}
            onClick={() => onPlayerAction(player, 'reset')}
          >
            {t('actions.reset')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={busyAction === `mint_login:${player.id}`}
            onClick={() => onPlayerAction(player, 'mint_login')}
          >
            {t(player.auth_user_id ? 'actions.resetLogin' : 'actions.mintLogin')}
          </Button>
          {player.auth_user_id && (
            <Button
              size="sm"
              variant="secondary"
              loading={busyAction === `clear_login:${player.id}`}
              onClick={() => onPlayerAction(player, 'clear_login')}
            >
              {t('actions.clearLogin')}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            loading={busyAction === `remove_from_league:${player.id}`}
            disabled={!seasonId.trim()}
            aria-label={t('actions.removeFromSeasonLabel', { name: player.name })}
            title={seasonId.trim() ? undefined : t('actions.removeFromSeasonHint')}
            onClick={() => onRemoveFromSeason(player)}
          >
            {t('actions.removeFromSeason')}
          </Button>
        </div>
      ),
    },
  ];
}

interface TestPlayersTableProps {
  players: Player[];
  busyAction: string | null;
  seasonId: string;
  onAction: (player: Player, action: PlayerActionKey) => void;
  onRemoveFromSeason: (player: Player) => void;
}

/** The test accounts with their per-player actions (presentational). */
export function TestPlayersTable({ players, busyAction, seasonId, onAction, onRemoveFromSeason }: TestPlayersTableProps) {
  const t = useT(adminTestPlayersMessages);

  const playerColumns = useMemo(
    () => buildPlayerColumns({ t, busyAction, seasonId, onPlayerAction: onAction, onRemoveFromSeason }),
    [t, busyAction, seasonId, onAction, onRemoveFromSeason],
  );

  return (
    <Table
      columns={playerColumns}
      data={players}
      keyExtractor={(player) => player.id}
      emptyMessage={t('standard.tableEmpty')}
      defaultSort={{ key: 'name', direction: 'asc' }}
    />
  );
}

interface TestPlayersConfirmDialogProps {
  /** The dialog text of the pending action; null while nothing waits. */
  copy: ConfirmCopy | null;
  onClose: () => void;
  onConfirm: () => void;
}

/** The shared ConfirmDialog, opened while a destructive action waits for a yes. */
export function TestPlayersConfirmDialog({ copy, onClose, onConfirm }: TestPlayersConfirmDialogProps) {
  return (
    <ConfirmDialog
      open={copy !== null}
      onClose={onClose}
      onConfirm={onConfirm}
      title={copy?.title ?? ''}
      message={copy?.message ?? ''}
      confirmLabel={copy?.confirmLabel}
    />
  );
}

export default function TestPlayersConsole() {
  const t = useT(adminTestPlayersMessages);
  const apiErrorText = useApiErrorText(errorsAdmin);

  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<ConsoleError | null>(null);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ConsoleError | null>(null);
  const [actionMessage, setActionMessage] = useState<ConsoleNotice | null>(null);
  const [minted, setMinted] = useState<MintedCredentials | null>(null);
  /** The destructive action waiting for the admin's yes (shared ConfirmDialog). */
  const [pending, setPending] = useState<PendingConfirmation | null>(null);

  const [seasonId, setSeasonId] = useState('');

  const loadPlayers = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch('/api/admin/test-players');
      const json: ApiResult<{ players: Player[] }> = await res.json();
      if (json.success && json.data) {
        setPlayers(json.data.players);
      } else {
        setListError({ api: json as ApiError, fallback: 'error.loadFailed' });
      }
    } catch {
      setListError({ local: 'error.network' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlayers();
  }, [loadPlayers]);

  const postAction = useCallback(async (body: Record<string, unknown>): Promise<ApiResult<unknown> | null> => {
    setActionError(null);
    setActionMessage(null);
    setMinted(null);
    try {
      const res = await fetch('/api/admin/test-players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json: ApiResult<unknown> = await res.json();
      return json;
    } catch {
      setActionError({ local: 'error.network' });
      return null;
    }
  }, []);

  async function handleEnsure() {
    setBusyAction('ensure');
    const json = await postAction({ action: 'ensure' });
    if (json?.success) {
      const data = json.data as EnsureResponse;
      setActionMessage({ kind: 'ensured', count: data.ensured });
      await loadPlayers();
    } else if (json) {
      setActionError({ api: json as ApiError, fallback: 'error.ensureFailed' });
    }
    setBusyAction(null);
  }

  const runPlayerAction = useCallback(async (player: Player, action: PlayerActionKey) => {
    setBusyAction(`${action}:${player.id}`);
    const json = await postAction({ action, player_id: player.id });
    if (json?.success) {
      if (action === 'mint_login' && json.data) {
        setMinted(json.data as MintedCredentials);
        setActionMessage({ kind: 'minted', name: player.name });
      } else {
        setActionMessage({ kind: 'done', action, name: player.name });
      }
      await loadPlayers();
    } else if (json) {
      setActionError({ api: json as ApiError, fallback: `error.failed.${action}` });
    }
    setBusyAction(null);
  }, [loadPlayers, postAction]);

  /** A row button: asks first when the action resets, removes or replaces something. */
  const handlePlayerAction = useCallback((player: Player, action: PlayerActionKey) => {
    const confirmation = confirmationFor(action, player);
    if (confirmation) {
      setPending(confirmation);
      return;
    }
    void runPlayerAction(player, action);
  }, [runPlayerAction]);

  const runRemoveFromSeason = useCallback(async (player: Player, season: string) => {
    setBusyAction(`remove_from_league:${player.id}`);
    const json = await postAction(removeFromSeasonPayload(player, season));
    if (json?.success) {
      setActionMessage({ kind: 'removed', name: player.name, season });
    } else if (json) {
      setActionError({ api: json as ApiError, fallback: 'error.removeFailed' });
    }
    setBusyAction(null);
  }, [postAction]);

  const handleRemoveFromSeason = useCallback((player: Player) => {
    const season = seasonId.trim();
    if (!season) {
      setActionError({ local: 'error.seasonRequiredRemove' });
      return;
    }
    setPending({ kind: 'remove_from_league', player, season });
  }, [seasonId]);

  async function runDeleteTestMatches(season: string) {
    setBusyAction('delete_test_matches');
    const json = await postAction({ action: 'delete_test_matches', season_id: season });
    if (json?.success) {
      const data = json.data as { deleted: number };
      setActionMessage({ kind: 'deleted', count: data.deleted, season });
    } else if (json) {
      setActionError({ api: json as ApiError, fallback: 'error.deleteMatchesFailed' });
    }
    setBusyAction(null);
  }

  function handleDeleteTestMatches() {
    const season = seasonId.trim();
    if (!season) {
      setActionError({ local: 'error.seasonRequiredDelete' });
      return;
    }
    setPending({ kind: 'delete_test_matches', season });
  }

  /** The admin said yes: close the dialog and run exactly the action it named. */
  function handleConfirm() {
    const confirmed = pending;
    setPending(null);
    if (!confirmed) return;
    if (confirmed.kind === 'remove_from_league') {
      void runRemoveFromSeason(confirmed.player, confirmed.season);
    } else if (confirmed.kind === 'delete_test_matches') {
      void runDeleteTestMatches(confirmed.season);
    } else {
      void runPlayerAction(confirmed.player, confirmed.kind);
    }
  }

  const copy = pending ? confirmCopy(t, pending) : null;

  return (
    <div className="space-y-6">
      <Section title={t('standard.title')}>
        <p className="text-sm text-poke-text-muted mb-4">
          {t.rich('standard.intro', {
            code: (chunks) => (
              <code className="px-1 py-0.5 rounded bg-poke-surface border border-poke-border">{chunks}</code>
            ),
          })}
        </p>
        <div className="flex flex-wrap gap-3 mb-4">
          <Button onClick={handleEnsure} loading={busyAction === 'ensure'}>
            {t('standard.ensure')}
          </Button>
          <Button onClick={() => void loadPlayers()} variant="secondary" disabled={loading}>
            {t('standard.refresh')}
          </Button>
        </div>
        {actionError && <Alert variant="error" className="mb-4">{errorText(t, apiErrorText, actionError)}</Alert>}
        {actionMessage && <Alert variant="success" className="mb-4">{noticeText(t, actionMessage)}</Alert>}
        {minted && (
          <Alert variant="success" className="mb-4">
            <div>
              <div className="font-heading font-semibold mb-1">{minted.email}</div>
              <div className="font-mono text-sm break-all">{minted.password}</div>
              <div className="text-xs text-poke-text-muted mt-1">
                {t('standard.mintedNote')}
              </div>
            </div>
          </Alert>
        )}

        {loading && <p className="text-sm text-poke-text-muted">{t('standard.loading')}</p>}
        {listError && <Alert variant="error">{errorText(t, apiErrorText, listError)}</Alert>}
        {!loading && players.length === 0 && (
          <p className="text-sm text-poke-text-muted">
            {t.rich('standard.empty', { strong: (chunks) => <strong>{chunks}</strong> })}
          </p>
        )}
        {players.length > 0 && (
          <TestPlayersTable
            players={players}
            busyAction={busyAction}
            seasonId={seasonId}
            onAction={handlePlayerAction}
            onRemoveFromSeason={handleRemoveFromSeason}
          />
        )}
      </Section>

      <Section title={t('season.title')}>
        <p className="text-sm text-poke-text-muted mb-4">
          {t.rich('season.intro', { strong: (chunks) => <strong>{chunks}</strong> })}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
          <Input
            label={t('season.idLabel')}
            value={seasonId}
            onChange={(event) => setSeasonId(event.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
          />
          <Button
            variant="secondary"
            loading={busyAction === 'delete_test_matches'}
            disabled={!seasonId.trim()}
            onClick={handleDeleteTestMatches}
          >
            {t('season.deleteMatches')}
          </Button>
        </div>
      </Section>

      <TestPlayersConfirmDialog copy={copy} onClose={() => setPending(null)} onConfirm={handleConfirm} />
    </div>
  );
}
