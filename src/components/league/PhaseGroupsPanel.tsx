'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback, type ReactNode } from 'react';
import type { TournamentGroupWithMembers } from '@/types/season';
import type { ApiResult } from '@/types/api';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Select from '@/components/ui/Select';
import PhaseGroupRepair from '@/components/league/PhaseGroupRepair';
import { useLocale, useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { leaguePhasesMessages } from '@/i18n/messages/league-phases';
import { PHASE_GROUP_COUNTS, redrawNeedsConfirm } from '@/lib/league-admin/phase-controls';
import { leagueAdminHref } from '@/lib/league-admin/tabs';

interface PhaseGroupsPanelProps {
  seasonId: string;
  phaseId: string;
  /**
   * The league has groups: the phase mirrors them (`ensurePhaseGroupsFromLeague`), and the phase routes refuse
   * regenerate, clear and moves (PHASE_GROUPS_LEAGUE_MANAGED). The panel then only lists the groups, points at the
   * league groups editor and explains the placement-week pause of "Generate All Rounds".
   */
  leagueManaged?: boolean;
}

/** Selects and buttons reach 44px on phones (touch targets), the compact size from `sm` up. */
const TOUCH = 'min-h-11 sm:min-h-0';

/** The group count select: 2 to 26 groups (the API's range, `phaseGroupsCreateSchema`). */
export function GroupCountSelect({ value, onChange }: { value: number; onChange: (count: number) => void }) {
  const t = useT(leaguePhasesMessages);
  return (
    <Select
      label={t('groups.groupCount')}
      value={String(value)}
      onChange={(e) => onChange(Number(e.target.value))}
      options={PHASE_GROUP_COUNTS.map((n) => ({
        value: String(n),
        label: t('groups.groupCountOption', { count: n }),
      }))}
    />
  );
}

/**
 * The note for a phase without groups. It tells the admin to seed and serpentine-assign, so a league-managed phase
 * (whose controls are hidden and whose groups come from the league) shows none: its info note says where they come from.
 */
export function EmptyGroupsNote({ leagueManaged }: { leagueManaged: boolean }) {
  const t = useT(leaguePhasesMessages);
  if (leagueManaged) return null;
  return <p className="text-sm text-poke-text-muted">{t('groups.empty')}</p>;
}

/** An API refusal (shown by its code), or a request that got no answer. */
type GroupsError =
  | { api: ApiErrorLike }
  | { key: 'loadFailed' | 'assignFailed' | 'clearFailed' | 'moveFailed' };

/**
 * The phase's groups on the admin phase page. A phase of a league WITHOUT groups edits its own groups here
 * (serpentine assign, clear, member moves). A phase of a league WITH groups shows its mirrored groups read-only
 * (`leagueManaged`): no control the API would refuse is offered.
 */
export default function PhaseGroupsPanel({ seasonId, phaseId, leagueManaged = false }: PhaseGroupsPanelProps) {
  const t = useT(leaguePhasesMessages);
  const locale = useLocale();
  const errorText = useApiErrorText(errorsSeasons);
  const [groups, setGroups] = useState<TournamentGroupWithMembers[]>([]);
  const [groupCount, setGroupCount] = useState(2);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  /** The re-draw confirm is open (null = closed) and names the groups a serpentine assign would replace. */
  const [redrawCount, setRedrawCount] = useState<number | null>(null);
  const [error, setError] = useState<GroupsError | null>(null);
  /** Bumped by this panel's own group edits: a repair plan checked before one is dropped. */
  const [editVersion, setEditVersion] = useState(0);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch(`/api/seasons/${seasonId}/phases/${phaseId}/groups`);
      const result: ApiResult<TournamentGroupWithMembers[]> = await res.json();
      if (result.success) setGroups(result.data);
      else setError({ api: toApiErrorLike(result) });
    } catch {
      setError({ key: 'loadFailed' });
    } finally {
      setLoading(false);
    }
  }, [seasonId, phaseId]);

  useEffect(() => {
    void fetchGroups();
  }, [fetchGroups]);

  async function handleSerpentineAssign() {
    setAssigning(true);
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/phases/${phaseId}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_count: groupCount, serpentine: true }),
      });
      const result: ApiResult<TournamentGroupWithMembers[]> = await res.json();
      if (!result.success) {
        setError({ api: toApiErrorLike(result) });
        return;
      }
      setGroups(result.data);
      setEditVersion((version) => version + 1);
    } catch {
      setError({ key: 'assignFailed' });
    } finally {
      setAssigning(false);
    }
  }

  /** The serpentine button: asks first when the assign would replace existing groups. */
  function requestAssign() {
    if (redrawNeedsConfirm(groups.length)) setRedrawCount(groups.length);
    else void handleSerpentineAssign();
  }

  async function confirmAssign() {
    await handleSerpentineAssign();
    setRedrawCount(null);
  }

  async function handleClearGroups() {
    if (!window.confirm(t('groups.confirmClear'))) return;
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/phases/${phaseId}/groups`, {
        method: 'DELETE',
      });
      const result: ApiResult<null> = await res.json();
      if (!result.success) {
        setError({ api: toApiErrorLike(result) });
        return;
      }
      setGroups([]);
    } catch {
      setError({ key: 'clearFailed' });
    }
  }

  async function moveMember(
    playerId: string,
    fromGroupId: string,
    toGroupId: string
  ) {
    if (fromGroupId === toGroupId) return;
    setMoving(playerId);
    setError(null);
    try {
      const res = await fetch(
        `/api/seasons/${seasonId}/phases/${phaseId}/groups/members`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            player_id: playerId,
            from_group_id: fromGroupId,
            to_group_id: toGroupId,
          }),
        }
      );
      const result: ApiResult<null> = await res.json();
      if (!result.success) {
        setError({ api: toApiErrorLike(result) });
        return;
      }
      setEditVersion((version) => version + 1);
      await fetchGroups();
    } catch {
      setError({ key: 'moveFailed' });
    } finally {
      setMoving(null);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-poke-text-muted" role="status">
        {t('groups.loading')}
      </p>
    );
  }

  const participantsLink = (chunks: ReactNode) => (
    <Link href={leagueAdminHref(seasonId, 'participants')} className="text-poke-text-link underline-offset-2 hover:underline">
      {chunks}
    </Link>
  );

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="error">
          {'api' in error ? errorText(error.api) : t(`groups.errors.${error.key}`)}
        </Alert>
      )}

      {leagueManaged ? (
        <>
          <Alert variant="info">{t.rich('groups.leagueManaged', { link: participantsLink })}</Alert>
          <p className="text-xs text-poke-text-muted">{t('groups.placementPause')}</p>
        </>
      ) : (
      <div className="flex flex-wrap items-end gap-3">
        <GroupCountSelect value={groupCount} onChange={setGroupCount} />
        <Button
          variant="secondary"
          size="sm"
          className={TOUCH}
          onClick={requestAssign}
          loading={assigning}
        >
          {t('groups.serpentine')}
        </Button>
        {groups.length > 0 && (
          <Button variant="ghost" size="sm" className={TOUCH} onClick={handleClearGroups}>
            {t('groups.clear')}
          </Button>
        )}
      </div>
      )}

      <ConfirmDialog
        open={redrawCount !== null}
        onClose={() => setRedrawCount(null)}
        onConfirm={() => void confirmAssign()}
        title={t('groups.redrawTitle')}
        message={t('groups.redrawConfirm', { count: redrawCount ?? groups.length })}
        confirmLabel={t('groups.redrawConfirmLabel')}
        confirmVariant="danger"
        loading={assigning}
      />

      {groups.length === 0 ? (
        <EmptyGroupsNote leagueManaged={leagueManaged} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((group) => (
            <Card key={group.id} variant="muted" padding="sm">
              <h4 className="text-sm font-heading font-semibold text-poke-text-primary mb-2">
                {translateEngineLabel('group', group.name, locale)}
              </h4>
              {group.members.length === 0 ? (
                <p className="text-xs text-poke-text-muted">{t('groups.noMembers')}</p>
              ) : (
                <ul className="space-y-1">
                  {group.members.map((m) => (
                    <li key={m.player_id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 break-words">
                        {m.seed > 0 && (
                          <span className="text-poke-text-muted mr-1">#{m.seed}</span>
                        )}
                        {m.player_name}
                      </span>
                      {leagueManaged ? null : (
                        <select
                          className={`${TOUCH} max-w-full rounded border border-poke-border bg-poke-surface px-1 py-0.5 text-xs text-poke-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus`}
                          value={group.id}
                          disabled={moving === m.player_id}
                          onChange={(e) => moveMember(m.player_id, group.id, e.target.value)}
                          aria-label={t('groups.moveAria', { name: m.player_name })}
                        >
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {translateEngineLabel('group', g.name, locale)}
                            </option>
                          ))}
                        </select>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}

      {groups.length > 0 && (
        <PhaseGroupRepair
          key={editVersion}
          seasonId={seasonId}
          phaseId={phaseId}
          reloadGroups={fetchGroups}
        />
      )}
    </div>
  );
}
