import { describe, expect, it } from 'vitest';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsTournaments } from '@/i18n/messages/errors/tournaments';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { RULESET_ERROR_CODES, RULESET_ERROR_STATUS, RulesetStudioError, mapRulesetDbError } from '../errors';

describe('ruleset error codes', () => {
  it('every code has a status, an English and a German text in exactly one catalog, and no extra status key exists', () => {
    expect(Object.keys(RULESET_ERROR_STATUS).sort()).toEqual([...RULESET_ERROR_CODES].sort());
    for (const code of RULESET_ERROR_CODES) {
      const inAdmin = code in errorsAdmin.en;
      const inTournaments = code in errorsTournaments.en;
      expect(inAdmin !== inTournaments, code).toBe(true);
      const catalog = inAdmin ? errorsAdmin : errorsTournaments;
      expect(code in catalog.de, code).toBe(true);
      expect(RULESET_ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(RULESET_ERROR_STATUS[code]).toBeLessThan(500);
    }
  });

  it('covers every ruleset_* key the admin catalog declares', () => {
    const declared = Object.keys(errorsAdmin.en).filter((key) => key.startsWith('ruleset_'));
    expect(declared.sort()).toEqual(RULESET_ERROR_CODES.filter((code) => code.startsWith('ruleset_') && code !== 'ruleset_not_found').sort());
  });

  it('a RulesetStudioError carries the English text, the code, the params and the status', () => {
    const error = new RulesetStudioError('ruleset_in_use', { count: 3 });
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error.message).toBe('This ruleset is used by 3 leagues or phases and cannot be deleted.');
    expect(error).toMatchObject({ code: 'ruleset_in_use', statusCode: 409, params: { count: 3 } });
    expect(new RulesetStudioError('ruleset_not_found').message).toBe('Ruleset not found');
    const stale = new RulesetStudioError('ruleset_stale_revision', undefined, { draft_rev: 7 });
    expect(stale.params).toEqual({ draft_rev: 7 });
  });
});

describe('mapRulesetDbError', () => {
  const p0001 = (message: string, details?: unknown) => ({ code: 'P0001', message, details: details === undefined ? undefined : JSON.stringify(details) });

  it('maps the signals of the publish function and the immutability trigger', () => {
    expect(mapRulesetDbError(p0001('RULESET_NOT_FOUND'))).toMatchObject({ code: 'ruleset_not_found' });
    expect(mapRulesetDbError(p0001('RULESET_STALE_REVISION', { draft_rev: 4 }))).toMatchObject({ code: 'ruleset_stale_revision', params: { draft_rev: 4 } });
    expect(mapRulesetDbError(p0001('RULESET_NOTHING_TO_PUBLISH'))).toMatchObject({ code: 'ruleset_nothing_to_publish' });
    expect(mapRulesetDbError(p0001('RULESET_VERSION_IMMUTABLE'))).toMatchObject({ code: 'ruleset_version_immutable' });
    expect(mapRulesetDbError(p0001('RULESET_QUOTA_EXCEEDED', { max: 100 }))).toMatchObject({ code: 'ruleset_version_quota_exceeded', params: { max: 100 } });
  });

  it('maps the slug key, the size checks and a violated pin key', () => {
    const named = (code: string, constraint: string, kind = 'check') => ({ code, message: `violates ${kind} constraint "${constraint}"` });
    expect(mapRulesetDbError(named('23505', 'ruleset_definitions_slug_key', 'unique'))).toMatchObject({ code: 'ruleset_slug_taken' });
    expect(mapRulesetDbError(named('23514', 'ruleset_definition_versions_spec_size'))).toMatchObject({ code: 'ruleset_document_too_large_to_store' });
    expect(mapRulesetDbError(named('23503', 'tournaments_ruleset_id_fkey', 'foreign key'), 2)).toMatchObject({ code: 'ruleset_in_use', params: { count: 2 } });
    expect(mapRulesetDbError(named('23503', 'seasons_ruleset_id_fkey', 'foreign key'))).toMatchObject({ code: 'ruleset_in_use', params: { count: 1 } });
  });

  it('returns anything else unchanged, the same object (the trash junction key is the league trash lane\'s to map)', () => {
    for (const other of [
      new Error('boom'),
      { code: 'P0001', message: 'SOMETHING_ELSE' },
      { code: '23503', message: 'violates foreign key constraint "league_trash_rulesets_ruleset_id_fkey"' },
      { code: '23505', message: 'violates unique constraint "other_key"' },
      null,
      'text',
    ]) {
      expect(mapRulesetDbError(other)).toBe(other);
    }
  });
});
