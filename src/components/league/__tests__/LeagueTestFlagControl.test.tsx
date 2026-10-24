/**
 * The site-admin test-league checkbox: its label and state as rendered
 * (react-dom/server, vitest 'node' env), the request it sends, and what a
 * save ends in (the route refresh after every save, the unconfirmed message).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import leagueAdminEn from '@/i18n/messages/league-admin/en';
import leagueAdminDe from '@/i18n/messages/league-admin/de';
import seasonPageEn from '@/i18n/messages/league-admin/season-page/en';
import seasonPageDe from '@/i18n/messages/league-admin/season-page/de';
import LeagueTestFlagControl, {
  TEST_LEAGUE_LABEL,
  TestFlagSaveError,
  runTestFlagSave,
  saveTestFlag,
} from '../LeagueTestFlagControl';

// Test leagues stay out of ratings: the copy says so, in both languages.
const RATINGS_EXCLUSION_CLAIM =
  /(out of|excluded from|kept out of)( the)? ratings|do not count toward player ratings|(nicht|ohne) (in )?(den )?(Wertungen|Ratings)|zählen nicht für die Spieler-Ratings/i;
// The superseded copy that said their games still move ratings.
const RATINGS_STILL_COUNT_CLAIM = /still count toward( player)? ratings|zählen weiter für die( Spieler-)?Ratings|ratings still count/i;

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe('LeagueTestFlagControl', () => {
  it('renders the labelled checkbox reflecting the current flag', () => {
    const on = renderToStaticMarkup(<LeagueTestFlagControl seasonId="s1" isTestSeason />);
    const off = renderToStaticMarkup(<LeagueTestFlagControl seasonId="s1" isTestSeason={false} />);

    expect(TEST_LEAGUE_LABEL).toBe('Test league — listed with a test badge, excluded from ratings and all-time stats');
    expect(on).toContain(TEST_LEAGUE_LABEL);
    expect(on).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
    expect(off).not.toMatch(/<input[^>]*checked=""/);
  });

  it('renders the label and hint in German', () => {
    const html = renderWithI18n(<LeagueTestFlagControl seasonId="s1" isTestSeason />, { locale: 'de' });

    expect(html).toContain('Testliga – mit Testliga-Badge gelistet, nicht in Ratings und Gesamtstatistiken');
    expect(html).toContain('Die Liga bleibt gelistet (nach den echten Ligen, mit Badge)');
    expect(html).not.toContain(TEST_LEAGUE_LABEL);
  });

  // The rating path skips test-league matches (rating-scope.ts, mirrored in
  // SQL by match_in_test_season); the label, hint and subtitle say so.
  it('says test-league games are kept out of ratings and all-time stats', () => {
    for (const text of [
      leagueAdminEn.testFlag.label,
      leagueAdminDe.testFlag.label,
      seasonPageEn.testLeague.subtitle,
      seasonPageDe.testLeague.subtitle,
    ]) {
      expect(text).toMatch(RATINGS_EXCLUSION_CLAIM);
      expect(text).toMatch(/all-time stats|Gesamtstatistiken/);
    }
    expect(leagueAdminEn.testFlag.hint).toContain('do not count toward player ratings');
    expect(leagueAdminDe.testFlag.hint).toContain('zählen nicht für die Spieler-Ratings');
    for (const text of [
      leagueAdminEn.testFlag.label,
      leagueAdminEn.testFlag.hint,
      leagueAdminDe.testFlag.label,
      leagueAdminDe.testFlag.hint,
      seasonPageEn.testLeague.subtitle,
      seasonPageDe.testLeague.subtitle,
    ]) {
      expect(text).not.toMatch(RATINGS_STILL_COUNT_CLAIM);
    }
  });

  it('keeps the docs, changelog and code comments free of the superseded "ratings still count" claim', () => {
    for (const file of [
      'docs/season.md',
      'docs/admin.md',
      'CHANGELOG.md',
      'src/components/league/LeagueTestFlagControl.tsx',
      'src/lib/cache/public-reads.ts',
      'src/lib/supabase/queries/seasons.ts',
    ]) {
      let source = readFileSync(join(process.cwd(), file), 'utf8');
      // A released changelog section records what that release did: 0.2.0 still counted test-league games.
      if (file === 'CHANGELOG.md') source = source.slice(0, source.indexOf('## [0.2.0]'));
      // Join wrapped comment/prose lines so a claim split across lines still matches.
      const text = source.replace(/\s*\r?\n\s*(?:\*|\/\/)?\s*/g, ' ');
      expect(text, file).not.toMatch(RATINGS_STILL_COUNT_CLAIM);
    }
  });

  it('documents the exclusion in the season and admin docs and the changelog', () => {
    for (const file of ['docs/season.md', 'docs/admin.md', 'CHANGELOG.md']) {
      const text = readFileSync(join(process.cwd(), file), 'utf8').replace(/\s*\r?\n\s*/g, ' ');
      expect(text, file).toMatch(/excluded from ratings and all-time stats|stay out of player ratings and all-time statistics/);
    }
  });
});

describe('saveTestFlag', () => {
  it('PATCHes only is_test_season to the league and resolves to no warning after a clean rebuild', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ success: true, data: { rating_rebuild: { passes: 2, settled: true }, rebuild_warning: null } }),
    });

    await expect(saveTestFlag('s1', true, fetchImpl)).resolves.toBeNull();

    expect(fetchImpl).toHaveBeenCalledWith('/api/seasons/s1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_test_season: true }),
    });
  });

  it('resolves to the rebuild warning when the flag was saved but the rating rebuild failed', async () => {
    const warning = {
      code: 'rating_history_incomplete',
      error: 'Rating history has gaps',
      params: { count: 1, players: 'Ash, Misty' },
    };
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ success: true, data: { is_test_season: true, rating_rebuild: null, rebuild_warning: warning } }),
    });

    await expect(saveTestFlag('s1', true, fetchImpl)).resolves.toEqual(warning);
  });

  it("throws the route's own message (e.g. the site-admin 403)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ success: false, error: 'Only site admins can change the test-league flag' }),
    });

    await expect(saveTestFlag('s1', false, fetchImpl)).rejects.toThrow(
      'Only site admins can change the test-league flag',
    );
  });

  it('keeps the code and params of the failure for the localized inline error', async () => {
    const body = { success: false, error: 'Not authenticated', code: 'unauthenticated' };
    const fetchImpl = vi.fn().mockResolvedValue({ json: async () => body });

    const err = await saveTestFlag('s1', true, fetchImpl).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TestFlagSaveError);
    expect((err as TestFlagSaveError).result).toMatchObject({ error: 'Not authenticated', code: 'unauthenticated' });
  });
});

describe('runTestFlagSave', () => {
  it('refreshes the route after a successful save and passes the rebuild warning on', async () => {
    const refresh = vi.fn();
    const warning = { code: 'test_flag_rating_rebuild_failed', error: 'rebuild failed' };
    const save = vi.fn().mockResolvedValue(warning);

    await expect(runTestFlagSave('s1', true, refresh, save)).resolves.toEqual({ status: 'saved', warning });

    expect(save).toHaveBeenCalledWith('s1', true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes the route after the route's own error, which stays the inline error", async () => {
    const refresh = vi.fn();
    const result = { success: false, error: 'Only site admins can change the test-league flag', code: 'season_test_flag_site_admin_only' };
    const save = vi.fn().mockRejectedValue(new TestFlagSaveError(result));

    await expect(runTestFlagSave('s1', true, refresh, save)).resolves.toEqual({ status: 'failed', error: result });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reports a save without an answer from the route as unconfirmed and still refreshes (the flag may be saved)', async () => {
    for (const failure of [new TypeError('Failed to fetch'), new SyntaxError('Unexpected token < in JSON')]) {
      const refresh = vi.fn();
      const save = vi.fn().mockRejectedValue(failure);

      await expect(runTestFlagSave('s1', false, refresh, save)).resolves.toEqual({ status: 'unconfirmed' });
      expect(refresh).toHaveBeenCalledTimes(1);
    }
  });

  it('says in both languages that the save is unconfirmed, the checkbox shows the stored setting, and how to repair', () => {
    expect(leagueAdminEn.testFlag.saveUnconfirmed).toMatch(/No answer arrived/);
    expect(leagueAdminEn.testFlag.saveUnconfirmed).toMatch(/unconfirmed/);
    expect(leagueAdminEn.testFlag.saveUnconfirmed).toMatch(/stored setting/);
    expect(leagueAdminEn.testFlag.saveUnconfirmed).toMatch(/Record Reconciliation/);
    expect(leagueAdminDe.testFlag.saveUnconfirmed).toMatch(/keine Antwort/);
    expect(leagueAdminDe.testFlag.saveUnconfirmed).toMatch(/gespeicherte Einstellung/);
    expect(leagueAdminDe.testFlag.saveUnconfirmed).toMatch(/Datenabgleich/);
    // One repair run is a single rebuild pass, so the text says to repeat it.
    expect(leagueAdminEn.testFlag.saveUnconfirmed).toContain(
      'repeating the repair until its dry run lists no rating mismatch',
    );
    expect(leagueAdminDe.testFlag.saveUnconfirmed).toContain(
      'die Reparatur wiederholen, bis ihr Probelauf keine Rating-Abweichung mehr auflistet',
    );
    // The checkbox never re-sends the stored value, so the text does not offer that.
    expect(leagueAdminEn.testFlag.saveUnconfirmed).not.toContain('set the flag again');
    expect(leagueAdminDe.testFlag.saveUnconfirmed).not.toContain('noch einmal');
  });
});
