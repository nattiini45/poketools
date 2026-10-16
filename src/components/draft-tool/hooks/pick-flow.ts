/**
 * The pick confirmation flow (draft-frontend §5.6). Pure: a reducer for the
 * dialog state and an async runner for one submission, both unit-tested.
 *
 * - `client_request_id` is minted when the dialog opens and reused for every
 *   retry of that dialog (idempotent; the server answers `replay: true`). A
 *   new open mints a new one.
 * - No optimistic taken-state: a success applies the response's snapshot
 *   first, then refreshes the poller (AGENTS.md "Live draft screens").
 * - A rule error applies its snapshot first, then is classified: state
 *   changes that make the dialog moot close it (toast + refresh); validation
 *   errors stay inline and re-arm; a network error offers Retry with the
 *   same id.
 */
import type { ApiErrorLike } from '@/i18n/api-errors';
import type { DraftSnapshotDTO, LineId } from '@/lib/draft-ui/snapshot-types';
import type { ApiCall, PickRequest, PickResult } from '../data-source';

export interface PickTarget {
  /** The active slot when the dialog opened (`vm.activeSlot.slot_id`). */
  slotId: string;
  lineId: LineId;
  /** Admin pick-on-behalf (§5.10): the active player. */
  onBehalfOf: { playerId: string; name: string } | null;
}

export interface PickFlowState {
  open: boolean;
  /** Bumps on every open (keys the dialog content). */
  openCount: number;
  target: PickTarget | null;
  /** Minted on open, reused for retries. */
  requestId: string | null;
  submitting: boolean;
  error: ApiErrorLike | null;
  /** The last failure was a network error: offer Retry. */
  retryable: boolean;
}

export type PickFlowAction =
  | { type: 'open'; target: PickTarget; requestId: string }
  | { type: 'submit' }
  | { type: 'failed'; error: ApiErrorLike; close: boolean }
  | { type: 'succeeded' }
  | { type: 'cancel' };

export const INITIAL_PICK_FLOW: PickFlowState = Object.freeze({
  open: false,
  openCount: 0,
  target: null,
  requestId: null,
  submitting: false,
  error: null,
  retryable: false,
});

export function pickFlowReducer(s: PickFlowState, a: PickFlowAction): PickFlowState {
  switch (a.type) {
    case 'open':
      if (s.open) return s;
      return {
        open: true,
        openCount: s.openCount + 1,
        target: a.target,
        requestId: a.requestId,
        submitting: false,
        error: null,
        retryable: false,
      };
    case 'submit':
      return s.open && !s.submitting ? { ...s, submitting: true, error: null, retryable: false } : s;
    case 'failed':
      if (!s.open) return s;
      if (a.close) return { ...s, open: false, submitting: false, error: null, retryable: false };
      return { ...s, submitting: false, error: a.error, retryable: a.error.code === 'network_error' };
    case 'succeeded':
    case 'cancel':
      if (!s.open || (a.type === 'cancel' && s.submitting)) return s;
      return { ...s, open: false, submitting: false, error: null, retryable: false };
  }
}

/**
 * Codes after which the dialog is moot: the draft moved on under the user.
 * Close, show the error as a toast, refresh.
 */
export const CLOSING_PICK_ERRORS: ReadonlySet<string> = new Set([
  'LINE_TAKEN',
  'STALE_SLOT',
  'NOT_YOUR_TURN',
  'DRAFT_PAUSED',
  'SLOT_BLOCKED',
  'DRAFT_NOT_ACTIVE',
  'DRAFT_NOT_STARTED',
  'DRAFT_COMPLETE',
  'POOL_NOT_ACTIVE',
  'SUBMISSION_PHASE',
  'ROSTER_FULL',
  'NOT_PARTICIPANT',
  'ACTOR_NOT_ALLOWED',
]);

export function closesDialog(error: ApiErrorLike): boolean {
  return typeof error.code === 'string' && CLOSING_PICK_ERRORS.has(error.code);
}

export interface PickInput {
  redraftSlotId: string | null;
  overrideReason: string | null;
}

/** Builds the request body; optional fields are omitted when unused. */
export function buildPickRequest(target: PickTarget, requestId: string, input: PickInput): PickRequest {
  const body: PickRequest = { slot_id: target.slotId, line_id: target.lineId, client_request_id: requestId };
  if (input.redraftSlotId) body.redraft_slot_id = input.redraftSlotId;
  if (target.onBehalfOf) {
    body.on_behalf_of = target.onBehalfOf.playerId;
    body.override_reason = (input.overrideReason ?? '').trim();
  }
  return body;
}

export type PickOutcome =
  | { kind: 'success'; replay: boolean }
  | { kind: 'closed'; error: ApiErrorLike }
  | { kind: 'inline'; error: ApiErrorLike };

export interface PickRunnerDeps {
  postPick(body: PickRequest): Promise<ApiCall<PickResult>>;
  applySnapshot(dto: DraftSnapshotDTO): void;
  refresh(): Promise<void>;
  /** Called after the snapshot is applied and before the refresh (close the dialog, toast, announce). */
  onSettled?(outcome: PickOutcome): void;
}

/**
 * One submission. Order on success: apply the response snapshot (when the
 * server sent one), settle (close, toast, announce), then `refresh()`. On failure: apply the error's
 * snapshot (if any) first; a closing error also refreshes.
 */
export async function runPickSubmission(deps: PickRunnerDeps, body: PickRequest): Promise<PickOutcome> {
  const res = await deps.postPick(body);
  if (res.ok) {
    if (res.data.snapshot) deps.applySnapshot(res.data.snapshot);
    const outcome: PickOutcome = { kind: 'success', replay: res.data.replay };
    deps.onSettled?.(outcome);
    await deps.refresh();
    return outcome;
  }
  if (res.snapshot) deps.applySnapshot(res.snapshot);
  if (closesDialog(res.error)) {
    const outcome: PickOutcome = { kind: 'closed', error: res.error };
    deps.onSettled?.(outcome);
    await deps.refresh();
    return outcome;
  }
  const outcome: PickOutcome = { kind: 'inline', error: res.error };
  deps.onSettled?.(outcome);
  return outcome;
}

/** The minimum admin override reason (BE §8.2). */
export const OVERRIDE_REASON_MIN = 3;

export function overrideReasonValid(reason: string): boolean {
  return reason.trim().length >= OVERRIDE_REASON_MIN;
}
