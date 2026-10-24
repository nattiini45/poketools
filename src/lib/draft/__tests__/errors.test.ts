import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/i18n/core';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import { UserFacingError } from '@/lib/api/user-facing-error';
import {
  DRAFT_ERROR_CODES,
  DRAFT_ERROR_META,
  DRAFT_ERROR_STATUS,
  DraftRuleError,
  INTERNAL_DRAFT_CODES,
  draftErrorMessage,
  isDraftErrorCode,
  paramNamesOf,
  type DraftErrorCode,
} from '../errors';

/** Every draft error code, plus the shared seed codes. */
const DESIGN_CODES = [
  // G0-ERR seed
  'POOL_NOT_ACTIVE', 'DRAFT_COMPLETE', 'NOT_YOUR_TURN', 'POKEMON_TAKEN', 'INSUFFICIENT_BUDGET', 'LINE_TAKEN',
  // §9.1
  'POOL_NOT_FOUND', 'POOL_ENGINE_LEGACY', 'POOL_ENGINE_LEGACY_EPB', 'LIST_NOT_FOUND', 'ACTOR_NOT_ALLOWED', 'OVERRIDE_REASON_REQUIRED',
  'DRAFT_NOT_ACTIVE', 'DRAFT_NOT_STARTED', 'DRAFT_ALREADY_STARTED', 'SUBMISSION_PHASE', 'DRAFT_PAUSED',
  'ALREADY_PAUSED', 'NOT_PAUSED', 'BLOCKED_SLOT_UNRESOLVED', 'STALE_SLOT', 'NOT_PARTICIPANT', 'SLOT_BLOCKED',
  'SLOT_NOT_BLOCKED', 'NOT_IN_LIST', 'OWN_REDRAFT_DROP', 'LINE_RESTRICTED', 'COSMOG_REDRAFT_LOCKED', 'ROSTER_FULL',
  'BUDGET_INFEASIBLE', 'NOT_ENOUGH_LINES',
  // pool completability: no forfeit, every pool always stays completable
  'POOL_NOT_COMPLETABLE', 'POOL_CHECK_LIMIT', 'LEAGUE_NOT_COMPLETABLE', 'REDRAFT_NOT_COMPLETABLE', 'DRAFT_ABORT_NOT_ALLOWED',
  'REDRAFT_SLOT_REQUIRED', 'REDRAFT_SLOT_INVALID', 'REDRAFT_SLOT_FILLED',
  'REQUEST_ID_REUSED', 'EXTENSION_NOT_ALLOWED', 'EXTENSION_USED', 'PICK_NOT_FOUND', 'PICK_ALREADY_VOIDED',
  'CORRECTION_REQUIRES_PAUSE', 'VOID_BLOCKED_PROGRESS', 'USE_VOID_PICK', 'SUBMISSION_LOCKED', 'REDRAFT_MAX_EXCEEDED',
  'REDRAFT_MAX_BELOW_SUBMISSIONS', 'TRACKER_NOT_OWNED',
  'TRACKER_NOT_FOUND', 'LINE_NOT_DROPPABLE', 'SUBMISSIONS_NOT_DUE', 'SUBMISSIONS_ALREADY_PUBLISHED',
  'REDRAFT_NOT_YET_ALLOWED', 'INITIAL_DRAFT_NOT_COMPLETE', 'RESTORE_WOULD_OVERDRAW', 'POOL_EXISTS', 'POOL_NOT_DELETABLE',
  'POOL_HAS_REDRAFT', 'POOL_HAS_TEAMS',
  'SEASON_HAS_NO_LIST', 'SEATS_INVALID', 'INVALID_CONFIG', 'TOKEN_WINDOW_CLOSED', 'TOKEN_PLAYER_LIMIT',
  'TOKEN_LINE_LIMIT', 'TOKEN_POINTS_SHORT', 'TOKEN_WOULD_EVOLVE', 'LINE_FULLY_EVOLVED', 'COMEBACK_NOT_YET',
  'COMEBACK_BALANCE_SHORT', 'COMEBACK_TOKENS_NOT_MULTIPLE', 'FAVORITES_LIMIT', 'ENDPOINT_REPLACED',
  'REDRAFT_TRADE_RETIRED',
  // §9.2
  'POINT_BUDGET_REQUIRED', 'NOT_IN_POOL', 'TIER_LIMIT_REACHED', 'PICK_CAP_REACHED', 'POINTS_CAP_EXCEEDED',
  'REPLAY_PICK_EVENTS_AUTO', 'INVALID_INCLUDE', 'UNDO_NOT_ACTIVE',
  // malformed path ids
  'INVALID_PICK_ID', 'INVALID_REDRAFT_SLOT_ID',
  // league groups (20261018180000)
  'SEASON_GROUP_REQUIRED', 'SEASON_GROUP_INVALID', 'SEASON_GROUP_LOCKED', 'SEASON_GROUPS_AFTER_DRAFT',
  'SEASON_GROUP_MEMBERS_INVALID', 'SEASON_GROUP_IN_USE',
  // league groups, round 4 (20261018202000)
  'SEASON_GROUPS_SCHEDULED', 'SEASON_GROUP_TOO_SMALL', 'SEASON_GROUP_SUBSTITUTION_LOCKED',
  'SEASON_GROUP_SEATS_STALE',
] as const;

/** Params column of §9 (placeholders of the en message). */
const DESIGN_PARAMS: Partial<Record<DraftErrorCode, readonly string[]>> = {
  POKEMON_TAKEN: ['pokemon'],
  INSUFFICIENT_BUDGET: ['remaining', 'price'],
  ROSTER_FULL: ['size'],
  BUDGET_INFEASIBLE: ['shortfall', 'slots'],
  NOT_ENOUGH_LINES: ['available', 'slots'],
  LEAGUE_NOT_COMPLETABLE: ['lines', 'slots', 'participants'],
  REDRAFT_NOT_COMPLETABLE: ['lines', 'slots'],
  VOID_BLOCKED_PROGRESS: ['progress'],
  REDRAFT_MAX_EXCEEDED: ['max'],
  REDRAFT_MAX_BELOW_SUBMISSIONS: ['count'],
  TRACKER_NOT_FOUND: ['pokemon'],
  INVALID_CONFIG: ['field'],
  TOKEN_PLAYER_LIMIT: ['max'],
  TOKEN_POINTS_SHORT: ['needed', 'remaining'],
  TOKEN_WOULD_EVOLVE: ['progress', 'next'],
  COMEBACK_BALANCE_SHORT: ['balance'],
  COMEBACK_TOKENS_NOT_MULTIPLE: ['ratio'],
  FAVORITES_LIMIT: ['max'],
  NOT_IN_POOL: ['pokemon'],
  TIER_LIMIT_REACHED: ['tier', 'max'],
  PICK_CAP_REACHED: ['max'],
  POINTS_CAP_EXCEEDED: ['spend', 'budget', 'price'],
  INVALID_INCLUDE: ['allowed'],
};

const STATUSES = new Set([400, 403, 404, 409, 410, 422]);

/** One code's meta with the params widened, so a loop over the code union can call it. */
type WideMeta = { readonly status: number; message: (p?: Readonly<Record<string, string | number>>) => string };

describe('errors/draft catalog', () => {
  it('holds exactly the §9 codes and the G0-ERR seed', () => {
    expect([...DRAFT_ERROR_CODES].sort()).toEqual([...DESIGN_CODES].sort());
  });

  it('keeps the G0-ERR seed English, with the §9.1 second-person text for the turn, complete and budget codes', () => {
    expect(errorsDraft.en.POOL_NOT_ACTIVE).toBe('Draft is not currently active');
    expect(errorsDraft.en.DRAFT_COMPLETE).toBe('The draft is complete.');
    expect(errorsDraft.en.NOT_YOUR_TURN).toBe('It is not your turn.');
    expect(errorsDraft.en.POKEMON_TAKEN).toBe('{pokemon} has already been drafted');
    expect(errorsDraft.en.INSUFFICIENT_BUDGET).toBe('Insufficient budget: this line costs {price} P, you have {remaining} P.');
    expect(errorsDraft.de.NOT_YOUR_TURN).toBe('Du bist gerade nicht am Zug.');
    expect(errorsDraft.de.DRAFT_COMPLETE).toBe('Der Draft ist abgeschlossen.');
    expect(errorsDraft.de.INSUFFICIENT_BUDGET).toBe(
      'Budget reicht nicht: Diese Linie kostet {price} P, du hast {remaining} P.',
    );
  });

  it('has German for every code, with the same placeholders, and du-form text', () => {
    for (const code of DRAFT_ERROR_CODES) {
      const de: string = errorsDraft.de[code];
      expect(de, code).toBeTruthy();
      const deNames = [...de.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(deNames, code).toEqual([...paramNamesOf(code)].sort());
      expect(de, code).not.toMatch(/\bSie\b|\bIhr(e|en|em)?\b/);
    }
    expect(errorsDraft.de.USE_VOID_PICK).toContain('„Pick annullieren“');
    expect(errorsDraft.de.STALE_SLOT).toBe('Dieser Pick ist nicht mehr aktuell – der Draft ist schon weiter.');
  });

  it('keeps the SQL-internal codes out of the catalog', () => {
    for (const code of INTERNAL_DRAFT_CODES) {
      expect(isDraftErrorCode(code)).toBe(false);
      expect(errorsDraft.en).not.toHaveProperty(code);
    }
    expect(isDraftErrorCode('STALE_SLOT')).toBe(true);
    expect(isDraftErrorCode('VALIDATION_FAILED')).toBe(false);
    expect(isDraftErrorCode(42)).toBe(false);
  });
});

describe('DRAFT_ERROR_STATUS', () => {
  it('covers every catalog key with an HTTP error status, and nothing else', () => {
    expect(Object.keys(DRAFT_ERROR_STATUS).sort()).toEqual([...DRAFT_ERROR_CODES].sort());
    for (const code of DRAFT_ERROR_CODES) expect(STATUSES.has(DRAFT_ERROR_STATUS[code]), code).toBe(true);
  });

  it('matches the §9 HTTP column on representative rows', () => {
    expect(DRAFT_ERROR_STATUS.POOL_NOT_FOUND).toBe(404);
    expect(DRAFT_ERROR_STATUS.NOT_YOUR_TURN).toBe(403);
    expect(DRAFT_ERROR_STATUS.STALE_SLOT).toBe(409);
    expect(DRAFT_ERROR_STATUS.POOL_NOT_DELETABLE).toBe(409);
    expect(DRAFT_ERROR_STATUS.POOL_HAS_REDRAFT).toBe(409);
    expect(DRAFT_ERROR_STATUS.POOL_HAS_TEAMS).toBe(409);
    expect(DRAFT_ERROR_STATUS.BUDGET_INFEASIBLE).toBe(422);
    expect(DRAFT_ERROR_STATUS.ENDPOINT_REPLACED).toBe(410);
    expect(DRAFT_ERROR_STATUS.POINT_BUDGET_REQUIRED).toBe(400);
  });

  it('pool gate: a refused pick is line-level (422 like BUDGET_INFEASIBLE); start/publish/limit/abort are 409', () => {
    expect(DRAFT_ERROR_STATUS.POOL_NOT_COMPLETABLE).toBe(422);
    expect(DRAFT_ERROR_STATUS.POOL_CHECK_LIMIT).toBe(409);
    expect(DRAFT_ERROR_STATUS.LEAGUE_NOT_COMPLETABLE).toBe(409);
    expect(DRAFT_ERROR_STATUS.REDRAFT_NOT_COMPLETABLE).toBe(409);
    expect(DRAFT_ERROR_STATUS.DRAFT_ABORT_NOT_ALLOWED).toBe(409);
    expect(INTERNAL_DRAFT_CODES).toContain('COMPLETABILITY_INVARIANT');
    expect(isDraftErrorCode('COMPLETABILITY_INVARIANT')).toBe(false);
  });
});

describe('draftErrorMessage / paramNamesOf', () => {
  const en = createTranslator(errorsDraft, 'en');

  it('equals the catalog en text for every code', () => {
    for (const code of DRAFT_ERROR_CODES) {
      const params = Object.fromEntries(paramNamesOf(code).map((n, i) => [n, `v${i}`]));
      expect(draftErrorMessage(code, params), code).toBe(en.dynamic(code, params));
      const meta = (DRAFT_ERROR_META as Record<DraftErrorCode, WideMeta>)[code];
      expect(meta.message(params), code).toBe(draftErrorMessage(code, params));
      expect(DRAFT_ERROR_META[code].status).toBe(DRAFT_ERROR_STATUS[code]);
    }
  });

  it('interpolates params into the English text', () => {
    expect(draftErrorMessage('BUDGET_INFEASIBLE', { shortfall: 4, slots: 2 })).toBe(
      'Not draftable – after this pick you would be at least 4 points short of filling your last 2 roster slots.',
    );
    expect(draftErrorMessage('POOL_NOT_FOUND')).toBe('Draft not found.');
  });

  it('parses the placeholder names of the en message', () => {
    expect(paramNamesOf('BUDGET_INFEASIBLE')).toEqual(['shortfall', 'slots']);
    expect(paramNamesOf('POOL_NOT_FOUND')).toEqual([]);
    expect(paramNamesOf('BUDGET_INFEASIBLE')).toBe(paramNamesOf('BUDGET_INFEASIBLE')); // memoised
    for (const code of DRAFT_ERROR_CODES) {
      expect([...paramNamesOf(code)].sort(), code).toEqual([...(DESIGN_PARAMS[code] ?? [])].sort());
    }
  });
});

describe('DraftRuleError', () => {
  it('carries code/params/statusCode from the base class and a separate detail', () => {
    const err = new DraftRuleError(
      'BUDGET_INFEASIBLE',
      { shortfall: 4, slots: 2 },
      { remaining_after: 10, min_cost: 14 },
    );
    expect(err).toBeInstanceOf(UserFacingError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('DraftRuleError');
    expect(err.code).toBe('BUDGET_INFEASIBLE');
    expect(err.params).toEqual({ shortfall: 4, slots: 2 });
    expect(err.statusCode).toBe(422);
    expect(err.detail).toEqual({ remaining_after: 10, min_cost: 14 });
    expect(err.message).toBe(draftErrorMessage('BUDGET_INFEASIBLE', { shortfall: 4, slots: 2 }));
    expect(Object.prototype.hasOwnProperty.call(err, 'detail')).toBe(true);
  });

  it('works without params or detail', () => {
    const err = new DraftRuleError('STALE_SLOT');
    expect(err.message).toBe('This pick is no longer on the clock.');
    expect(err.statusCode).toBe(409);
    expect(err.params).toBeUndefined();
    expect(err.detail).toBeUndefined();
  });

  it('keeps non-rendered machine data in detail, not in the message', () => {
    const err = new DraftRuleError('STALE_SLOT', undefined, { current_slot_id: 's-2', current_player_id: 'p-2' });
    expect(err.message).not.toContain('s-2');
    expect(err.detail).toEqual({ current_slot_id: 's-2', current_player_id: 'p-2' });
  });
});
