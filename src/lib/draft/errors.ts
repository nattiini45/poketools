/**
 * Draft error contract. Client-safe: no
 * `@pkmn/*`, no Supabase, no `next/*`, no `server-only`.
 *
 * - Codes are the keys of the `errors/draft` catalog; its `en` text is the one
 *   English source (`draftErrorMessage`).
 * - `params` are exactly the `{placeholders}` of that English message
 *   (`ApiErrorParams<C>`, `string | number`, never `null`); machine data that
 *   is never rendered goes in `detail` (BR-17).
 * - `DraftRuleError` extends `UserFacingError`, so `safeErrorResponse` passes
 *   its message, `code`, `params` and status through.
 */
import { createTranslator } from '@/i18n/core';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import type draftEn from '@/i18n/messages/errors/draft/en';
import type { ApiErrorParams } from '@/i18n/messages/errors';
import { UserFacingError } from '@/lib/api/user-facing-error';

/** Every key of `errors/draft` (§9.1, §9.2 and the G0-ERR seed). */
export type DraftErrorCode = keyof typeof draftEn & string;

/** HTTP status per code (§9 "HTTP" column). A missing or extra key fails `tsc`. */
export const DRAFT_ERROR_STATUS: { readonly [C in DraftErrorCode]: number } = {
  // G0-ERR seed (legacy engine)
  POOL_NOT_ACTIVE: 409,
  DRAFT_COMPLETE: 409,
  NOT_YOUR_TURN: 403,
  POKEMON_TAKEN: 409,
  INSUFFICIENT_BUDGET: 422,
  LINE_TAKEN: 409,
  // §9.1
  POOL_NOT_FOUND: 404,
  POOL_ENGINE_LEGACY: 409,
  /** A legacy-engine pool of a point-buy season: never activated, never picked (completability gate). */
  POOL_ENGINE_LEGACY_EPB: 409,
  LIST_NOT_FOUND: 404,
  ACTOR_NOT_ALLOWED: 403,
  OVERRIDE_REASON_REQUIRED: 422,
  DRAFT_NOT_ACTIVE: 409,
  DRAFT_NOT_STARTED: 409,
  DRAFT_ALREADY_STARTED: 409,
  SUBMISSION_PHASE: 409,
  DRAFT_PAUSED: 409,
  ALREADY_PAUSED: 409,
  NOT_PAUSED: 409,
  BLOCKED_SLOT_UNRESOLVED: 409,
  STALE_SLOT: 409,
  NOT_PARTICIPANT: 403,
  SLOT_BLOCKED: 409,
  SLOT_NOT_BLOCKED: 409,
  NOT_IN_LIST: 422,
  OWN_REDRAFT_DROP: 422,
  LINE_RESTRICTED: 422,
  COSMOG_REDRAFT_LOCKED: 422,
  ROSTER_FULL: 422,
  BUDGET_INFEASIBLE: 422,
  NOT_ENOUGH_LINES: 422,
  POOL_NOT_COMPLETABLE: 422,
  POOL_CHECK_LIMIT: 409,
  LEAGUE_NOT_COMPLETABLE: 409,
  REDRAFT_NOT_COMPLETABLE: 409,
  DRAFT_ABORT_NOT_ALLOWED: 409,
  REDRAFT_SLOT_REQUIRED: 422,
  REDRAFT_SLOT_INVALID: 422,
  REDRAFT_SLOT_FILLED: 422,
  REQUEST_ID_REUSED: 409,
  EXTENSION_NOT_ALLOWED: 409,
  EXTENSION_USED: 409,
  PICK_NOT_FOUND: 404,
  TRACKER_NOT_FOUND: 400,
  PICK_ALREADY_VOIDED: 409,
  CORRECTION_REQUIRES_PAUSE: 409,
  VOID_BLOCKED_PROGRESS: 409,
  USE_VOID_PICK: 409,
  SUBMISSION_LOCKED: 409,
  REDRAFT_MAX_EXCEEDED: 422,
  REDRAFT_MAX_BELOW_SUBMISSIONS: 409,
  TRACKER_NOT_OWNED: 422,
  LINE_NOT_DROPPABLE: 422,
  SUBMISSIONS_NOT_DUE: 409,
  SUBMISSIONS_ALREADY_PUBLISHED: 409,
  REDRAFT_NOT_YET_ALLOWED: 409,
  INITIAL_DRAFT_NOT_COMPLETE: 409,
  RESTORE_WOULD_OVERDRAW: 409,
  POOL_EXISTS: 409,
  POOL_NOT_DELETABLE: 409,
  POOL_HAS_REDRAFT: 409,
  POOL_HAS_TEAMS: 409,
  SEASON_HAS_NO_LIST: 409,
  SEASON_GROUP_REQUIRED: 409,
  SEASON_GROUP_INVALID: 422,
  SEASON_GROUP_LOCKED: 409,
  SEASON_GROUPS_AFTER_DRAFT: 409,
  SEASON_GROUP_MEMBERS_INVALID: 422,
  SEASON_GROUP_IN_USE: 409,
  SEASON_GROUPS_SCHEDULED: 409,
  SEASON_GROUP_TOO_SMALL: 422,
  SEASON_GROUP_SUBSTITUTION_LOCKED: 409,
  SEASON_GROUP_SEATS_STALE: 409,
  SEATS_INVALID: 422,
  INVALID_CONFIG: 422,
  TOKEN_WINDOW_CLOSED: 409,
  TOKEN_PLAYER_LIMIT: 422,
  TOKEN_LINE_LIMIT: 422,
  TOKEN_POINTS_SHORT: 422,
  TOKEN_WOULD_EVOLVE: 422,
  LINE_FULLY_EVOLVED: 422,
  COMEBACK_NOT_YET: 409,
  COMEBACK_BALANCE_SHORT: 422,
  COMEBACK_TOKENS_NOT_MULTIPLE: 422,
  FAVORITES_LIMIT: 422,
  ENDPOINT_REPLACED: 410,
  REDRAFT_TRADE_RETIRED: 410,
  // §9.2 legacy api/drafts/** branches
  POINT_BUDGET_REQUIRED: 400,
  NOT_IN_POOL: 422,
  TIER_LIMIT_REACHED: 422,
  PICK_CAP_REACHED: 422,
  POINTS_CAP_EXCEEDED: 422,
  REPLAY_PICK_EVENTS_AUTO: 400,
  INVALID_INCLUDE: 400,
  UNDO_NOT_ACTIVE: 409,
  // Malformed path ids (repo convention: 404 + INVALID_*_ID, before any read)
  INVALID_PICK_ID: 404,
  INVALID_REDRAFT_SLOT_ID: 404,
};

/** `Object.keys(errorsDraft.en)`, in catalog order. */
export const DRAFT_ERROR_CODES: readonly DraftErrorCode[] = Object.freeze(
  Object.keys(errorsDraft.en) as DraftErrorCode[],
);

const CODE_SET: ReadonlySet<string> = new Set(DRAFT_ERROR_CODES);

/**
 * SQL-internal invariant codes (`RAISE EXCEPTION`), deliberately not catalog
 * keys: `toDraftRuleError` (B-SNAP) maps them to `null`, so they surface as a
 * logged 500 through `safeErrorResponse`.
 */
export const INTERNAL_DRAFT_CODES = [
  'THRESHOLDS_REQUIRED',
  'ACTIVE_SLOT_EXISTS',
  'COMPLETABILITY_INVARIANT',
  // A tracker naming a group that is not its trainer's (evolution_tracker__group, 20261018180000).
  'SEASON_GROUP_MISMATCH',
] as const;
export type InternalDraftCode = (typeof INTERNAL_DRAFT_CODES)[number];

/** Machine data beside an error (e.g. `STALE_SLOT {current_slot_id}`); never rendered. */
export type DraftErrorDetail = Readonly<Record<string, string | number>>;

/** True for a key of `errors/draft` (e.g. a Postgres `RAISE EXCEPTION` message). */
export function isDraftErrorCode(value: unknown): value is DraftErrorCode {
  return typeof value === 'string' && CODE_SET.has(value);
}

const english = createTranslator(errorsDraft, 'en');

/** English text of a code = the `errors/draft` `en` message (one English source). */
export function draftErrorMessage<C extends DraftErrorCode>(code: C, params?: ApiErrorParams<C>): string {
  return english.dynamic(code, params);
}

const PLACEHOLDER = /\{(\w+)\}/g;
const paramNameCache = new Map<DraftErrorCode, readonly string[]>();

/** Placeholder names of the `en` message in order of first use, parsed once and memoised. */
export function paramNamesOf(code: DraftErrorCode): readonly string[] {
  const cached = paramNameCache.get(code);
  if (cached) return cached;
  const template: string = errorsDraft.en[code];
  const names: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  const frozen = Object.freeze(names);
  paramNameCache.set(code, frozen);
  return frozen;
}

/** Compatibility view used by route tests: `{ status, message(params) }` per code. */
export const DRAFT_ERROR_META: {
  readonly [C in DraftErrorCode]: { readonly status: number; message: (p?: ApiErrorParams<C>) => string };
} = Object.freeze(
  Object.fromEntries(
    DRAFT_ERROR_CODES.map((code) => [
      code,
      Object.freeze({
        status: DRAFT_ERROR_STATUS[code],
        message: (p?: Readonly<Record<string, string | number>>) => english.dynamic(code, p),
      }),
    ]),
  ),
) as {
  readonly [C in DraftErrorCode]: { readonly status: number; message: (p?: ApiErrorParams<C>) => string };
};

/**
 * A draft rule violation. `message` is the English catalog text; `code`,
 * `params` and `statusCode` come from `UserFacingError` (no redeclared
 * `params`); `detail` is machine data for the response's `detail` field.
 */
export class DraftRuleError<C extends DraftErrorCode = DraftErrorCode> extends UserFacingError<C> {
  readonly detail?: DraftErrorDetail;

  constructor(code: C, params?: ApiErrorParams<C>, detail?: DraftErrorDetail) {
    super(draftErrorMessage(code, params), { code, params, status: DRAFT_ERROR_STATUS[code] });
    this.name = 'DraftRuleError';
    if (detail !== undefined) this.detail = detail;
  }
}
