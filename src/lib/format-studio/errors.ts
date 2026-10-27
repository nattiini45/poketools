/**
 * Errors of the format library and of attaching a format to a league.
 *
 * - `FORMAT_ERROR_CODES` lists the codes explicitly. It is NOT derived from the `format_` prefix: the existing code
 *   `format_mismatch` (errors/seasons) has the prefix and is not ours, and `season_format_type_locked` has none.
 *   Every member must be an `ApiErrorCode` (checked by `satisfies`), so a code missing from a catalog fails `tsc`.
 * - `FORMAT_ERROR_STATUS` gives each code its HTTP status; a missing key fails `tsc`.
 * - `FormatStudioError` is a `UserFacingError`: `safeErrorResponse` passes its English text, code, params and status.
 * - `mapFormatDbError` turns the database signals of the format migrations (P0001 messages of the functions and the
 *   triggers, or SQLSTATE plus constraint name) into these errors. It matches on the exception message or the
 *   constraint name only, never on text a user typed, and returns anything else unchanged.
 *
 * Pure: no Supabase, no `next/*`, no `server-only`.
 */
import { createTranslator } from '@/i18n/core';
import type { ApiErrorCode, ApiErrorParams } from '@/i18n/messages/errors';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { detailNumber, parseDbError } from '@/lib/studio-core/db-errors';

export const FORMAT_ERROR_CODES = [
  // errors/admin: the library
  'format_not_found',
  'format_preset_not_found',
  'format_stale_revision',
  'format_slug_taken',
  'format_document_not_json',
  'format_document_not_object',
  'format_document_too_deep',
  'format_document_too_many_nodes',
  'format_document_too_large',
  'format_document_too_large_to_store',
  'format_document_name_required',
  'format_publish_invalid',
  'format_nothing_to_publish',
  'format_not_published',
  'format_published_locked',
  'format_visibility_forbidden',
  'format_preset_locked',
  'format_attached',
  'format_has_versions',
  'format_version_immutable',
  // errors/seasons: the league side
  'format_season_not_custom',
  'format_season_started',
  'format_attach_forbidden',
  'format_attach_ruleset_forbidden',
  'format_attach_invalid',
  'format_attach_ruleset_required',
  'format_attach_manual_phases',
  'format_not_attached',
  'format_nothing_attached',
  'format_detach_blocked',
  'season_format_type_locked',
] as const satisfies readonly ApiErrorCode[];

export type FormatErrorCode = (typeof FORMAT_ERROR_CODES)[number];

/** HTTP status per code. A missing or extra key fails `tsc`. */
export const FORMAT_ERROR_STATUS: { readonly [C in FormatErrorCode]: number } = {
  format_not_found: 404,
  format_preset_not_found: 404,
  format_stale_revision: 409,
  format_slug_taken: 409,
  format_document_not_json: 400,
  format_document_not_object: 400,
  format_document_too_deep: 422,
  format_document_too_many_nodes: 422,
  format_document_too_large: 413,
  format_document_too_large_to_store: 413,
  format_document_name_required: 422,
  format_publish_invalid: 422,
  format_nothing_to_publish: 409,
  format_not_published: 409,
  format_published_locked: 403,
  format_visibility_forbidden: 403,
  format_preset_locked: 403,
  format_attached: 409,
  format_has_versions: 409,
  format_version_immutable: 409,
  format_season_not_custom: 409,
  format_season_started: 409,
  format_attach_forbidden: 403,
  format_attach_ruleset_forbidden: 403,
  format_attach_invalid: 422,
  format_attach_ruleset_required: 409,
  format_attach_manual_phases: 409,
  format_not_attached: 409,
  format_nothing_attached: 404,
  format_detach_blocked: 409,
  season_format_type_locked: 409,
};

const englishAdmin = createTranslator(errorsAdmin, 'en');
const englishSeasons = createTranslator(errorsSeasons, 'en');

/** The English catalog text of a code (the message the server sends; clients translate by `code`). */
function englishMessage(code: FormatErrorCode, params?: Readonly<Record<string, string | number>>): string {
  // A code lives in exactly one catalog (codes are unique across catalogs).
  const translator = Object.prototype.hasOwnProperty.call(errorsSeasons.en, code) ? englishSeasons : englishAdmin;
  return translator.dynamic(code, params);
}

export class FormatStudioError<C extends FormatErrorCode = FormatErrorCode> extends UserFacingError<C> {
  /**
   * @param params placeholders of the catalog message
   * @param extra machine data a client may read besides the placeholders (for example `draft_rev` of a stale save)
   */
  constructor(code: C, params?: ApiErrorParams<C>, extra?: Record<string, string | number>) {
    const merged = params || extra ? { ...(params ?? {}), ...(extra ?? {}) } : undefined;
    super(englishMessage(code, merged), {
      code,
      params: merged as ApiErrorParams<C> | undefined,
      status: FORMAT_ERROR_STATUS[code],
    });
    this.name = 'FormatStudioError';
  }
}

const TOO_LARGE_TO_STORE_CONSTRAINTS: ReadonlySet<string> = new Set([
  'format_definitions_draft_size',
  'format_definition_versions_spec_size',
  'season_formats_spec_size',
]);

/**
 * Map a PostgREST error from the format functions, triggers and tables to a typed error. Anything that is not one
 * of the signals below is returned unchanged (the same object), so a caller may always `throw mapFormatDbError(e)`.
 */
export function mapFormatDbError(error: unknown): unknown {
  const e = parseDbError(error);
  if (!e) return error;

  if (e.code === 'P0001' && e.message !== undefined) {
    switch (e.message) {
      case 'FORMAT_NOT_FOUND':
        return new FormatStudioError('format_not_found');
      case 'FORMAT_STALE_REVISION':
        return new FormatStudioError('format_stale_revision', undefined, { draft_rev: detailNumber(e, 'draft_rev', 0) });
      case 'FORMAT_NOTHING_TO_PUBLISH':
        return new FormatStudioError('format_nothing_to_publish');
      case 'FORMAT_VERSION_IMMUTABLE':
        return new FormatStudioError('format_version_immutable');
      case 'FORMAT_SEASON_NOT_FOUND':
        return new UserFacingError('Season not found', { status: 404, code: 'season_not_found' });
      case 'FORMAT_SEASON_NOT_CUSTOM':
        return new FormatStudioError('format_season_not_custom');
      case 'FORMAT_SEASON_STARTED':
        return new FormatStudioError('format_season_started');
      case 'FORMAT_SEASON_HAS_MANUAL_PHASES':
        return new FormatStudioError('format_attach_manual_phases', { count: detailNumber(e, 'count', 1) });
      case 'FORMAT_NOT_ATTACHED':
        return new FormatStudioError('format_not_attached');
      case 'FORMAT_NOTHING_ATTACHED':
        return new FormatStudioError('format_nothing_attached');
      default:
        return error;
    }
  }

  const constraint = e.constraint;
  if (constraint === null) return error;

  if (e.code === '23505' && constraint === 'format_definitions_slug_key') {
    return new FormatStudioError('format_slug_taken');
  }
  if (e.code === '23514' && TOO_LARGE_TO_STORE_CONSTRAINTS.has(constraint)) {
    return new FormatStudioError('format_document_too_large_to_store');
  }
  if (e.code === '23503' && constraint === 'season_formats_definition_id_fkey') {
    return new FormatStudioError('format_not_found');
  }
  if (e.code === '23503' && constraint === 'teams_tournament_id_fkey') {
    return new FormatStudioError('format_detach_blocked');
  }
  return error;
}
