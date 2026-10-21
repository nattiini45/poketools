'use client';

import { useState } from 'react';
import type {
  GroupRepairBasis,
  GroupRepairMove,
  GroupRepairMoveRef,
  GroupRepairResult,
  GroupRepairUnresolvedReason,
} from '@/lib/season/group-repair';
import type { ApiResult } from '@/types/api';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import { useLocale, useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { leaguePhasesMessages } from '@/i18n/messages/league-phases';

interface PhaseGroupRepairProps {
  seasonId: string;
  phaseId: string;
  /**
   * Reload the groups: after each check, so the cards show the rows the plan
   * was made from, and after each apply, failed ones included (a failed apply
   * keeps the moves before the failure).
   */
  reloadGroups: () => void | Promise<void>;
}

/** A check, or an apply of the moves the admin reviewed. */
export type GroupRepairRequestBody =
  | { dry_run: true }
  | { dry_run: false; moves: GroupRepairMoveRef[] };

/** Sends one repair request and returns its parsed body. */
export type GroupRepairRequest = (body: GroupRepairRequestBody) => Promise<ApiResult<GroupRepairResult>>;

/**
 * A failed check or apply: the server's refusal (shown by its code, in the
 * viewer's language), or a request that got no answer (a message key).
 */
export type GroupRepairError = { api: ApiErrorLike } | { key: 'checkFailed' | 'repairFailed' };

/** What the control shows after an apply. */
export interface GroupRepairApplyOutcome {
  /** The moves the apply wrote; null when it failed. */
  handedOver: GroupRepairMove[] | null;
  /**
   * What is open now: what the apply left, or after a failure a fresh check
   * (null when that failed too, so nothing stale stays applicable).
   */
  plan: GroupRepairResult | null;
  error: GroupRepairError | null;
}

/** What the control shows after a check. */
export interface GroupRepairCheckOutcome {
  /** The fresh plan; null when the check failed, so no stale plan stays applicable. */
  plan: GroupRepairResult | null;
  error: GroupRepairError | null;
}

/**
 * Check the group rows, then reload the groups (so the cards show the rows
 * the plan was made from). A failed check clears the plan: the previous one
 * may be stale, and its Apply button must not stay next to the error.
 */
export async function checkRepair(
  request: GroupRepairRequest,
  reloadGroups: () => void | Promise<void>,
): Promise<GroupRepairCheckOutcome> {
  let outcome: GroupRepairCheckOutcome;
  try {
    const result = await request({ dry_run: true });
    outcome = result.success
      ? { plan: result.data, error: null }
      : { plan: null, error: { api: toApiErrorLike(result) } };
  } catch {
    outcome = { plan: null, error: { key: 'checkFailed' } };
  }
  await reloadGroups();
  return outcome;
}

/** A check whose failure only means there is no plan to show. */
async function recheck(request: GroupRepairRequest): Promise<GroupRepairResult | null> {
  try {
    const result = await request({ dry_run: true });
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Apply the reviewed plan (the server writes only when its fresh plan names
 * exactly these moves), then reload the groups whatever happened. After a
 * failure the plan is checked again: moves written before the failure have
 * landed, and the fresh list holds only what is still open.
 */
export async function applyReviewedRepair(
  reviewed: GroupRepairResult,
  request: GroupRepairRequest,
  reloadGroups: () => void | Promise<void>,
): Promise<GroupRepairApplyOutcome> {
  const moves = reviewed.moves.map(({ group_id, from_player_id, to_player_id }) => ({
    group_id,
    from_player_id,
    to_player_id,
  }));
  let outcome: GroupRepairApplyOutcome;
  try {
    const result = await request({ dry_run: false, moves });
    outcome = result.success
      ? // What it moved is done; what it left open is what still needs a hand.
        { handedOver: result.data.moves, plan: { ...result.data, moves: [] }, error: null }
      : { handedOver: null, plan: await recheck(request), error: { api: toApiErrorLike(result) } };
  } catch {
    outcome = { handedOver: null, plan: await recheck(request), error: { key: 'repairFailed' } };
  }
  await reloadGroups();
  return outcome;
}

type PlayerReason = Exclude<GroupRepairUnresolvedReason, 'several_rows'>;

/** The plan of a check (or what an apply left open), as a list. */
export function GroupRepairPlanView({ plan }: { plan: GroupRepairResult }) {
  const t = useT(leaguePhasesMessages);
  const locale = useLocale();
  const basisLabel = (basis: GroupRepairBasis) => t(`repair.basis.${basis}`);
  const rowReasonLabel = (reason: GroupRepairUnresolvedReason) =>
    t(`repair.rowReason.${reason}`);
  const playerReasonLabel = (reason: PlayerReason) => t(`repair.playerReason.${reason}`);
  const groupName = (name: string) => translateEngineLabel('group', name, locale);

  if (!plan.grouped) {
    return <p className="text-xs text-poke-text-muted">{t('repair.noGroups')}</p>;
  }

  const { orphaned_rows: orphanedRows, ungrouped_players: ungroupedPlayers } = plan.unresolved;
  const listClass =
    'max-h-40 overflow-y-auto space-y-1 rounded-poke-md border border-poke-border bg-poke-elevated p-2';

  return (
    <div className="space-y-3 text-xs">
      {plan.moves.length === 0 ? (
        <p className="text-poke-text-muted">{t('repair.noMoves')}</p>
      ) : (
        <div>
          <p className="font-heading font-semibold text-poke-text-primary mb-1">
            {t('repair.movesHeading', { count: plan.moves.length })}
          </p>
          <ul className={listClass}>
            {plan.moves.map((move) => (
              <li key={`${move.group_id}:${move.from_player_id}`} className="text-poke-text-secondary">
                <span className="text-poke-text-muted">{groupName(move.group_name)}:</span>{' '}
                {move.from_player_name} → <strong className="text-poke-text-primary">{move.to_player_name}</strong>{' '}
                <span className="text-poke-text-muted">({basisLabel(move.basis)})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {orphanedRows.length > 0 && (
        <div>
          <p className="font-heading font-semibold text-poke-text-primary mb-1">
            {t('repair.orphanedHeading', { count: orphanedRows.length })}
          </p>
          <ul className={listClass}>
            {orphanedRows.map((row) => (
              <li key={`${row.group_id}:${row.player_id}`} className="text-poke-text-secondary">
                <span className="text-poke-text-muted">{groupName(row.group_name)}:</span> {row.player_name}{' '}
                <span className="text-poke-text-muted">({rowReasonLabel(row.reason)})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ungroupedPlayers.length > 0 && (
        <div>
          <p className="font-heading font-semibold text-poke-text-primary mb-1">
            {t('repair.ungroupedHeading', { count: ungroupedPlayers.length })}
          </p>
          <ul className={listClass}>
            {ungroupedPlayers.map((player) => (
              <li key={player.player_id} className="text-poke-text-secondary">
                {player.player_name}{' '}
                <span className="text-poke-text-muted">({playerReasonLabel(player.reason)})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(orphanedRows.length > 0 || ungroupedPlayers.length > 0) && (
        <p className="text-poke-text-muted">{t('repair.unresolvedNote')}</p>
      )}

      {plan.history.truncated && <Alert variant="warning">{t('repair.historyTruncated')}</Alert>}
      {plan.fixtures.truncated && (
        <Alert variant="warning">
          {/* A string, not a number: the bound reads as one figure ("20000"), as before. */}
          {t('repair.fixturesTruncated', { count: String(plan.fixtures.matches) })}
        </Alert>
      )}
      {plan.history.unreadable > 0 && (
        <p className="text-poke-text-muted">{t('repair.unreadable', { count: plan.history.unreadable })}</p>
      )}
    </div>
  );
}

/** What an apply wrote, move by move. */
export function GroupRepairHandedOver({ moves }: { moves: readonly GroupRepairMove[] }) {
  const t = useT(leaguePhasesMessages);
  const locale = useLocale();
  if (moves.length === 0) {
    return <Alert variant="success">{t('repair.handedOverNone')}</Alert>;
  }
  return (
    <Alert variant="success">
      <p>{t('repair.handedOver', { count: moves.length })}</p>
      <ul className="mt-1 space-y-0.5 text-xs">
        {moves.map((move) => (
          <li key={`${move.group_id}:${move.from_player_id}`}>
            {translateEngineLabel('group', move.group_name, locale)}: {move.from_player_name} →{' '}
            {move.to_player_name}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

/**
 * Finds the group rows that substitutions from before the group handover left
 * with the departed player, and hands them to the enrolled substitute.
 */
export default function PhaseGroupRepair({ seasonId, phaseId, reloadGroups }: PhaseGroupRepairProps) {
  const t = useT(leaguePhasesMessages);
  const errorText = useApiErrorText(errorsSeasons);
  const [plan, setPlan] = useState<GroupRepairResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [handedOver, setHandedOver] = useState<GroupRepairMove[] | null>(null);
  /** The last apply failed and the list was checked again after it. */
  const [rechecked, setRechecked] = useState(false);
  const [error, setError] = useState<GroupRepairError | null>(null);

  const request: GroupRepairRequest = async (body) => {
    const res = await fetch(`/api/seasons/${seasonId}/phases/${phaseId}/groups/repair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result: ApiResult<GroupRepairResult> = await res.json();
    return result;
  };

  async function handleCheck() {
    setChecking(true);
    setError(null);
    setHandedOver(null);
    setRechecked(false);
    try {
      const outcome = await checkRepair(request, reloadGroups);
      setPlan(outcome.plan);
      setError(outcome.error);
    } catch {
      setPlan(null);
      setError({ key: 'checkFailed' });
    } finally {
      setChecking(false);
    }
  }

  async function handleApply() {
    if (!plan || plan.moves.length === 0) return;
    if (!window.confirm(t('repair.confirmApply', { count: plan.moves.length }))) {
      return;
    }
    setApplying(true);
    setError(null);
    setHandedOver(null);
    setRechecked(false);
    try {
      const outcome = await applyReviewedRepair(plan, request, reloadGroups);
      setHandedOver(outcome.handedOver);
      setPlan(outcome.plan);
      setError(outcome.error);
      setRechecked(outcome.error !== null && outcome.plan !== null);
    } catch {
      setError({ key: 'repairFailed' });
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-3 rounded-poke-md border border-poke-border p-3">
      <div>
        <h4 className="text-sm font-heading font-semibold text-poke-text-primary">{t('repair.title')}</h4>
        <p className="text-xs text-poke-text-muted">{t('repair.intro')}</p>
      </div>

      {error && (
        <Alert variant="error">
          {'api' in error ? errorText(error.api) : t(`repair.errors.${error.key}`)}
        </Alert>
      )}
      {rechecked && <p className="text-xs text-poke-text-muted">{t('repair.rechecked')}</p>}
      {handedOver && <GroupRepairHandedOver moves={handedOver} />}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleCheck}
          loading={checking}
          disabled={applying}
        >
          {t('repair.check')}
        </Button>
        {plan && plan.moves.length > 0 && (
          <Button
            variant="primary"
            size="sm"
            onClick={handleApply}
            loading={applying}
            disabled={checking}
          >
            {t('repair.apply')}
          </Button>
        )}
      </div>

      {plan && <GroupRepairPlanView plan={plan} />}
    </div>
  );
}
