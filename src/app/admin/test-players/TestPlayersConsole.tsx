'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Section from '@/components/ui/Section';
import Table, { type Column } from '@/components/ui/Table';
import type { ApiError, ApiResult } from '@/types/api';
import type { Player } from '@/types/player';

interface MintedCredentials {
  email: string;
  password: string;
}

interface EnsureResponse {
  ensured: number;
  players: Player[];
}

export default function TestPlayersConsole() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [minted, setMinted] = useState<MintedCredentials | null>(null);

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
        const err = json as ApiError;
        setListError(err.error ?? 'Failed to load test accounts');
      }
    } catch {
      setListError('Network error');
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
      setActionError('Network error');
      return null;
    }
  }, []);

  async function handleEnsure() {
    setBusyAction('ensure');
    const json = await postAction({ action: 'ensure' });
    if (json?.success) {
      const data = json.data as EnsureResponse;
      setActionMessage(`Ensured ${data.ensured} standard test player(s).`);
      await loadPlayers();
    } else if (json) {
      setActionError((json as ApiError).error ?? 'Failed to ensure test players');
    }
    setBusyAction(null);
  }

  const handlePlayerAction = useCallback(async (player: Player, action: string, label: string) => {
    setBusyAction(`${action}:${player.id}`);
    const json = await postAction({ action, player_id: player.id });
    if (json?.success) {
      if (action === 'mint_login' && json.data) {
        setMinted(json.data as MintedCredentials);
        setActionMessage(`Login credentials minted for ${player.name}.`);
      } else {
        setActionMessage(`${label} — done for ${player.name}.`);
      }
      await loadPlayers();
    } else if (json) {
      setActionError((json as ApiError).error ?? `${label} failed`);
    }
    setBusyAction(null);
  }, [loadPlayers, postAction]);

  async function handleRemoveFromLeague() {
    if (!seasonId.trim()) {
      setActionError('Enter a season UUID to remove the selected player from');
      return;
    }
    // Removes the first selected test player from the given season.
    const player = players[0];
    if (!player) {
      setActionError('No test players available');
      return;
    }
    setBusyAction('remove_from_league');
    const json = await postAction({
      action: 'remove_from_league',
      player_id: player.id,
      season_id: seasonId.trim(),
    });
    if (json?.success) {
      setActionMessage(`Removed ${player.name} from season ${seasonId.trim()}.`);
    } else if (json) {
      setActionError((json as ApiError).error ?? 'Remove from league failed');
    }
    setBusyAction(null);
  }

  async function handleDeleteTestMatches() {
    if (!seasonId.trim()) {
      setActionError('Enter a season UUID to delete its test-only matches');
      return;
    }
    setBusyAction('delete_test_matches');
    const json = await postAction({ action: 'delete_test_matches', season_id: seasonId.trim() });
    if (json?.success) {
      const data = json.data as { deleted: number };
      setActionMessage(`Deleted ${data.deleted} test-only match(es) in season ${seasonId.trim()}.`);
    } else if (json) {
      setActionError((json as ApiError).error ?? 'Delete test matches failed');
    }
    setBusyAction(null);
  }

  const playerColumns = useMemo((): Column<Player>[] => [
      {
        key: 'name',
        header: 'Name',
        sortable: true,
        sortValue: (row) => row.name.toLowerCase(),
        render: (player) => (
          <>
            <span className="font-heading font-semibold text-poke-text-primary">{player.name}</span>
            <span className="ml-2 inline-flex items-center rounded-poke-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-poke-amber-ink">
              Test
            </span>
          </>
        ),
      },
      {
        key: 'ps_username',
        header: 'PS Username',
        sortable: true,
        sortValue: (row) => row.ps_username?.toLowerCase() ?? '',
        render: (player) => (
          <span className="font-mono text-xs">{player.ps_username || '—'}</span>
        ),
      },
      {
        key: 'login',
        header: 'Login',
        render: (player) => (
          <span className="text-xs">
            {player.auth_user_id ? (
              <span className="text-emerald-600">enabled</span>
            ) : (
              <span className="text-poke-text-muted">disabled</span>
            )}
          </span>
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        render: (player) => (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={busyAction === `reset:${player.id}`}
              onClick={() => void handlePlayerAction(player, 'reset', 'Reset data')}
            >
              Reset Data
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={busyAction === `mint_login:${player.id}`}
              onClick={() => void handlePlayerAction(player, 'mint_login', 'Mint login')}
            >
              {player.auth_user_id ? 'Reset Login' : 'Mint Login'}
            </Button>
            {player.auth_user_id && (
              <Button
                size="sm"
                variant="secondary"
                loading={busyAction === `clear_login:${player.id}`}
                onClick={() => void handlePlayerAction(player, 'clear_login', 'Clear login')}
              >
                Clear Login
              </Button>
            )}
          </div>
        ),
      },
  ], [busyAction, handlePlayerAction]);

  return (
    <div className="space-y-6">
      <Section title="Standard Test Players">
        <p className="text-sm text-poke-text-muted mb-4">
          Creating ensures exactly 14 dummy accounts (EvoTest01–EvoTest14) exist, marked
          <code className="mx-1 px-1 py-0.5 rounded bg-poke-surface border border-poke-border">is_test_account</code>
          and excluded from every public/global surface. Idempotent — safe to run repeatedly.
        </p>
        <div className="flex flex-wrap gap-3 mb-4">
          <Button onClick={handleEnsure} loading={busyAction === 'ensure'}>
            Create / Repair 14 Test Players
          </Button>
          <Button onClick={() => void loadPlayers()} variant="secondary" disabled={loading}>
            Refresh
          </Button>
        </div>
        {actionError && <Alert variant="error" className="mb-4">{actionError}</Alert>}
        {actionMessage && <Alert variant="success" className="mb-4">{actionMessage}</Alert>}
        {minted && (
          <Alert variant="success" className="mb-4">
            <div>
              <div className="font-heading font-semibold mb-1">{minted.email}</div>
              <div className="font-mono text-sm break-all">{minted.password}</div>
              <div className="text-xs text-poke-text-muted mt-1">
                Shown once — store it before navigating away. Reset anytime with &quot;Mint Login&quot;.
              </div>
            </div>
          </Alert>
        )}

        {loading && <p className="text-sm text-poke-text-muted">Loading test accounts…</p>}
        {listError && <Alert variant="error">{listError}</Alert>}
        {!loading && players.length === 0 && (
          <p className="text-sm text-poke-text-muted">
            No test accounts yet. Click <strong>Create / Repair</strong> to create the 14 standard accounts.
          </p>
        )}
        {players.length > 0 && (
          <Table
            columns={playerColumns}
            data={players}
            keyExtractor={(player) => player.id}
            emptyMessage="No test accounts"
            defaultSort={{ key: 'name', direction: 'asc' }}
          />
        )}
      </Section>

      <Section title="Season-Level Test Data">
        <p className="text-sm text-poke-text-muted mb-4">
          Remove a test player from a season (drops their participation + season progression), or delete
          every match in a season whose <strong>both</strong> participants are test accounts.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-4 items-end">
          <Input
            label="Season UUID"
            value={seasonId}
            onChange={(event) => setSeasonId(event.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
          />
          <Button
            variant="secondary"
            loading={busyAction === 'remove_from_league'}
            disabled={!seasonId.trim() || players.length === 0}
            onClick={handleRemoveFromLeague}
          >
            Remove {players[0]?.name ?? 'Player'} From Season
          </Button>
          <Button
            variant="secondary"
            loading={busyAction === 'delete_test_matches'}
            disabled={!seasonId.trim()}
            onClick={handleDeleteTestMatches}
          >
            Delete Test-Only Matches
          </Button>
        </div>
      </Section>
    </div>
  );
}
