/**
 * Draftability reasons → `draft/shared.reasons.<CODE>`.
 * `ReasonDTO`s are not API errors: they render through this
 * map because `LINE_TAKEN` shows the owner's name, which is mapped here from
 * `player_id` using the snapshot participants.
 *
 * Pure and client-safe; components call `reasonText(t, reason, vm)` with
 * `t = useT(draftSharedMessages)` (or `getT` on the server).
 */
import type { Translator } from '@/i18n/core';
import type { DraftSharedEn } from '@/i18n/messages/draft/shared';
import type { ParamValue } from '@/i18n/types';
import type { ReasonCode, ReasonDTO } from './snapshot-types';

/** Every `ReasonCode` (a `Record` so a new DC-0 code fails `tsc` until it is listed). */
const REASON_CODE_SET: Record<ReasonCode, true> = {
  LINE_TAKEN: true,
  INSUFFICIENT_BUDGET: true,
  BUDGET_INFEASIBLE: true,
  NOT_ENOUGH_LINES: true,
  POOL_NOT_COMPLETABLE: true,
  POOL_CHECK_LIMIT: true,
  LINE_RESTRICTED: true,
  OWN_REDRAFT_DROP: true,
  COSMOG_REDRAFT_LOCKED: true,
  NOT_IN_LIST: true,
  NOT_YOUR_TURN: true,
  DRAFT_PAUSED: true,
  ROSTER_FULL: true,
  NOT_PARTICIPANT: true,
  SIGNED_OUT: true,
  DRAFT_NOT_STARTED: true,
  DRAFT_COMPLETE: true,
  NO_OPEN_REDRAFT_SLOT: true,
  SUBMISSION_PHASE: true,
};

/** The runtime list of the `ReasonCode` union. */
export const REASON_CODES = Object.freeze(Object.keys(REASON_CODE_SET) as ReasonCode[]);

export function isReasonCode(value: unknown): value is ReasonCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REASON_CODE_SET, value);
}

/** Params a message needs; a reason without them renders its `*_PLAIN` variant. */
const REQUIRED_PARAMS: Partial<Record<ReasonCode, readonly string[]>> = {
  INSUFFICIENT_BUDGET: ['price', 'remaining'],
  BUDGET_INFEASIBLE: ['shortfall', 'slots'],
  NOT_ENOUGH_LINES: ['available', 'slots'],
  ROSTER_FULL: ['size'],
};

/** Plural messages: which reason param selects the plural form (`count`). */
const COUNT_PARAM: Partial<Record<ReasonCode, string>> = {
  BUDGET_INFEASIBLE: 'slots',
  NOT_ENOUGH_LINES: 'available',
  ROSTER_FULL: 'size',
};

/** The participants the name lookup needs (a `DraftViewModel` satisfies it). */
export interface ReasonNameSource {
  readonly participants: readonly { readonly player_id: string; readonly name: string }[];
}

/**
 * Message params of a reason: `LINE_TAKEN {player_id}` becomes `{player}`
 * (the participant's name; '' when unknown, see `reasonText`); plural
 * messages get `count` from their counting param; the other params pass
 * through.
 */
export function reasonParams(reason: ReasonDTO, vm: ReasonNameSource): Record<string, string | number> {
  const params: Record<string, string | number> = { ...(reason.params ?? {}) };
  if (reason.code === 'LINE_TAKEN') {
    const playerId = params.player_id;
    delete params.player_id;
    const owner = vm.participants.find((p) => p.player_id === playerId);
    params.player = owner?.name ?? '';
  }
  const countParam = COUNT_PARAM[reason.code];
  if (countParam !== undefined && typeof params[countParam] === 'number') params.count = params[countParam];
  return params;
}

function hasParams(code: ReasonCode, params: Record<string, string | number>): boolean {
  return (REQUIRED_PARAMS[code] ?? []).every((name) => params[name] !== undefined && params[name] !== '');
}

/** The `draft/shared` key for a reason (`reasons.<CODE>` or `reasons.<CODE>_PLAIN`). */
export function reasonMessageKey(reason: ReasonDTO, params: Record<string, string | number> = reason.params ?? {}): string {
  return hasParams(reason.code, params) ? `reasons.${reason.code}` : `reasons.${reason.code}_PLAIN`;
}

/** The translated sentence for a reason. */
export function reasonText(t: Translator<DraftSharedEn>, reason: ReasonDTO, vm: ReasonNameSource): string {
  const params: Record<string, ParamValue> = reasonParams(reason, vm);
  if (reason.code === 'LINE_TAKEN' && params.player === '') params.player = t('player.unknown');
  return t.dynamic(reasonMessageKey(reason, params), params);
}
