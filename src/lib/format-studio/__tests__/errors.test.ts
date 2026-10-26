import { describe, expect, it } from 'vitest';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { FORMAT_ERROR_CODES, FORMAT_ERROR_STATUS, FormatStudioError, mapFormatDbError } from '../errors';

describe('code list', () => {
  it('equals the keys this feature added to the two catalogs', () => {
    // Every format_* key except the pre-existing format_mismatch (the point-buy league check), plus the league type lock.
    const fromCatalogs = [
      ...Object.keys(errorsAdmin.en).filter((key) => key.startsWith('format_')),
      ...Object.keys(errorsSeasons.en).filter((key) => key.startsWith('format_') && key !== 'format_mismatch'),
      'season_format_type_locked',
    ];
    expect([...FORMAT_ERROR_CODES].sort()).toEqual(fromCatalogs.sort());
    expect(FORMAT_ERROR_CODES).toHaveLength(30);
    expect(FORMAT_ERROR_CODES).not.toContain('format_mismatch');
  });

  it('has a status for every code and no extra status key', () => {
    expect(Object.keys(FORMAT_ERROR_STATUS).sort()).toEqual([...FORMAT_ERROR_CODES].sort());
    for (const code of FORMAT_ERROR_CODES) {
      expect(FORMAT_ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(FORMAT_ERROR_STATUS[code]).toBeLessThan(500);
    }
  });

  it('has an English and a German text for every code, in exactly one catalog', () => {
    for (const code of FORMAT_ERROR_CODES) {
      const inAdmin = code in errorsAdmin.en;
      const inSeasons = code in errorsSeasons.en;
      expect(inAdmin !== inSeasons, code).toBe(true);
      const catalog = inAdmin ? errorsAdmin : errorsSeasons;
      expect(code in catalog.de, code).toBe(true);
    }
  });

  it('states the statuses of the contract', () => {
    expect(FORMAT_ERROR_STATUS).toMatchObject({
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
      format_attach_invalid: 422,
      format_attach_ruleset_required: 409,
      format_attach_manual_phases: 409,
      format_not_attached: 409,
      format_nothing_attached: 404,
      format_detach_blocked: 409,
      season_format_type_locked: 409,
    });
  });
});

describe('FormatStudioError', () => {
  it('is a UserFacingError carrying the English catalog text, the code and the status', () => {
    const error = new FormatStudioError('format_slug_taken');
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error.message).toBe('This format address is already in use.');
    expect(error.code).toBe('format_slug_taken');
    expect(error.statusCode).toBe(409);
    expect(error.params).toBeUndefined();
  });

  it('fills the placeholders and picks the plural form', () => {
    expect(new FormatStudioError('format_publish_invalid', { count: 1 }).message).toBe(
      'This format has 1 error and cannot be published. Fix it first.',
    );
    expect(new FormatStudioError('format_publish_invalid', { count: 3 }).message).toBe(
      'This format has 3 errors and cannot be published. Fix them first.',
    );
    expect(new FormatStudioError('format_attach_invalid', { first: 'stage_cycle' }).message).toBe(
      'This version has errors and cannot be attached (stage_cycle).',
    );
    expect(new FormatStudioError('format_attached', { count: 2 }).message).toBe(
      'This format is attached to 2 leagues and cannot be deleted.',
    );
  });

  it('adds extra machine data next to the placeholders', () => {
    const error = new FormatStudioError('format_stale_revision', undefined, { draft_rev: 8 });
    expect(error.params).toEqual({ draft_rev: 8 });
    const withBoth = new FormatStudioError('format_publish_invalid', { count: 2 }, { first: 'x' });
    expect(withBoth.params).toEqual({ count: 2, first: 'x' });
  });

  it('reads season-side codes from the seasons catalog', () => {
    expect(new FormatStudioError('format_not_attached').message).toContain('none is attached yet');
    expect(new FormatStudioError('season_format_type_locked').statusCode).toBe(409);
  });
});

describe('mapFormatDbError', () => {
  const p0001 = (message: string, details?: unknown) => ({ code: 'P0001', message, details, hint: null });

  it.each([
    ['FORMAT_NOT_FOUND', 'format_not_found', 404],
    ['FORMAT_NOTHING_TO_PUBLISH', 'format_nothing_to_publish', 409],
    ['FORMAT_VERSION_IMMUTABLE', 'format_version_immutable', 409],
    ['FORMAT_SEASON_NOT_CUSTOM', 'format_season_not_custom', 409],
    ['FORMAT_SEASON_STARTED', 'format_season_started', 409],
    ['FORMAT_NOT_ATTACHED', 'format_not_attached', 409],
    ['FORMAT_NOTHING_ATTACHED', 'format_nothing_attached', 404],
  ])('maps the function signal %s', (message, code, status) => {
    const mapped = mapFormatDbError(p0001(message));
    expect(mapped).toBeInstanceOf(FormatStudioError);
    expect(mapped).toMatchObject({ code, statusCode: status });
  });

  it('maps a stale revision with the current revision as a parameter', () => {
    const mapped = mapFormatDbError(p0001('FORMAT_STALE_REVISION', '{"draft_rev":12}'));
    expect(mapped).toMatchObject({ code: 'format_stale_revision', statusCode: 409, params: { draft_rev: 12 } });
  });

  it('survives a missing or malformed detail', () => {
    expect(mapFormatDbError(p0001('FORMAT_STALE_REVISION'))).toMatchObject({ params: { draft_rev: 0 } });
    expect(mapFormatDbError(p0001('FORMAT_STALE_REVISION', 'not json'))).toMatchObject({ params: { draft_rev: 0 } });
    expect(mapFormatDbError(p0001('FORMAT_STALE_REVISION', '[1]'))).toMatchObject({ params: { draft_rev: 0 } });
    expect(mapFormatDbError(p0001('FORMAT_STALE_REVISION', '{"draft_rev":"7"}'))).toMatchObject({ params: { draft_rev: 0 } });
  });

  it('maps a missing league to the existing season_not_found as a plain UserFacingError', () => {
    const mapped = mapFormatDbError(p0001('FORMAT_SEASON_NOT_FOUND'));
    expect(mapped).toBeInstanceOf(UserFacingError);
    expect(mapped).not.toBeInstanceOf(FormatStudioError);
    expect(mapped).toMatchObject({ code: 'season_not_found', statusCode: 404, message: 'Season not found' });
  });

  it('maps manual phases with their count', () => {
    const mapped = mapFormatDbError(p0001('FORMAT_SEASON_HAS_MANUAL_PHASES', '{"count":2}'));
    expect(mapped).toMatchObject({ code: 'format_attach_manual_phases', statusCode: 409, params: { count: 2 } });
    expect((mapped as Error).message).toBe('This league already has 2 phases that were not created from a format. Delete them first.');
  });

  it('maps a taken slug by SQLSTATE and constraint name', () => {
    const mapped = mapFormatDbError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "format_definitions_slug_key"',
    });
    expect(mapped).toMatchObject({ code: 'format_slug_taken', statusCode: 409 });
  });

  it.each(['format_definitions_draft_size', 'format_definition_versions_spec_size', 'season_formats_spec_size'])(
    'maps the size check %s to format_document_too_large_to_store',
    (constraint) => {
      const mapped = mapFormatDbError({
        code: '23514',
        message: `new row for relation "x" violates check constraint "${constraint}"`,
      });
      expect(mapped).toMatchObject({ code: 'format_document_too_large_to_store', statusCode: 413 });
    },
  );

  it('maps a definition deleted during an attach, and a team that blocks a detach', () => {
    expect(
      mapFormatDbError({
        code: '23503',
        message: 'insert or update on table "season_formats" violates foreign key constraint "season_formats_definition_id_fkey"',
      }),
    ).toMatchObject({ code: 'format_not_found', statusCode: 404 });
    expect(
      mapFormatDbError({
        code: '23503',
        message: 'update or delete on table "tournaments" violates foreign key constraint "teams_tournament_id_fkey" on table "teams"',
      }),
    ).toMatchObject({ code: 'format_detach_blocked', statusCode: 409 });
  });

  it('does not map a constraint under the wrong SQLSTATE or an unrelated constraint', () => {
    const wrongState = { code: '23503', message: 'violates foreign key constraint "format_definitions_slug_key"' };
    const unrelated = { code: '23505', message: 'duplicate key value violates unique constraint "players_discord_id_key"' };
    expect(mapFormatDbError(wrongState)).toBe(wrongState);
    expect(mapFormatDbError(unrelated)).toBe(unrelated);
  });

  it('returns every other input unchanged (the same object)', () => {
    const unknownSignal = p0001('SOMETHING_ELSE');
    const timeout = { code: '57014', message: 'canceling statement due to statement timeout' };
    const plain = new Error('boom');
    expect(mapFormatDbError(unknownSignal)).toBe(unknownSignal);
    expect(mapFormatDbError(timeout)).toBe(timeout);
    expect(mapFormatDbError(plain)).toBe(plain);
    expect(mapFormatDbError(null)).toBeNull();
    expect(mapFormatDbError(undefined)).toBeUndefined();
    expect(mapFormatDbError('FORMAT_NOT_FOUND')).toBe('FORMAT_NOT_FOUND');
  });

  it('never matches on text a user typed: the message must be exactly a signal code', () => {
    const lookalike = p0001('x FORMAT_NOT_FOUND y');
    expect(mapFormatDbError(lookalike)).toBe(lookalike);
    const wrongCode = { code: '23000', message: 'FORMAT_NOT_FOUND' };
    expect(mapFormatDbError(wrongCode)).toBe(wrongCode);
  });
});
