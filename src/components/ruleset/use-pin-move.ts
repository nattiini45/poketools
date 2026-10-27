'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { classifyApiError, movePinsRequest, type PinTargetRef } from '@/lib/ruleset-studio/editor/api';
import type { MovePinsOutcome } from '@/lib/ruleset-studio/pin-info';
import type { FetchLike } from '@/lib/studio-core/request';
import { usePinImpact, type PinImpactState } from './use-pin-impact';

export interface PinMoveControl {
  /** The move request is in flight. */
  busy: boolean;
  /** Why the last move failed; cleared by the next one. */
  error: ApiErrorLike | null;
  /** The confirmation dialog is open. */
  asking: boolean;
  /** The count of submitted teams the move would invalidate, for the dialog. */
  impact: PinImpactState;
  /** Opens the confirmation of a move that includes running targets and starts counting the teams it would invalidate. */
  ask: (toVersionNo: number, targets: readonly PinTargetRef[]) => void;
  /**
   * Moves the targets to the version. `confirmStarted` holds the ids of the running ones. The dialog closes whatever the
   * answer; on success the page is refreshed and the server's answer is returned, on failure `error` is set and the result
   * is null. A conflict (a concurrent change moved the pin) refreshes the page too, so the admin sees the current state and
   * can retry the move from it.
   */
  move: (toVersionNo: number, targets: readonly PinTargetRef[], confirmStarted: readonly string[]) => Promise<MovePinsOutcome | null>;
  /** Closes the confirmation and drops a late impact answer. */
  close: () => void;
}

/** What a move changes on the screen; `usePinMove` wires it to state and the router. */
export interface PinMoveEffects {
  setBusy: (busy: boolean) => void;
  setError: (error: ApiErrorLike | null) => void;
  /** Closes the confirmation dialog. */
  close: () => void;
  /** Reads the page's server data again. */
  refresh: () => void;
}

/**
 * The request logic behind `usePinMove`, apart from React so it can be tested without a renderer. A move that succeeded
 * refreshes the page. So does one that hit a conflict (`ruleset_pin_moved`: a concurrent change moved the pin, or the
 * moves before it already ran): what the page shows is stale, and the error stays on screen beside the fresh state, whose
 * update button is the retry. Any other failure leaves the page as it is.
 */
export async function runPinMove(
  definitionId: string,
  toVersionNo: number,
  targets: readonly PinTargetRef[],
  confirmStarted: readonly string[],
  effects: PinMoveEffects,
  f?: FetchLike,
): Promise<MovePinsOutcome | null> {
  effects.setBusy(true);
  effects.setError(null);
  const outcome = await movePinsRequest(definitionId, toVersionNo, targets, confirmStarted, f);
  effects.setBusy(false);
  effects.close();
  if (outcome.ok) {
    effects.refresh();
    return outcome.data;
  }
  effects.setError(outcome.error);
  if (classifyApiError(outcome.error, outcome.status).kind === 'conflict') effects.refresh();
  return null;
}

/**
 * The flow behind every "update to the newest version" button of a ruleset: the confirmation for running targets with its
 * impact count, the move request through `POST /api/ruleset-definitions/[id]/pins`, and the refresh of the page after it.
 * The pin card (one target) and the usage panel (a selection) render from it.
 */
export function usePinMove(definitionId: string): PinMoveControl {
  const router = useRouter();
  const impact = usePinImpact();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);
  const [asking, setAsking] = useState(false);

  const close = () => {
    setAsking(false);
    impact.reset();
  };

  const ask: PinMoveControl['ask'] = (toVersionNo, targets) => {
    setAsking(true);
    void impact.load(definitionId, toVersionNo, targets);
  };

  const move: PinMoveControl['move'] = (toVersionNo, targets, confirmStarted) =>
    runPinMove(definitionId, toVersionNo, targets, confirmStarted, { setBusy, setError, close, refresh: () => router.refresh() });

  return { busy, error, asking, impact: impact.state, ask, move, close };
}
