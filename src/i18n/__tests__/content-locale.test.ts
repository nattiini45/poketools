import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSeasonLanguage, getTournamentSeasonLanguage, getMatchSeasonLanguage, warn } = vi.hoisted(() => ({
  getSeasonLanguage: vi.fn(),
  getTournamentSeasonLanguage: vi.fn(),
  getMatchSeasonLanguage: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/content-locale', () => ({
  getSeasonLanguage,
  getTournamentSeasonLanguage,
  getMatchSeasonLanguage,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn, error: vi.fn() },
}));

// React cache() only memoizes inside a React server request; outside one each call re-runs.
import { resolveContentLocale } from '../content-locale';
import { DEFAULT_CONTENT_LOCALE } from '../config';

beforeEach(() => {
  vi.clearAllMocks();
  getSeasonLanguage.mockResolvedValue(null);
  getTournamentSeasonLanguage.mockResolvedValue(null);
  getMatchSeasonLanguage.mockResolvedValue(null);
});

describe('resolveContentLocale', () => {
  it('the default content locale is German', () => {
    expect(DEFAULT_CONTENT_LOCALE).toBe('de');
  });

  it('uses the season language first and reads nothing else', async () => {
    getSeasonLanguage.mockResolvedValueOnce('en');
    await expect(resolveContentLocale({ seasonId: 's1', tournamentId: 't1', matchId: 'm1' })).resolves.toBe('en');
    expect(getSeasonLanguage).toHaveBeenCalledWith('s1');
    expect(getTournamentSeasonLanguage).not.toHaveBeenCalled();
    expect(getMatchSeasonLanguage).not.toHaveBeenCalled();
  });

  it('falls through season -> tournament', async () => {
    getTournamentSeasonLanguage.mockResolvedValueOnce('en');
    await expect(resolveContentLocale({ seasonId: 's-missing', tournamentId: 't1', matchId: 'm1' })).resolves.toBe('en');
    expect(getSeasonLanguage).toHaveBeenCalledWith('s-missing');
    expect(getTournamentSeasonLanguage).toHaveBeenCalledWith('t1');
    expect(getMatchSeasonLanguage).not.toHaveBeenCalled();
  });

  it('falls through season -> tournament -> match', async () => {
    getMatchSeasonLanguage.mockResolvedValueOnce('en');
    await expect(resolveContentLocale({ seasonId: 's1', tournamentId: 't1', matchId: 'm1' })).resolves.toBe('en');
    expect(getSeasonLanguage).toHaveBeenCalledTimes(1);
    expect(getTournamentSeasonLanguage).toHaveBeenCalledTimes(1);
    expect(getMatchSeasonLanguage).toHaveBeenCalledWith('m1');
  });

  it('match only', async () => {
    getMatchSeasonLanguage.mockResolvedValueOnce('de');
    await expect(resolveContentLocale({ matchId: 'm1' })).resolves.toBe('de');
    expect(getSeasonLanguage).not.toHaveBeenCalled();
    expect(getTournamentSeasonLanguage).not.toHaveBeenCalled();
  });

  it('every read null (standalone tournament, invalid stored value) -> de', async () => {
    await expect(resolveContentLocale({ seasonId: 's1', tournamentId: 't1', matchId: 'm1' })).resolves.toBe('de');
  });

  it('no ids -> de without any read', async () => {
    await expect(resolveContentLocale({})).resolves.toBe('de');
    await expect(resolveContentLocale({ seasonId: null, tournamentId: null, matchId: null })).resolves.toBe('de');
    expect(getSeasonLanguage).not.toHaveBeenCalled();
    expect(getTournamentSeasonLanguage).not.toHaveBeenCalled();
    expect(getMatchSeasonLanguage).not.toHaveBeenCalled();
  });

  it('empty-string ids (draft payloads send tournament_id: "") count as absent', async () => {
    getSeasonLanguage.mockResolvedValueOnce('en');
    await expect(resolveContentLocale({ seasonId: 's1', tournamentId: '' })).resolves.toBe('en');
    await expect(resolveContentLocale({ seasonId: '', tournamentId: '' })).resolves.toBe('de');
    expect(getTournamentSeasonLanguage).not.toHaveBeenCalled();
  });

  it('a failed read logs a warning and falls back to de', async () => {
    getSeasonLanguage.mockRejectedValueOnce(new Error('db down'));
    await expect(resolveContentLocale({ seasonId: 's1', tournamentId: 't1' })).resolves.toBe('de');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(getTournamentSeasonLanguage).not.toHaveBeenCalled();
  });
});
