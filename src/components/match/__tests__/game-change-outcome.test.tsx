/**
 * The admin game UI's reading of game edit/delete/reset responses: which failures ask for a reload, which point at the admin data
 * tools, which success fields are warnings, and how `GameChangeAlerts`
 * renders them in both languages.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import {
  gameChangeFailureHints,
  gameChangeWarnings,
  gameEditRequest,
  sendGameChange,
} from '@/lib/match/game-change-outcome';
import GameChangeAlerts from '@/components/match/GameChangeAlerts';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

describe('gameChangeFailureHints', () => {
  it.each([
    'admin_game_edit_stale',
    'admin_game_edit_in_progress',
    'admin_game_changed_concurrently',
    'admin_game_delete_recounted',
    'admin_game_match_status_conflict',
    'game_not_found',
    'admin_match_reset_partial',
    'match_state_changed',
  ])('asks for a reload after %s', (code) => {
    expect(gameChangeFailureHints({ code })).toEqual({ reload: true, dataTools: false });
  });

  it('points a game left uncounted at the admin data tools', () => {
    expect(gameChangeFailureHints({ code: 'admin_game_left_uncounted' })).toEqual({ reload: false, dataTools: true });
  });

  it('offers nothing for other failures or none', () => {
    expect(gameChangeFailureHints({ code: 'validation_failed' })).toEqual({ reload: false, dataTools: false });
    expect(gameChangeFailureHints({ error: 'boom' })).toEqual({ reload: false, dataTools: false });
    expect(gameChangeFailureHints(null)).toEqual({ reload: false, dataTools: false });
  });
});

describe('gameChangeWarnings', () => {
  it('turns evolution_recheck_failed into its catalogue warning', () => {
    expect(gameChangeWarnings({ match_status: 'in_progress', evolution_recheck_failed: true })).toEqual([
      { code: 'admin_game_evolution_recheck_failed' },
    ]);
  });

  it('has no warning without the flag, with a non-true flag or for a malformed body', () => {
    expect(gameChangeWarnings({ match_status: 'in_progress' })).toEqual([]);
    expect(gameChangeWarnings({ evolution_recheck_failed: 'yes' })).toEqual([]);
    expect(gameChangeWarnings(null)).toEqual([]);
    expect(gameChangeWarnings([])).toEqual([]);
  });
});

describe('GameChangeAlerts', () => {
  it('renders nothing without an error or a warning', () => {
    expect(renderWithI18n(<GameChangeAlerts isSiteAdmin />)).toBe('');
  });

  it('shows the stale-edit refusal with a reload action (en)', () => {
    const html = renderWithI18n(
      <GameChangeAlerts
        error={{
          code: 'admin_game_edit_stale',
          error:
            'This game changed after you opened the editor (another admin edited it, or its statistics were counted). Nothing was saved; reload the page and make your change again.',
        }}
        isSiteAdmin
      />,
    );
    expect(html).toContain('This game changed after you opened the editor');
    expect(html).toContain('Reload page');
    expect(html).not.toContain('/admin/data');
  });

  it('translates the refusal and the reload action (de)', () => {
    const html = renderWithI18n(
      <GameChangeAlerts error={{ code: 'admin_game_changed_concurrently', error: 'This game was changed by another admin.' }} isSiteAdmin />,
      { locale: 'de' },
    );
    expect(html).toContain('Diese Partie wurde im selben Moment von einem anderen Admin geändert.');
    expect(html).toContain('Seite neu laden');
  });

  it('links the admin data tools for a game left uncounted', () => {
    const html = renderWithI18n(<GameChangeAlerts error={{ code: 'admin_game_left_uncounted' }} isSiteAdmin />, { locale: 'de' });
    expect(html).toContain('Baue die Aggregate ihres Turniers');
    expect(html).toContain('href="/admin/data"');
    expect(html).toContain('Admin-Datenwerkzeuge öffnen');
    expect(html).not.toContain('Seite neu laden');
  });

  it('shows a saved change warning with the data tools link', () => {
    const html = renderWithI18n(<GameChangeAlerts warnings={[{ code: 'admin_game_evolution_recheck_failed' }]} isSiteAdmin />);
    expect(html).toContain('re-checking the evolution progress failed');
    expect(html).toContain('href="/admin/data"');
    expect(html).toContain('Open admin data tools');
  });
});

// ─── The request/response path of the edit forms and AdminMatchActions ─────

const STAT = {
  player_id: 'p1', pokemon_name: 'Charizard', kos_dealt: 2, was_koed: false,
  was_lead: true, was_brought: true, moves_used: ['Flamethrower'], turns_active: 5,
};

/** A fetch that answers with `status` and the JSON `body`, recording the request. */
function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('gameEditRequest', () => {
  it('PATCHes the game with the winner, the stats and the version the editor loaded', () => {
    const { url, init } = gameEditRequest('g1', {
      winnerId: 'p1', battleStats: [STAT], expectedUpdatedAt: '2026-10-19T08:00:00.123456+00:00',
    });
    expect(url).toBe('/api/admin/games/g1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({
      winner_id: 'p1', battle_stats: [STAT], expected_updated_at: '2026-10-19T08:00:00.123456+00:00',
    });
  });

  it('omits expected_updated_at when the editor has no version (the server checks the one it reads first)', () => {
    const { init } = gameEditRequest('g1', { winnerId: 'p1', battleStats: [] });
    expect(JSON.parse(String(init.body))).toEqual({ winner_id: 'p1', battle_stats: [] });
  });
});

describe('sendGameChange', () => {
  it('a stale editor (409 admin_game_edit_stale): refused, with the reload action', async () => {
    const fetchImpl = fakeFetch(409, {
      success: false,
      error: 'This game changed after you opened the editor.',
      code: 'admin_game_edit_stale',
    });
    const { url, init } = gameEditRequest('g1', { winnerId: 'p1', battleStats: [STAT], expectedUpdatedAt: 'v1' });
    const result = await sendGameChange(url, init, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith('/api/admin/games/g1', init);
    expect(result).toEqual({
      ok: false,
      error: { code: 'admin_game_edit_stale', error: 'This game changed after you opened the editor.' },
    });
    if (!result.ok) {
      expect(gameChangeFailureHints(result.error)).toEqual({ reload: true, dataTools: false });
      const html = renderWithI18n(<GameChangeAlerts error={result.error} isSiteAdmin={false} />, { locale: 'de' });
      expect(html).toContain('Diese Partie hat sich geändert, nachdem du den Editor geöffnet hast');
      expect(html).toContain('Seite neu laden');
    }
  });

  it('an edit running on the game (409 admin_game_edit_in_progress): refused, with the reload action, in both languages', async () => {
    const result = await sendGameChange(
      '/api/admin/games/g1',
      { method: 'PATCH' },
      fakeFetch(409, { success: false, error: 'Another edit of this game is being saved right now.', code: 'admin_game_edit_in_progress' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(gameChangeFailureHints(result.error).reload).toBe(true);
      expect(renderWithI18n(<GameChangeAlerts error={result.error} isSiteAdmin />)).toContain('Another edit of this game is being saved right now.');
      expect(renderWithI18n(<GameChangeAlerts error={{ code: result.error.code }} isSiteAdmin />, { locale: 'de' })).toContain(
        'Gerade wird eine andere Bearbeitung dieser Partie gespeichert.',
      );
    }
  });

  it('a saved edit with a warning: ok, the data and the warning (the form stays to show it)', async () => {
    const result = await sendGameChange(
      '/api/admin/games/g1',
      { method: 'PATCH' },
      fakeFetch(200, { success: true, data: { match_status: 'in_progress', evolution_recheck_failed: true } }),
    );
    expect(result).toEqual({
      ok: true,
      data: { match_status: 'in_progress', evolution_recheck_failed: true },
      warnings: [{ code: 'admin_game_evolution_recheck_failed' }],
    });
  });

  it('a saved change without warnings', async () => {
    const result = await sendGameChange('/api/admin/games/g1', { method: 'DELETE' }, fakeFetch(200, { success: true, data: { games_remaining: 1 } }));
    expect(result).toEqual({ ok: true, data: { games_remaining: 1 }, warnings: [] });
  });

  it('a match reset that needs a cascade keeps its code for the cascade dialog', async () => {
    const result = await sendGameChange(
      '/api/admin/matches/m1/reset',
      { method: 'POST' },
      fakeFetch(409, { success: false, error: '2 downstream matches have results.', code: 'DOWNSTREAM_PLAYED', params: { count: 2 } }),
    );
    expect(result).toEqual({
      ok: false,
      error: { code: 'DOWNSTREAM_PLAYED', error: '2 downstream matches have results.', params: { count: 2 } },
    });
  });

  it('a partial match reset (409 admin_match_reset_partial): refused, with the reload action', async () => {
    const result = await sendGameChange(
      '/api/admin/matches/m1/reset',
      { method: 'POST' },
      fakeFetch(409, { success: false, error: 'The reset stopped.', code: 'admin_match_reset_partial', params: { count: 1 } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(gameChangeFailureHints(result.error).reload).toBe(true);
  });

  it('a body that is not JSON rejects (the caller shows its local failure)', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>502</html>', { status: 502 })) as unknown as typeof fetch;
    await expect(sendGameChange('/api/admin/games/g1', { method: 'DELETE' }, fetchImpl)).rejects.toThrow();
  });
});
