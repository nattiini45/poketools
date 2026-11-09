/**
 * The admin game UI's reading of game edit/delete/reset responses: which failures ask for a reload, which point at the admin data
 * tools, which success fields are warnings, and how `GameChangeAlerts`
 * renders them in both languages.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import {
  downstreamApproval,
  downstreamResetCount,
  gameChangeFailureHints,
  gameChangeWarnings,
  gameDeleteRequest,
  gameEditRequest,
  sendGameChange,
  warningNeedsDataTools,
} from '@/lib/match/game-change-outcome';
import { encodeDownstreamMatches } from '@/lib/match/downstream-matches';
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

  it('turns format_revert_failed into its catalogue warning, next to the recheck warning', () => {
    expect(gameChangeWarnings({ format_revert_failed: true })).toEqual([{ code: 'admin_game_format_revert_failed' }]);
    expect(gameChangeWarnings({ evolution_recheck_failed: true, format_revert_failed: true })).toEqual([
      { code: 'admin_game_evolution_recheck_failed' },
      { code: 'admin_game_format_revert_failed' },
    ]);
    expect(gameChangeWarnings({ format_revert_failed: 'yes' })).toEqual([]);
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

// ─── Approval of a game change that affects the played part of the bracket ──

describe('gameChangeWarnings: the stage of an ended phase', () => {
  const notice = {
    phase_id: 'groups',
    phase_name: 'Group stage',
    advanced: [{ phase_id: 'playoffs', phase_name: 'Playoffs', players: [{ id: 'p1', name: 'Ash' }, { id: 'p2', name: 'Misty' }] }],
  };

  it('turns stage_already_ended into a warning that names the phase and who advanced', () => {
    expect(gameChangeWarnings({ match_status: 'in_progress', stage_already_ended: notice })).toEqual([
      { code: 'admin_game_stage_already_ended', params: { phase: 'Group stage', advanced: 'Playoffs: Ash, Misty' } },
    ]);
  });

  it('uses another message when nobody advanced or the advancement could not be read', () => {
    expect(gameChangeWarnings({ stage_already_ended: { ...notice, advanced: [] } })).toEqual([
      { code: 'admin_game_stage_already_ended_nobody', params: { phase: 'Group stage' } },
    ]);
    expect(gameChangeWarnings({ stage_already_ended: { ...notice, advanced: null } })).toEqual([
      { code: 'admin_game_stage_already_ended_unlisted', params: { phase: 'Group stage' } },
    ]);
  });

  it('sits next to the other warnings and ignores a malformed field', () => {
    expect(gameChangeWarnings({ format_revert_failed: true, stage_already_ended: notice }).map((w) => w.code)).toEqual([
      'admin_game_format_revert_failed',
      'admin_game_stage_already_ended',
    ]);
    expect(gameChangeWarnings({ stage_already_ended: 'yes' })).toEqual([]);
    expect(gameChangeWarnings({ stage_already_ended: { phase_id: 'groups' } })).toEqual([]);
  });

  it('renders in both languages with the player names, and offers no data tools (nothing there repairs it)', () => {
    const [warning] = gameChangeWarnings({ stage_already_ended: notice });
    const en = renderWithI18n(<GameChangeAlerts warnings={[warning]} isSiteAdmin />);
    expect(en).toContain('the stage of the phase Group stage had already ended');
    expect(en).toContain('Playoffs: Ash, Misty');
    expect(en).not.toContain('/admin/data');
    expect(en).not.toContain('Ask a site admin');

    const de = renderWithI18n(<GameChangeAlerts warnings={[warning]} isSiteAdmin={false} />, { locale: 'de' });
    expect(de).toContain('die Stufe der Phase Group stage war bereits beendet');
    expect(de).toContain('Playoffs: Ash, Misty');
    expect(de).not.toContain('Seiten-Admin');
  });

  it.each([
    ['admin_game_evolution_recheck_failed', true],
    ['admin_game_format_revert_failed', true],
    ['admin_game_stage_already_ended', false],
    ['admin_game_stage_already_ended_nobody', false],
    ['admin_game_stage_already_ended_unlisted', false],
  ])('%s points at the data tools: %s', (code, expected) => {
    expect(warningNeedsDataTools({ code })).toBe(expected);
  });
});

describe('the approval request of a game change', () => {
  const LATER = [{ id: 'm9', round_name: 'Finals', player_1_name: 'Ash', player_2_name: 'Misty', status: 'completed' as const }];
  const refusal = {
    code: 'game_change_downstream_played',
    error: 'This change affects the rest of the bracket',
    params: { count: 1, matches: encodeDownstreamMatches(LATER) },
  };

  it('reads the refusal of a game change into the matches to approve', () => {
    expect(downstreamApproval(refusal)).toEqual({ count: 1, matches: LATER });
  });

  it('keeps the count when the list cannot be read, and asks nothing for any other outcome', () => {
    expect(downstreamApproval({ ...refusal, params: { count: 3 } })).toEqual({ count: 3, matches: [] });
    expect(downstreamApproval({ code: 'admin_game_edit_stale' })).toBeNull();
    expect(downstreamApproval({ code: 'match_reopen_downstream_played', params: { count: 1 } })).toBeNull();
    expect(downstreamApproval(null)).toBeNull();
  });

  it('the refusal is a question, not an error that needs a reload', () => {
    expect(gameChangeFailureHints(refusal)).toEqual({ reload: false, dataTools: false });
  });

  it('the edit request carries the confirm flag only once the admin approved', () => {
    const base = { winnerId: 'p1', battleStats: [STAT], expectedUpdatedAt: 'v1' };
    expect(JSON.parse(String(gameEditRequest('g1', base).init.body))).not.toHaveProperty('confirm_downstream');
    expect(JSON.parse(String(gameEditRequest('g1', { ...base, confirmDownstream: undefined }).init.body))).not.toHaveProperty('confirm_downstream');
    expect(JSON.parse(String(gameEditRequest('g1', { ...base, confirmDownstream: ['m-1'] }).init.body))).toMatchObject({
      winner_id: 'p1',
      expected_updated_at: 'v1',
      confirm_downstream: ['m-1'],
    });
  });

  it('the delete request carries the reason, and the confirm flag only once the admin approved', () => {
    const first = gameDeleteRequest('g1', { reason: 'Wrong replay' });
    expect(first.url).toBe('/api/admin/games/g1');
    expect(first.init.method).toBe('DELETE');
    expect(JSON.parse(String(first.init.body))).toEqual({ reason: 'Wrong replay' });
    expect(JSON.parse(String(gameDeleteRequest('g1', { reason: 'Wrong replay', confirmDownstream: ['m-1'] }).init.body))).toEqual({
      reason: 'Wrong replay',
      confirm_downstream: ['m-1'],
    });
  });

  it('counts the later matches a saved change reset', () => {
    expect(downstreamResetCount({ downstream_reset_match_ids: ['a', 'b'] })).toBe(2);
    expect(downstreamResetCount({})).toBe(0);
    expect(downstreamResetCount({ downstream_reset_match_ids: 'a' })).toBe(0);
  });

  it('a refusal through sendGameChange reaches the approval with its params intact', async () => {
    const result = await sendGameChange('/api/admin/games/g1', { method: 'DELETE' }, fakeFetch(409, { success: false, ...refusal }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(downstreamApproval(result.error)).toEqual({ count: 1, matches: LATER });
  });

  it('the refusal renders in both languages', () => {
    const en = renderWithI18n(<GameChangeAlerts error={{ code: refusal.code, params: { count: 2 } }} isSiteAdmin />);
    expect(en).toContain('2 later bracket matches were already played');
    const de = renderWithI18n(<GameChangeAlerts error={{ code: refusal.code, params: { count: 1 } }} isSiteAdmin />, { locale: 'de' });
    expect(de).toContain('1 späteres Spiel im Turnierbaum wurde bereits gespielt');
  });
});
