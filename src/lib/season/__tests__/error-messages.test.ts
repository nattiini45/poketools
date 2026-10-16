/**
 * The `errors/seasons` catalog renders the season errors in German from the
 * code and params the server sends (i18n-core §4.2), while English keeps the
 * server's own text.
 */
import { describe, expect, it } from 'vitest';
import { apiErrorText } from '@/i18n/api-errors';
import { errorsSeasons } from '@/i18n/messages/errors';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { assignCoresFromPool, CoreTypesConflictError } from '../core-assignment';

const de = { locale: 'de' as const, catalogs: [errorsSeasons] };
const en = { locale: 'en' as const, catalogs: [errorsSeasons] };

/** The body a route answers with for `err` (safeErrorResponse passthrough). */
async function bodyOf(err: unknown) {
  const original = console.error;
  console.error = () => {};
  try {
    return (await safeErrorResponse(err, 'Fallback').json()) as {
      error: string;
      code?: string;
      params?: Record<string, string | number>;
    };
  } finally {
    console.error = original;
  }
}

describe('errors/seasons rendering', () => {
  it('names the phase in German when an incoming player is already enrolled', async () => {
    const res = await bodyOf(
      new UserFacingError('Incoming player is already enrolled in Playoffs', {
        code: 'IN_ALREADY_IN_PHASE',
        params: { phase: 'Playoffs' },
      }),
    );

    expect(apiErrorText(res, de)).toBe('Der Ersatzspieler ist bereits in der Phase „Playoffs“ eingetragen.');
    expect(apiErrorText(res, en)).toBe('Incoming player is already enrolled in Playoffs');
  });

  it('words the pool-too-small counts in German', async () => {
    let caught: unknown;
    try {
      assignCoresFromPool(
        [
          { playerId: 'a', coreTypes: null },
          { playerId: 'b', coreTypes: null },
        ],
        [['Fire', 'Water', 'Grass']],
        { seed: 0 },
      );
    } catch (err) {
      caught = err;
    }
    const res = await bodyOf(caught);

    expect(res.code).toBe('core_assignment_error');
    expect(apiErrorText(res, de)).toBe('Der Core-Pool ist zu klein: Frei sind 1, gebraucht werden 2.');
  });

  it('renders the core triple conflict with its types', async () => {
    const res = await bodyOf(new CoreTypesConflictError(['Fire', 'Grass', 'Water']));

    expect(apiErrorText(res, de)).toBe('Fire/Grass/Water ist bereits einem anderen Teilnehmer zugewiesen.');
  });

  it('falls back to the English text when a templated code arrives without its params', () => {
    const res = { error: 'Incoming player is already enrolled in this phase', code: 'IN_ALREADY_IN_PHASE' };

    expect(apiErrorText(res, de)).toBe('Incoming player is already enrolled in this phase');
  });

  it('translates the plain codes the routes add', () => {
    expect(apiErrorText({ error: 'League not found', code: 'SEASON_NOT_FOUND' }, de)).toBe('Liga nicht gefunden.');
    expect(
      apiErrorText({ error: 'Need at least 2 phases to advance', code: 'advance_needs_two_phases' }, de),
    ).toBe('Zum Weiterkommen braucht die Liga mindestens 2 Phasen.');
    expect(
      apiErrorText(
        { error: 'Only site admins can change the test-league flag', code: 'season_test_flag_site_admin_only' },
        de,
      ),
    ).toBe('Nur Site-Admins können die Testliga-Markierung ändern.');
  });
});
