/**
 * Errors of the ruleset library and of moving a league's ruleset pin.
 *
 * - `RULESET_ERROR_CODES` lists the codes explicitly (not derived from a prefix: `ruleset_not_found` lives in
 *   `errors/tournaments` and is shared with the old routes; the attach refusal `format_attach_ruleset_forbidden` is a
 *   Format Studio code, `src/lib/format-studio/errors.ts`).
 *   Every member must be an `ApiErrorCode` (`satisfies`), so a code missing from a catalog fails `tsc`.
 * - `RULESET_ERROR_STATUS` gives each code its HTTP status; a missing key fails `tsc`.
 * - `RulesetStudioError` is a `UserFacingError`: `safeErrorResponse` passes its English text, code, params and status.
 * - `mapRulesetDbError` turns the database signals of the ruleset migrations (P0001 messages of the functions and the
 *   immutability trigger, SQLSTATE plus constraint name of the tables) into these errors. It matches on the exception
 *   message or the constraint name only, never on text a user typed, and returns anything else unchanged.
 *
 * Pure: no Supabase, no `next/*`, no `server-only`.
 */
import { createTranslator } from '@/i18n/core';
import type { ApiErrorCode, ApiErrorParams } from '@/i18n/messages/errors';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsTournaments } from '@/i18n/messages/errors/tournaments';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { detailNumber, parseDbError } from '@/lib/studio-core/db-errors';

export const RULESET_ERROR_CODES = [
  // errors/tournaments (shared with the pre-studio routes)
  'ruleset_not_found',
  // errors/admin: the library
  'ruleset_forbidden',
  'ruleset_slug_taken',
  'ruleset_stale_revision',
  'ruleset_document_not_json',
  'ruleset_document_not_object',
  'ruleset_document_too_deep',
  'ruleset_document_too_many_nodes',
  'ruleset_document_too_large',
  'ruleset_document_too_large_to_store',
  'ruleset_document_invalid',
  'ruleset_nothing_to_publish',
  'ruleset_not_published',
  'ruleset_published_locked',
  'ruleset_visibility_forbidden',
  'ruleset_preset_locked',
  'ruleset_preset_unknown',
  'ruleset_in_use',
  'ruleset_version_immutable',
  'ruleset_legacy_editor_unsupported',
  'ruleset_version_quota_exceeded',
  'ruleset_owner_quota_exceeded',
  'ruleset_pin_mismatch',
  'ruleset_pin_locked',
  'ruleset_pin_started',
  'ruleset_pin_confirm_required',
] as const satisfies readonly ApiErrorCode[];

export type RulesetErrorCode = (typeof RULESET_ERROR_CODES)[number];

/** HTTP status per code. A missing or extra key fails `tsc`. */
export const RULESET_ERROR_STATUS: { readonly [C in RulesetErrorCode]: number } = {
  ruleset_not_found: 404,
  ruleset_forbidden: 403,
  ruleset_slug_taken: 409,
  ruleset_stale_revision: 409,
  ruleset_document_not_json: 400,
  ruleset_document_not_object: 400,
  ruleset_document_too_deep: 422,
  ruleset_document_too_many_nodes: 422,
  ruleset_document_too_large: 413,
  ruleset_document_too_large_to_store: 413,
  ruleset_document_invalid: 422,
  ruleset_nothing_to_publish: 409,
  ruleset_not_published: 409,
  ruleset_published_locked: 403,
  ruleset_visibility_forbidden: 403,
  ruleset_preset_locked: 403,
  ruleset_preset_unknown: 404,
  ruleset_in_use: 409,
  ruleset_version_immutable: 409,
  ruleset_legacy_editor_unsupported: 409,
  ruleset_version_quota_exceeded: 409,
  ruleset_owner_quota_exceeded: 409,
  ruleset_pin_mismatch: 409,
  ruleset_pin_locked: 409,
  ruleset_pin_started: 409,
  ruleset_pin_confirm_required: 409,
};

const englishAdmin = createTranslator(errorsAdmin, 'en');
const englishTournaments = createTranslator(errorsTournaments, 'en');

/** The English catalog text of a code (the message the server sends; clients translate by `code`). */
function englishMessage(code: RulesetErrorCode, params?: Readonly<Record<string, string | number>>): string {
  // A code lives in exactly one catalog (codes are unique across catalogs).
  if (Object.prototype.hasOwnProperty.call(errorsTournaments.en, code)) return englishTournaments.dynamic(code, params);
  return englishAdmin.dynamic(code, params);
}

export class RulesetStudioError<C extends RulesetErrorCode = RulesetErrorCode> extends UserFacingError<C> {
  /**
   * @param params placeholders of the catalog message
   * @param extra machine data a client may read besides the placeholders (for example `draft_rev` of a stale save)
   */
  constructor(code: C, params?: ApiErrorParams<C>, extra?: Record<string, string | number>) {
    const merged = params || extra ? { ...(params ?? {}), ...(extra ?? {}) } : undefined;
    super(englishMessage(code, merged), {
      code,
      params: merged as ApiErrorParams<C> | undefined,
      status: RULESET_ERROR_STATUS[code],
    });
    this.name = 'RulesetStudioError';
  }
}

const TOO_LARGE_TO_STORE_CONSTRAINTS: ReadonlySet<string> = new Set([
  'ruleset_definitions_draft_size',
  'ruleset_definition_versions_spec_size',
  'ruleset_definition_versions_resolved_size',
]);

/** The pin keys: a delete of a version (or of a definition, which cascades over its versions) that a league or phase pins. */
const PIN_CONSTRAINTS: ReadonlySet<string> = new Set(['seasons_ruleset_id_fkey', 'tournaments_ruleset_id_fkey']);

/** Maximum published versions of one definition (`ruleset_publish_version`). */
export const MAX_VERSIONS_PER_RULESET = 100;

/**
 * Map a PostgREST error from the ruleset functions, triggers and tables to a typed error. Anything that is not one of the
 * signals below is returned unchanged (the same object), so a caller may always `throw mapRulesetDbError(e)`. `inUseCount`
 * is the number of pins the caller counted when a pin key is violated (the database message does not carry it).
 */
export function mapRulesetDbError(error: unknown, inUseCount = 1): unknown {
  const e = parseDbError(error);
  if (!e) return error;

  if (e.code === 'P0001' && e.message !== undefined) {
    switch (e.message) {
      case 'RULESET_NOT_FOUND':
        return new RulesetStudioError('ruleset_not_found');
      case 'RULESET_STALE_REVISION':
        return new RulesetStudioError('ruleset_stale_revision', undefined, { draft_rev: detailNumber(e, 'draft_rev', 0) });
      case 'RULESET_NOTHING_TO_PUBLISH':
        return new RulesetStudioError('ruleset_nothing_to_publish');
      case 'RULESET_VERSION_IMMUTABLE':
        return new RulesetStudioError('ruleset_version_immutable');
      case 'RULESET_QUOTA_EXCEEDED':
        return new RulesetStudioError('ruleset_version_quota_exceeded', { max: detailNumber(e, 'max', MAX_VERSIONS_PER_RULESET) });
      default:
        return error;
    }
  }

  const constraint = e.constraint;
  if (constraint === null) return error;

  if (e.code === '23505' && constraint === 'ruleset_definitions_slug_key') return new RulesetStudioError('ruleset_slug_taken');
  if (e.code === '23514' && TOO_LARGE_TO_STORE_CONSTRAINTS.has(constraint)) {
    return new RulesetStudioError('ruleset_document_too_large_to_store');
  }
  if (e.code === '23503' && PIN_CONSTRAINTS.has(constraint)) return new RulesetStudioError('ruleset_in_use', { count: inUseCount });
  return error;
}
