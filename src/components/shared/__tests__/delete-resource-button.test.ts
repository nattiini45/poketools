/**
 * `deleteRebuildWarning` reads the `data.rebuild_warning` of a successful
 * season/tournament DELETE so `DeleteResourceButton` tells the admin that the
 * delete committed but the derived-data rebuild after it did not, and the
 * catalogue renders it in both languages. `requestResourceDelete` is the
 * button's request and response handling, driven here with a mocked fetch.
 */
import { describe, expect, it, vi } from 'vitest';
import { apiErrorText } from '@/i18n/api-errors';
import { createTranslator } from '@/i18n/core';
import { errorsAdmin, errorsSeasons, errorsTournaments } from '@/i18n/messages/errors';
import { uiMessages } from '@/i18n/messages/ui';
import { LEAGUE_TRASH_RETENTION_DAYS } from '@/lib/league-trash/constants';
import { deleteRebuildWarning, requestResourceDelete } from '../DeleteResourceButton';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const catalogs = [errorsSeasons, errorsTournaments, errorsAdmin];

describe('deleteRebuildWarning', () => {
  it('is null when the rebuild succeeded', () => {
    expect(deleteRebuildWarning({ success: true, data: { rebuild_warning: null } })).toBeNull();
  });

  it('is null for a body without data or with a malformed warning', () => {
    expect(deleteRebuildWarning(null)).toBeNull();
    expect(deleteRebuildWarning({ success: true })).toBeNull();
    expect(deleteRebuildWarning({ success: true, data: { rebuild_warning: { error: 'no code' } } })).toBeNull();
  });

  it('keeps the code, the English text and the params of a rating refusal', () => {
    const warning = deleteRebuildWarning({
      success: true,
      data: {
        rebuild_warning: {
          code: 'rating_history_incomplete',
          error: 'Rating history has gaps that no rebuild order can fill for 2 completed matches (players: Ash, Gary).',
          params: { count: 2, players: 'Ash, Gary', bogus: { nested: true } },
        },
      },
    });
    expect(warning).toEqual({
      code: 'rating_history_incomplete',
      error: 'Rating history has gaps that no rebuild order can fill for 2 completed matches (players: Ash, Gary).',
      params: { count: 2, players: 'Ash, Gary' },
    });
    expect(apiErrorText(warning, { locale: 'de', catalogs })).toContain('Ash, Gary');
  });

  it('renders the generic rebuild failure from the catalogue in German', () => {
    const warning = deleteRebuildWarning({
      success: true,
      data: { rebuild_warning: { code: 'derived_data_rebuild_failed', error: 'The delete succeeded, but rebuilding failed.' } },
    });
    const text = apiErrorText(warning, { locale: 'de', catalogs });
    expect(text).not.toContain('The delete succeeded');
    expect(text.length).toBeGreaterThan(0);
  });

  it('renders the league trash refusals of the season DELETE in both languages', () => {
    const busy = { code: 'LEAGUE_TRASH_BUSY', error: 'Another change to this league is running. Try again in a moment.' };
    expect(apiErrorText(busy, { locale: 'en', catalogs })).toContain('Try again in a moment');
    expect(apiErrorText(busy, { locale: 'de', catalogs })).toContain('Versuche es gleich noch einmal');
    const timeout = { code: 'LEAGUE_TRASH_TIMEOUT' };
    expect(apiErrorText(timeout, { locale: 'en', catalogs })).toContain('result is unknown');
    expect(apiErrorText(timeout, { locale: 'de', catalogs }).length).toBeGreaterThan(0);
  });
});

/** A fetch that answers one DELETE with `status` and `body` (a string is sent raw). */
function fakeFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    expect(init?.method).toBe('DELETE');
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

describe('requestResourceDelete', () => {
  it('a 409 refusal: nothing deleted, the catalogued error for the alert', async () => {
    const fetchImpl = fakeFetch(409, {
      success: false,
      error: 'Another change to this league is running. Try again in a moment.',
      code: 'LEAGUE_TRASH_BUSY',
    });
    const outcome = await requestResourceDelete('/api/seasons/s1', fetchImpl);
    expect(outcome).toEqual({
      kind: 'refused',
      error: {
        code: 'LEAGUE_TRASH_BUSY',
        error: 'Another change to this league is running. Try again in a moment.',
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith('/api/seasons/s1', { method: 'DELETE' });
    if (outcome.kind === 'refused' && outcome.error) {
      expect(apiErrorText(outcome.error, { locale: 'de', catalogs })).toContain('Versuche es gleich noch einmal');
    }
  });

  it('a league moved to the trash is a delete; the answer carries the trash entry next to the rebuild warning', async () => {
    const outcome = await requestResourceDelete(
      '/api/seasons/s1',
      fakeFetch(200, { success: true, data: { rebuild_warning: null, trash: { id: 't1', purge_after: '2027-01-24T00:00:00Z' } } }),
    );
    expect(outcome).toEqual({ kind: 'deleted', warning: null });
  });

  it('a failure without a readable body: refused with no error (the generic message), the body logged', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const outcome = await requestResourceDelete('/api/tournaments/t1', fakeFetch(502, '<html>Bad gateway</html>'));
    expect(outcome).toEqual({ kind: 'refused', error: null });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('answered 502 with a body that is not JSON'), expect.anything());
    logged.mockRestore();
  });

  it('deleted with a rebuild warning: the warning for the alert, per-step code rendered in both languages', async () => {
    const outcome = await requestResourceDelete(
      '/api/tournaments/t1',
      fakeFetch(200, {
        success: true,
        data: { rebuild_warning: { code: 'delete_rebuild_ratings_failed', error: 'The delete succeeded, but rebuilding the ratings afterwards failed.' } },
      }),
    );
    expect(outcome).toEqual({
      kind: 'deleted',
      warning: { code: 'delete_rebuild_ratings_failed', error: 'The delete succeeded, but rebuilding the ratings afterwards failed.' },
    });
    if (outcome.kind === 'deleted' && outcome.warning) {
      // English keeps the server's text; German comes from the catalogue by code.
      expect(apiErrorText(outcome.warning, { locale: 'en', catalogs })).toContain('rebuilding the ratings afterwards failed');
      expect(apiErrorText(outcome.warning, { locale: 'de', catalogs })).toContain('ein Site-Admin kann sie');
    }
  });

  it('deleted without a warning', async () => {
    const outcome = await requestResourceDelete('/api/seasons/s1', fakeFetch(200, { success: true, data: { rebuild_warning: null } }));
    expect(outcome).toEqual({ kind: 'deleted', warning: null });
  });

  it('a network failure rejects (the button shows its failed message)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(requestResourceDelete('/api/seasons/s1', fetchImpl)).rejects.toThrow('Failed to fetch');
  });
});

describe('per-step rebuild warning codes', () => {
  it.each([
    'delete_rebuild_aggregates_failed',
    'delete_rebuild_ratings_failed',
    'delete_rebuild_streaks_failed',
    'delete_rebuild_evolution_failed',
    'derived_data_rebuild_failed',
  ])('%s is catalogued in both languages and names a site admin', (code) => {
    expect(apiErrorText({ code }, { locale: 'en', catalogs })).toContain('a site admin');
    expect(apiErrorText({ code }, { locale: 'de', catalogs })).toContain('ein Site-Admin');
  });
});

describe('the delete confirm copy', () => {
  const t = (locale: 'en' | 'de') => createTranslator(uiMessages, locale);

  it('a league confirm says it moves to the trash and for how long it can be restored', () => {
    const text = t('en')('deleteResource.confirm.season', { name: 'Summer League', days: LEAGUE_TRASH_RETENTION_DAYS });
    expect(text).toBe('Delete league "Summer League"? It moves to the trash; the superadmin can restore it for 90 days.');
    expect(text).not.toContain('cannot be undone');
    expect(t('de')('deleteResource.confirm.season', { name: 'Sommerliga', days: LEAGUE_TRASH_RETENTION_DAYS })).toBe(
      'Liga „Sommerliga“ löschen? Sie kommt in den Papierkorb; der Superadmin kann sie 90 Tage lang wiederherstellen.',
    );
  });

  it('a tournament confirm still says the delete is final', () => {
    expect(t('en')('deleteResource.confirm.tournament', { name: 'Cup' })).toContain('This cannot be undone.');
    expect(t('de')('deleteResource.confirm.tournament', { name: 'Cup' })).toContain('nicht rückgängig');
  });

  it('a league deleted with a rebuild warning says it is in the trash', () => {
    expect(t('en')('deleteResource.deletedWithWarning.season', { name: 'Summer League', warning: 'W' })).toBe(
      'League "Summer League" was moved to the trash. W',
    );
    expect(t('de')('deleteResource.deletedWithWarning.season', { name: 'Sommerliga', warning: 'W' })).toContain('Papierkorb');
  });
});
